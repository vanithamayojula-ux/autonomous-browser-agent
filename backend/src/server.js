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

// Clean query helper
function sanitizeQuery(rawObjective) {
  if (!rawObjective) return "";
  let clean = rawObjective.trim();
  clean = clean.replace(/^["'\s]+|["'\s]+$/g, "");
  clean = clean.replace(/^(?:search\s+google\s+for|search\s+for|search|find|go\s+to|open)\s+/i, "");
  return clean.trim() || rawObjective.replace(/["']/g, "").trim();
}

// Safely launch Chromium with dynamic self-healing browser installer
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

// Bing Search Extractor (Primary Source per User Spec)
async function extractBing(page, rawQuery) {
  const cleaned = rawQuery.replace(/^(best|top)\s+/i, "");
  const searchQueries = [rawQuery];
  if (cleaned !== rawQuery) {
    searchQueries.unshift(cleaned);
  }

  let finalItems = [];

  for (const q of searchQueries) {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}&setmkt=en-US&setlang=en-US`;
    console.log(`[Bing Extractor] Navigating to: ${url}`);
    
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch (e) {
      console.warn(`[Bing Extractor] page.goto warning: ${e.message}`);
    }

    try {
      await page.waitForSelector('li.b_algo', { timeout: 10000 });
    } catch (err) {
      console.warn(`[Bing Extractor] waitForSelector 'li.b_algo' timed out: ${err.message}`);
    }

    const extractedData = await page.evaluate(() => {
      const rows = document.querySelectorAll('li.b_algo');
      const items = [];

      rows.forEach((row) => {
        const titleEl = row.querySelector('h2');
        const linkEl = row.querySelector('h2 a') || row.querySelector('a');
        const snippetEl = row.querySelector('.b_caption p') || row.querySelector('.b_algoSub p') || row.querySelector('p');

        const title = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '';
        let link = linkEl ? (linkEl.href || linkEl.getAttribute('href') || '') : '';
        const snippet = snippetEl ? (snippetEl.innerText || snippetEl.textContent || '').replace(/\s+/g, ' ').trim() : '';

        // Decode Bing redirect link to direct target URL if present
        if (link.includes('bing.com/ck/a?!')) {
          try {
            const uMatch = link.match(/[?&]u=a1([^&]+)/);
            if (uMatch && uMatch[1]) {
              const decoded = atob(uMatch[1]);
              if (decoded.startsWith('http')) link = decoded;
            }
          } catch (e) {}
        }

        if (title && link && link.startsWith('http')) {
          items.push({ title, link, snippet });
        }
      });

      return {
        elementCount: rows.length,
        items
      };
    });

    console.log(`[Bing Extractor] Number of elements found: ${extractedData.elementCount}`);

    if (extractedData.items.length > 0) {
      console.log(`[Bing Extractor] First extracted item:`, JSON.stringify(extractedData.items[0], null, 2));

      const validItems = extractedData.items.filter(item => {
        const t = item.title.toLowerCase();
        if (t === "best online payment" || t.includes("dictionary") || t.includes("cambridge") || t.includes("merriam-webster")) {
          return false;
        }
        return true;
      });

      if (validItems.length >= 3) {
        finalItems = validItems;
        break;
      }
    } else {
      const pageHtml = await page.content();
      console.log(`[Bing Extractor] Full Page HTML (length ${pageHtml.length}):`, pageHtml);
    }
  }

  return finalItems;
}

// Fallback Extractor: DuckDuckGo
async function extractDuckDuckGo(page, query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;
  console.log(`[DuckDuckGo Extractor] Navigating to: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

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

    steps.push("Initialized Playwright browser engine");
    browser = await launchBrowserSafely();

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      timezoneId: "America/New_York",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": "1"
      }
    });

    const page = await context.newPage();
    let results = [];
    let engineUsed = "Bing";

    // Primary Engine: Bing (User Spec)
    steps.push(`Navigated to primary search engine (Bing) for query: "${cleanQuery}"`);
    try {
      results = await extractBing(page, cleanQuery);
    } catch (e) {
      console.warn(`[Bing Extractor Error]: ${e.message}`);
    }

    // Secondary Engine: DuckDuckGo Fallback if Bing returns zero
    if (!results || results.length === 0) {
      engineUsed = "DuckDuckGo";
      steps.push("Primary engine returned 0 items. Triggering DuckDuckGo fallback...");
      try {
        results = await extractDuckDuckGo(page, cleanQuery);
      } catch (e) {
        console.warn(`[DuckDuckGo Extractor Error]: ${e.message}`);
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
