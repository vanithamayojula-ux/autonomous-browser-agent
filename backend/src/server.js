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

// 1. FIX QUERY GENERATION: Enrich query with context (India, 2026, intent)
function enrichQuery(rawQuery) {
  if (!rawQuery) return "";
  let clean = rawQuery.trim().replace(/^["'\s]+|["'\s]+$/g, "");
  clean = clean.replace(/^(?:search\s+google\s+for|search\s+for|search|find|go\s+to|open)\s+/i, "").trim();

  // Strip leading "best " or "top " for Bing to prevent dictionary/store acronym collision
  const baseQuery = clean.replace(/^(best|top)\s+/i, "").trim();

  let enriched = baseQuery;
  if (!/\b(india|inr|rs|usa|usd|uk)\b/i.test(enriched)) {
    enriched += " India";
  }
  if (!/\b(2025|2026|2027)\b/i.test(enriched)) {
    enriched += " 2026";
  }
  if (/\b(laptop|laptops|notebook|pc|macbook)\b/i.test(clean) && !/\b(review|reviews|buying guide|guide)\b/i.test(enriched)) {
    enriched += " reviews buying guide";
  }

  return enriched;
}

// 5. BLOCK JUNK DOMAINS
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
  "britannica.com",
  "wordreference.com"
];

function isJunkDomain(link) {
  if (!link) return true;
  try {
    const urlObj = new URL(link);
    const hostname = urlObj.hostname.toLowerCase();
    return JUNK_DOMAINS.some(junk => hostname.includes(junk));
  } catch (e) {
    return false;
  }
}

// Helper: Decode Bing redirect URLs (bing.com/ck/a?!...) to clean direct URLs
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

// 9. BONUS: Calculate relevance score for sorting
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

// 2 & 3. USE BING AS PRIMARY ENGINE & FIX EXTRACTION LOGIC
async function scrapeBing(page, query, steps) {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://www.bing.com/search?q=${encodedQuery}&setmkt=en-US&setlang=en-US`;

  console.log(`[Bing Engine] Navigating to: ${url}`);
  steps.push(`Navigated to Bing search URL: ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

  try {
    await page.waitForSelector('li.b_algo', { timeout: 10000 });
  } catch (err) {
    console.warn(`[Bing Engine] waitForSelector 'li.b_algo' timed out: ${err.message}`);
  }

  const scraped = await page.evaluate(() => {
    const rows = document.querySelectorAll('li.b_algo');
    const items = [];

    rows.forEach((row) => {
      const titleEl = row.querySelector('h2');
      const linkEl = row.querySelector('h2 a') || row.querySelector('a');
      const snippetEl = row.querySelector('.b_caption p') || row.querySelector('.b_algoSub p') || row.querySelector('p');

      const title = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '';
      const link = linkEl ? (linkEl.href || linkEl.getAttribute('href') || '') : '';
      const snippet = snippetEl ? (snippetEl.innerText || snippetEl.textContent || '').replace(/\s+/g, ' ').trim() : '';

      if (title && link && link.startsWith('http')) {
        items.push({ title, link, snippet });
      }
    });

    return items;
  });

  // Decode links on server side
  scraped.forEach(item => {
    item.link = decodeBingLink(item.link);
  });

  // 6. ADD DEBUGGING (MANDATORY)
  console.log(`[Debug Log] Total scraped results from Bing: ${scraped.length}`);
  steps.push(`Total scraped results from Bing: ${scraped.length}`);

  if (scraped.length === 0) {
    const fullHtml = await page.content();
    console.log(`[Debug Log] 0 results found. Full Page HTML length: ${fullHtml.length}`);
    console.log(`[Debug Log] Full Page HTML snippet:`, fullHtml.substring(0, 1500));
  } else {
    console.log(`[Debug Log] First raw scraped result:`, JSON.stringify(scraped[0], null, 2));
  }

  return scraped;
}

// 4. ADD STRICT RELEVANCE FILTERING & 7. FAILSAFE SYSTEM
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

    // 1. Enrich Query
    const enrichedQuery = enrichQuery(rawQuery);
    console.log(`[Query Generation] Raw: "${rawQuery}" -> Enriched: "${enrichedQuery}"`);
    steps.push(`Enriched query: "${enrichedQuery}"`);

    // 2. Scrape Bing
    let scraped = await scrapeBing(page, enrichedQuery, steps);

    // 5. Block Junk Domains
    let filtered = scraped.filter(item => !isJunkDomain(item.link));

    // 4. Strict Relevance Filter
    const isLaptopQuery = /\b(laptop|laptops|notebook|pc|macbook)\b/i.test(rawQuery);
    if (isLaptopQuery) {
      filtered = filtered.filter(item => {
        const combined = (item.title + " " + item.snippet).toLowerCase();
        return combined.includes("laptop") || combined.includes("notebook") || combined.includes("macbook");
      });
    }

    console.log(`[Debug Log] Filtered results count: ${filtered.length}`);
    steps.push(`Filtered results count: ${filtered.length}`);

    // 7. FAILSAFE SYSTEM: Retry if filtered < 3
    if (filtered.length < 3) {
      const failsafeQuery = "laptops under 70000 India Amazon Flipkart review";
      console.log(`[Failsafe Triggered] Results count (${filtered.length}) < 3. Retrying with failsafe query: "${failsafeQuery}"`);
      steps.push(`Failsafe triggered. Retrying with query: "${failsafeQuery}"`);

      scraped = await scrapeBing(page, failsafeQuery, steps);

      filtered = scraped.filter(item => !isJunkDomain(item.link));
      if (isLaptopQuery) {
        filtered = filtered.filter(item => {
          const combined = (item.title + " " + item.snippet).toLowerCase();
          return combined.includes("laptop") || combined.includes("notebook") || combined.includes("macbook");
        });
      }
      console.log(`[Debug Log] Failsafe Filtered results count: ${filtered.length}`);
      steps.push(`Failsafe Filtered results count: ${filtered.length}`);
    }

    if (filtered.length > 0) {
      console.log(`[Debug Log] First valid result:`, JSON.stringify(filtered[0], null, 2));
      steps.push(`First valid result: "${filtered[0].title}"`);
    }

    // 9. BONUS: Sort by relevance score
    filtered.sort((a, b) => {
      const scoreA = calculateRelevanceScore(a.title, a.snippet, rawQuery);
      const scoreB = calculateRelevanceScore(b.title, b.snippet, rawQuery);
      return scoreB - scoreA;
    });

    // 8. FINAL OUTPUT: Return Top 5 clean, relevant results
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
