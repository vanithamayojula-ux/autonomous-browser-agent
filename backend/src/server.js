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

  // Enhance numeric budget queries (e.g. "laptops under 50000" -> "laptops under 50000 in India INR")
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
      if (items.length >= 6) return;
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
      if (items.length >= 6) return;
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

// Shared Task Execution Handler
async function handleTaskExecution(req, res) {
  const rawQuery = req.body?.query || req.body?.objective;

  if (!rawQuery || typeof rawQuery !== "string" || !rawQuery.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid "query" or "objective" string in request body.'
    });
  }

  const cleanQuery = sanitizeQuery(rawQuery);
  const steps = [];

  let browser = null;

  try {
    console.log(`[Execute Task] Raw: "${rawQuery}" -> Clean Query: "${cleanQuery}"`);

    steps.push("Initialized browser engine with stealth headers");
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
    let engineUsed = "DuckDuckGo";

    // Attempt 1: DuckDuckGo Extractor
    steps.push(`Navigated to search engine for query: "${cleanQuery}"`);
    try {
      const rawDd = await extractDuckDuckGo(page, cleanQuery);
      results = rawDd.filter(r => isEnglishResult(r.title, r.snippet) && isRelevantResult(r.title, r.snippet, cleanQuery));
    } catch (e) {
      console.warn(`DuckDuckGo extractor warning: ${e.message}`);
    }

    // Attempt 2: Fallback to Bing Extractor if zero results
    if (!results || results.length === 0) {
      engineUsed = "Bing";
      steps.push("Primary engine returned 0 items. Triggered Bing search fallback...");
      try {
        const rawBing = await extractBing(page, cleanQuery);
        results = rawBing.filter(r => isEnglishResult(r.title, r.snippet) && isRelevantResult(r.title, r.snippet, cleanQuery));
      } catch (e) {
        console.warn(`Bing extractor warning: ${e.message}`);
      }
    }

    results = results || [];
    steps.push(`Extracted ${results.length} clean structured search items via ${engineUsed}`);

    return res.status(200).json({
      success: true,
      query: cleanQuery,
      engine: engineUsed,
      results,
      steps,
      result: `Found ${results.length} structured results for "${cleanQuery}"`
    });
  } catch (err) {
    console.error(`[Execution Error]: ${err.message}`);
    steps.push(`Execution error: ${err.message}`);
    return res.status(500).json({
      success: false,
      query: cleanQuery || rawQuery,
      results: [],
      steps,
      error: err.message
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
