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

// Query Sanitizer Utility
function sanitizeQuery(rawQuery) {
  if (!rawQuery || typeof rawQuery !== "string") return "";
  let clean = rawQuery.trim();
  // Strip enclosing quotes and brackets
  clean = clean.replace(/^["'\s]+|["'\s]+$/g, "");
  // Strip command prefixes like "Search Google for", "Search for", "Find"
  clean = clean.replace(/^(?:search\s+google\s+for|search\s+for|search|find|go\s+to|open)\s+/i, "");
  return clean.trim() || rawQuery.replace(/["']/g, "").trim();
}

// Helper: Safely launch Chromium with dynamic self-healing installer
async function launchBrowserSafely() {
  const launchOptions = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled"
    ]
  };

  try {
    return await chromium.launch(launchOptions);
  } catch (err) {
    console.warn(`[Playwright Launch Warning]: ${err.message}`);
    if (err.message.includes("Executable doesn't exist") || err.message.includes("download new browsers")) {
      console.log("[Playwright] Missing browser binary detected. Running auto-install...");
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

// 1. DuckDuckGo Structured Extractor
async function extractDuckDuckGo(page, query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

  return await page.evaluate(() => {
    const items = [];
    const rows = document.querySelectorAll('.result');

    rows.forEach((row) => {
      if (items.length >= 10) return;
      const titleEl = row.querySelector('.result__title a, .result__a');
      const snippetEl = row.querySelector('.result__snippet');
      const urlEl = row.querySelector('.result__url');

      if (titleEl) {
        const title = (titleEl.textContent || '').trim();
        let link = titleEl.getAttribute('href') || (urlEl ? (urlEl.textContent || '').trim() : '');
        
        // Clean DuckDuckGo redirect URLs
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

// 2. Bing Structured Extractor
async function extractBing(page, query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

  return await page.evaluate(() => {
    const items = [];
    const rows = document.querySelectorAll('.b_algo');

    rows.forEach((row) => {
      if (items.length >= 10) return;
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

// Main Execution Handler
async function handleExecuteTask(req, res) {
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
      totalSteps: 3,
      action,
      status,
      detail
    });
  };

  let browser = null;

  try {
    console.log(`[Execute Task] Raw: "${rawQuery}" -> Clean Query: "${cleanQuery}"`);

    addLog("BROWSER_INIT", "Launching Playwright Chromium engine with stealth headers...");
    browser = await launchBrowserSafely();

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    });

    const page = await context.newPage();
    let results = [];
    let engineUsed = "DuckDuckGo";

    // Attempt 1: DuckDuckGo Extractor
    addLog("extract_duckduckgo", `Running DuckDuckGo extractor for query: "${cleanQuery}"`);
    try {
      results = await extractDuckDuckGo(page, cleanQuery);
    } catch (e) {
      console.warn(`DuckDuckGo extractor failed: ${e.message}`);
    }

    // Attempt 2: Fallback to Bing Extractor if zero results
    if (!results || results.length === 0) {
      engineUsed = "Bing";
      addLog("fallback_bing", `DuckDuckGo returned 0 items. Falling back to Bing extractor...`);
      try {
        results = await extractBing(page, cleanQuery);
      } catch (e) {
        console.warn(`Bing extractor failed: ${e.message}`);
      }
    }

    // Ensure results is always an array
    results = results || [];

    // Format clean Markdown summary output (NO raw HTML)
    const formattedSummaryList = results.length > 0
      ? results.map((item, i) => `**${i + 1}. [${item.title}](${item.link})**\n   ${item.snippet}`).join('\n\n')
      : `No structured search results found for query: "${cleanQuery}"`;

    const summary = `### Structured Search Results for "${cleanQuery}"\n\n**Engine Used:** ${engineUsed}\n**Total Results Found:** ${results.length}\n\n${formattedSummaryList}`;

    addLog("SUCCESS", `Extracted ${results.length} clean items in ${Date.now() - startTime}ms`);

    return res.status(200).json({
      success: true,
      query: cleanQuery,
      engine: engineUsed,
      resultsCount: results.length,
      results,
      summary,
      result: results.length > 0 ? `Found ${results.length} results for "${cleanQuery}"` : `No results found for "${cleanQuery}"`,
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

// Endpoints
app.post("/execute", handleExecuteTask);
app.post("/run-task", handleExecuteTask);
app.post("/api/agent/run", handleExecuteTask);

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
