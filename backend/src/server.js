const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const { execSync } = require("child_process");

const app = express();

// Enable CORS for Vercel frontend domain and all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Health routes
app.get("/", (req, res) => {
  res.send("Backend is running");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "backend" });
});

app.get("/api/agent/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "backend" });
});

// Query Sanitizer & Enhancer Utility
function sanitizeQuery(rawObjective) {
  if (!rawObjective) return "";
  let clean = rawObjective.trim();
  clean = clean.replace(/^["'\s]+|["'\s]+$/g, "");
  clean = clean.replace(/^(?:search\s+google\s+for|search\s+for|search|find|go\s+to|open)\s+/i, "");
  clean = clean.trim() || rawObjective.replace(/["']/g, "").trim();

  // Enhance numeric budget queries (e.g., "laptops under 70000" -> "laptops under 70000 in India INR")
  if (/\b(?:laptop|laptops|phone|phones|mobile|pc)\b/i.test(clean) && /\b\d{4,6}\b/.test(clean) && !/\b(in india|in usa|usd|inr|rs)\b/i.test(clean)) {
    clean += " in India INR";
  }

  return clean;
}

// Helper: Filter out non-English / CJK script titles
function isEnglishResult(title, snippet) {
  const combined = (title + " " + snippet);
  const hasForeignScript = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0400-\u04ff\u00C0-\u024F]/.test(combined);
  return !hasForeignScript;
}

// Helper: Strict Keyword Relevance Filter
function isRelevantResult(title, snippet, query) {
  const combined = (title + " " + snippet).toLowerCase();
  const qLower = query.toLowerCase();

  // If query relates to laptops/computers, mandate laptop/tech domain keywords
  if (qLower.includes("laptop") || qLower.includes("notebook") || qLower.includes("computer")) {
    const laptopKeywords = [
      "laptop", "notebook", "pc", "macbook", "asus", "hp", "lenovo", "dell", 
      "acer", "msi", "apple", "intel", "ryzen", "core", "ram", "ssd", "display", 
      "gadget", "price", "digit", "flipkart", "amazon", "smartprix", "91mobiles", "tech"
    ];
    const matchesKeyword = laptopKeywords.some(k => combined.includes(k));
    if (!matchesKeyword) return false;
  }

  return true;
}

// Helper: Safely launch Chromium with dynamic self-healing browser installer
async function launchBrowserSafely() {
  const launchOptions = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--lang=en-US,en"
    ]
  };

  try {
    return await chromium.launch(launchOptions);
  } catch (err) {
    console.warn(`[Playwright Launch Warning]: ${err.message}`);
    if (err.message.includes("Executable doesn't exist") || err.message.includes("download new browsers")) {
      console.log("[Playwright] Missing browser binary detected. Triggering dynamic auto-installation...");
      try {
        execSync("npx playwright install", { stdio: "inherit" });
      } catch (cmdErr) {
        console.error(`[Playwright Auto-Install Error]: ${cmdErr.message}`);
      }
      return await chromium.launch(launchOptions);
    }
    throw err;
  }
}

// 1. DuckDuckGo Enforced English Extractor
async function extractDuckDuckGo(page, query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

  return await page.evaluate(() => {
    const items = [];
    const rows = document.querySelectorAll('.result');

    rows.forEach((row) => {
      if (items.length >= 8) return;
      const titleEl = row.querySelector('.result__title a, .result__a');
      const snippetEl = row.querySelector('.result__snippet');
      const urlEl = row.querySelector('.result__url');

      if (titleEl) {
        const title = (titleEl.textContent || '').trim();
        let link = titleEl.getAttribute('href') || (urlEl ? (urlEl.textContent || '').trim() : '');
        
        if (link.startsWith('//')) link = 'https:' + link;
        if (link.includes('duckduckgo.com/l/?uddg=')) {
          try {
            const match = link.match(/uddg=([^&]+)/);
            if (match && match[1]) {
              link = decodeURIComponent(match[1]);
            }
          } catch (e) {}
        }

        const snippet = snippetEl ? (snippetEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
        if (title && !title.toLowerCase().includes('javascript') && link.startsWith('http')) {
          items.push({ title, link, snippet });
        }
      }
    });

    return items;
  });
}

// 2. Bing Enforced English Extractor
async function extractBing(page, query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setmkt=en-US&setlang=en-US`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

  return await page.evaluate(() => {
    const items = [];
    const rows = document.querySelectorAll('.b_algo');

    rows.forEach((row) => {
      if (items.length >= 8) return;
      const titleEl = row.querySelector('h2 a');
      const snippetEl = row.querySelector('.b_caption p, p, .b_algoSub');

      if (titleEl) {
        const title = (titleEl.textContent || '').trim();
        const link = titleEl.getAttribute('href') || '';
        const snippet = snippetEl ? (snippetEl.textContent || '').replace(/\s+/g, ' ').trim() : '';

        if (title && link.startsWith('http')) {
          items.push({ title, link, snippet });
        }
      }
    });

    return items;
  });
}

// AI Synthesizer Service
async function generateAISynthesis(query, items, pageContent = '') {
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;

  const itemDetails = items
    .map((item, idx) => `${idx + 1}. Title: ${item.title}\n   Link: ${item.link}\n   Snippet: ${item.snippet}`)
    .join('\n\n');

  const promptText = `
You are an expert AI research assistant. Synthesize a comprehensive, professional, well-structured guide answering the user's objective based on the search data below.

USER OBJECTIVE:
"${query}"

SEARCH DATA:
${itemDetails}

EXTRACTED PAGE CONTENT:
${pageContent.slice(0, 3000)}

INSTRUCTIONS:
1. Provide a clear, natural-language executive summary.
2. Group the top findings logically (e.g. for products/laptops, list top models with key specs, estimated prices, and target audience; for topics, provide key steps or components).
3. Use markdown formatting with clear headings, bullet points, bold text, and clickable link citations.
4. DO NOT return raw code or Japanese/Spanish/foreign text. Deliver a high-value answer directly addressing the user's request.
`;

  if (apiKey) {
    try {
      if (process.env.GEMINI_API_KEY) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
          }
        );
        const data = await res.json();
        const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (aiText) return aiText;
      } else if (process.env.OPENAI_API_KEY) {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: promptText }]
          })
        });
        const data = await res.json();
        const aiText = data?.choices?.[0]?.message?.content;
        if (aiText) return aiText;
      }
    } catch (e) {
      console.warn('AI API synthesis error, using expert rule-based synthesizer:', e.message);
    }
  }

  // Expert Intelligent Synthesis Engine (Fallback if no API key)
  const listItems = items
    .map((item, i) => `### ${i + 1}. [${item.title}](${item.link})\n**Key Insights:** ${item.snippet || 'Comprehensive guide and specifications.'}`)
    .join('\n\n');

  return `## Executive Summary for "${query}"\n\nBased on real-time web analysis across top domain sources, here is the structured synthesis:\n\n${listItems}\n\n---\n\n### 💡 Recommendations & Next Steps\n- Review individual product specifications and user benchmarks before purchase.\n- Verify current prices and warranty details on official retail platforms.`;
}

// Shared task execution logic
async function handleTaskExecution(req, res) {
  const rawQuery = req.body?.query || req.body?.objective;

  if (!rawQuery || typeof rawQuery !== "string" || !rawQuery.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid "query" or "objective" string in request body.'
    });
  }

  const cleanQuery = sanitizeQuery(rawQuery);
  const startTime = Date.now();
  const logs = [];

  const addLog = (action, detail, status = "SUCCESS") => {
    logs.push({
      timestamp: new Date().toISOString(),
      stepIndex: logs.length + 1,
      totalSteps: 4,
      action,
      status,
      detail
    });
  };

  let browser = null;

  try {
    console.log(`[Execute Task] Raw: "${rawQuery}" -> Clean Query: "${cleanQuery}"`);

    addLog("BROWSER_INIT", "Launching Playwright Chromium engine with English locale...");
    browser = await launchBrowserSafely();

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      timezoneId: "America/New_York",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": "1"
      }
    });

    const page = await context.newPage();
    let results = [];
    let engineUsed = "DuckDuckGo (EN)";

    // 1. DuckDuckGo Extractor
    addLog("extract_duckduckgo", `Searching DuckDuckGo (en-US) for: "${cleanQuery}"`);
    try {
      const rawDd = await extractDuckDuckGo(page, cleanQuery);
      results = rawDd.filter(r => isEnglishResult(r.title, r.snippet) && isRelevantResult(r.title, r.snippet, cleanQuery));
    } catch (e) {
      console.warn(`DuckDuckGo extractor warning: ${e.message}`);
    }

    // 2. Fallback Bing Extractor
    if (!results || results.length === 0) {
      engineUsed = "Bing (EN)";
      addLog("fallback_bing", `Switching to Bing (en-US) for English search results...`);
      try {
        const rawBing = await extractBing(page, cleanQuery);
        results = rawBing.filter(r => isEnglishResult(r.title, r.snippet) && isRelevantResult(r.title, r.snippet, cleanQuery));
      } catch (e) {
        console.warn(`Bing extractor warning: ${e.message}`);
      }
    }

    results = results || [];

    // 3. Deep Extraction: Visit top English result link to gather article body content
    let topPageContent = '';
    if (results.length > 0 && results[0].link) {
      try {
        addLog("deep_extract", `Visiting top result for deep content analysis: ${results[0].title}`);
        await page.goto(results[0].link, { waitUntil: "domcontentloaded", timeout: 10000 });
        const bodyText = await page.textContent("body");
        topPageContent = (bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 3000);
      } catch (e) {
        console.warn(`Deep page extraction skipped: ${e.message}`);
      }
    }

    // 4. Generate AI Natural-Language Synthesis
    addLog("ai_synthesis", "Generating structured natural-language response...");
    const aiSummary = await generateAISynthesis(cleanQuery, results, topPageContent);

    addLog("SUCCESS", `Execution finished in ${Date.now() - startTime}ms`);

    return res.status(200).json({
      success: true,
      query: cleanQuery,
      engine: engineUsed,
      resultsCount: results.length,
      results,
      summary: aiSummary,
      result: `Successfully analyzed "${cleanQuery}". Top result: ${results[0]?.title || 'Complete'}`,
      logs
    });
  } catch (err) {
    console.error(`[Execution Error]: ${err.message}`);
    addLog("FAILED", `Error: ${err.message}`, "FAILED");
    return res.status(500).json({
      success: false,
      query: cleanQuery || rawQuery,
      results: [],
      error: err.message,
      logs
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
      console.log("[Playwright] Browser instance closed safely.");
    }
  }
}

// Support all endpoints
app.post("/execute", handleTaskExecution);
app.post("/run-task", handleTaskExecution);
app.post("/api/agent/run", handleTaskExecution);

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
