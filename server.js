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

// Query Sanitizer Helper
function sanitizeQuery(rawQuery) {
  if (!rawQuery) return "";
  let clean = rawQuery.trim().replace(/^["'\s]+|["'\s]+$/g, "");
  clean = clean.replace(/^(?:search\s+google\s+for|search\s+for|search|find|go\s+to|open)\s+/i, "").trim();
  return clean || rawQuery.trim();
}

// Block Junk & Acronym Domains
const JUNK_DOMAINS = [
  "wikipedia.org",
  "youtube.com",
  "music.youtube.com",
  "dictionary.com",
  "merriam-webster.com",
  "cambridge.org",
  "thefreedictionary.com",
  "yometro.com",
  "undertaking.net",
  "bestundertaking.com",
  "britannica.com",
  "wordreference.com"
];

function isJunkDomain(link) {
  if (!link) return false;
  try {
    const urlObj = new URL(link);
    const hostname = urlObj.hostname.toLowerCase();
    return JUNK_DOMAINS.some(junk => hostname.includes(junk));
  } catch (e) {
    return false;
  }
}

// Decode Bing redirect URLs (bing.com/ck/a?!...) to clean direct destination URLs
function decodeBingLink(link) {
  if (link && link.includes('bing.com/ck/a?!')) {
    try {
      const uMatch = link.match(/[?&]u=a1([^&]+)/);
      if (uMatch && uMatch[1]) {
        let b64 = uMatch[1].replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4 !== 0) b64 += '=';
        const decoded = Buffer.from(b64, 'base64').toString('utf-8');
        if (decoded.startsWith('http')) return decoded;
      }
    } catch (e) {}
  }
  return link;
}

// Relevance Validation Rule
function isRelevantResult(item, rawQuery) {
  if (!item || !item.title) return false;
  const combined = (item.title + " " + item.snippet + " " + item.link).toLowerCase();

  // Rejection rules for dictionary / transport acronym pages
  if (combined.includes("dictionary") || combined.includes("meaning") || combined.includes("undertaking")) {
    return false;
  }

  // Acceptance rules for product/laptop queries
  if (/\b(laptop|laptops|notebook|pc|macbook)\b/i.test(rawQuery)) {
    const laptopKeywords = [
      "laptop", "notebook", "macbook", "pc", "computer", "asus", "hp", "lenovo",
      "dell", "acer", "msi", "apple", "intel", "ryzen", "core", "ram", "ssd",
      "amazon", "flipkart", "croma", "smartprix", "91mobiles", "digit", "tech", "best buy"
    ];
    return laptopKeywords.some(kw => combined.includes(kw));
  }

  return true;
}

// Calculate Relevance Score for Sorting
function calculateRelevanceScore(title, snippet, rawQuery) {
  const combined = (title + " " + snippet).toLowerCase();
  const tokens = rawQuery.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  let score = 0;
  tokens.forEach(token => {
    if (combined.includes(token)) score += 1;
  });
  if (combined.includes("laptop") || combined.includes("notebook")) score += 3;
  return score;
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

// Bing Primary Scraper
async function scrapeBing(page, query, steps) {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://www.bing.com/search?q=${encodedQuery}`;

  console.log(`[Bing Engine] Navigating to: ${url}`);
  steps.push(`Navigated to Bing search URL: ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

  try {
    await page.waitForSelector('li.b_algo', { timeout: 8000 });
  } catch (err) {}

  let scraped = [];
  try {
    scraped = await page.evaluate(() => {
      const rows = document.querySelectorAll('li.b_algo');
      const items = [];

      rows.forEach((row) => {
        const titleEl = row.querySelector('h2') || row.querySelector('a');
        const linkEl = row.querySelector('h2 a') || row.querySelector('a');
        const snippetEl = row.querySelector('.b_caption p') || row.querySelector('.b_caption') || row.querySelector('.b_algoSub') || row.querySelector('.b_lineclamp2') || row.querySelector('.b_lineclamp3') || row.querySelector('p');

        const title = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '';
        const link = linkEl ? (linkEl.href || linkEl.getAttribute('href') || '') : '';
        const snippet = snippetEl ? (snippetEl.innerText || snippetEl.textContent || '').replace(/\s+/g, ' ').trim() : '';

        if (title && link && link.startsWith('http')) {
          items.push({ title, link, snippet });
        }
      });

      return items;
    });
  } catch (e) {
    console.warn(`[Bing evaluate error]: ${e.message}`);
  }

  scraped.forEach(item => {
    item.link = decodeBingLink(item.link);
  });

  console.log(`[Debug Log] Total scraped results from Bing: ${scraped.length}`);
  steps.push(`Total scraped results from Bing: ${scraped.length}`);

  if (scraped.length === 0) {
    const fullHtml = await page.content().catch(() => "");
    console.log(`[Debug Log] 0 results found. Full Page HTML snippet:`, fullHtml.substring(0, 1500));
  } else {
    console.log(`[Debug Log] First raw scraped result:`, JSON.stringify(scraped[0], null, 2));
  }

  return scraped;
}

// DuckDuckGo Secondary Fallback Scraper (Safe against Execution Context Destroyed error)
async function scrapeDuckDuckGo(page, query, steps) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  console.log(`[DuckDuckGo Fallback] Navigating to: ${url}`);
  steps.push(`Fallback: Navigated to DuckDuckGo search URL: ${url}`);

  await page.goto(url, { waitUntil: "load", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);

  let scraped = [];
  try {
    scraped = await page.evaluate(() => {
      const items = [];
      const rows = document.querySelectorAll('.result');
      rows.forEach(row => {
        const a = row.querySelector('.result__title a');
        const snippetEl = row.querySelector('.result__snippet');
        if (a) {
          const title = (a.textContent || '').trim();
          let link = a.getAttribute('href') || '';
          if (link.includes('uddg=')) {
            const match = link.match(/uddg=([^&]+)/);
            if (match && match[1]) link = decodeURIComponent(match[1]);
          }
          const snippet = snippetEl ? (snippetEl.textContent || '').trim() : '';
          if (title && link.startsWith('http')) {
            items.push({ title, link, snippet });
          }
        }
      });
      return items;
    });
  } catch (e) {
    console.warn(`[DuckDuckGo evaluate error]: ${e.message}`);
  }

  steps.push(`DuckDuckGo scraped results: ${scraped.length}`);
  return scraped;
}

// Multi-Tier Pipeline Execution
async function runSearchPipeline(rawQuery, steps) {
  const browser = await launchBrowserSafely();

  try {
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
    const cleanQuery = sanitizeQuery(rawQuery);

    steps.push(`Query: "${cleanQuery}"`);

    // Tier 1: Optimized Bing search target (strip leading "best/top" to prevent acronym collision)
    let searchTarget = cleanQuery;
    if (/^(best|top)\s+/i.test(cleanQuery)) {
      searchTarget = cleanQuery.replace(/^(best|top)\s+/i, "").trim();
    }

    let scraped = await scrapeBing(page, searchTarget, steps);
    let filtered = scraped.filter(item => !isJunkDomain(item.link) && isRelevantResult(item, cleanQuery));

    steps.push(`Filtered results count: ${filtered.length}`);

    // Tier 2: Failsafe Bing with raw cleanQuery if < 3
    if (filtered.length < 3) {
      steps.push(`Failsafe 1: Retrying Bing with raw query: "${cleanQuery}"`);
      scraped = await scrapeBing(page, cleanQuery, steps);
      filtered = scraped.filter(item => !isJunkDomain(item.link) && isRelevantResult(item, cleanQuery));
      steps.push(`Failsafe 1 Filtered results count: ${filtered.length}`);
    }

    // Tier 3: DuckDuckGo Fallback if < 3
    if (filtered.length < 3) {
      steps.push(`Failsafe 2: Triggering DuckDuckGo fallback for: "${cleanQuery}"`);
      scraped = await scrapeDuckDuckGo(page, cleanQuery, steps);
      filtered = scraped.filter(item => !isJunkDomain(item.link) && isRelevantResult(item, cleanQuery));
      steps.push(`Failsafe 2 Filtered results count: ${filtered.length}`);
    }

    if (filtered.length > 0) {
      console.log(`[Debug Log] First valid result:`, JSON.stringify(filtered[0], null, 2));
      steps.push(`First valid result: "${filtered[0].title}"`);
    }

    // Sort by relevance score
    filtered.sort((a, b) => {
      const scoreA = calculateRelevanceScore(a.title, a.snippet, cleanQuery);
      const scoreB = calculateRelevanceScore(b.title, b.snippet, cleanQuery);
      return scoreB - scoreA;
    });

    return filtered.slice(0, 5);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
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

  const steps = [];

  try {
    const results = await runSearchPipeline(rawQuery, steps);

    return res.status(200).json({
      success: true,
      query: rawQuery,
      engine: "Bing",
      results,
      steps,
      result: `Found ${results.length} structured results for "${rawQuery}"`
    });
  } catch (err) {
    console.error(`[Execution Error]: ${err.message}`);
    steps.push(`Execution error: ${err.message}`);
    return res.status(500).json({
      success: false,
      query: rawQuery,
      results: [],
      steps,
      error: err.message
    });
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
