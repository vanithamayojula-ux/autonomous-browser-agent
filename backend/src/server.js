const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const https = require("https");
const http = require("http");

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

// Block Junk Domains
const JUNK_DOMAINS = [
  "dictionary.com",
  "merriam-webster.com",
  "cambridge.org",
  "thefreedictionary.com",
  "yometro.com",
  "undertaking.net",
  "bestundertaking.com",
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

// Universal Link Decoder (Bing, Google, DuckDuckGo redirects)
function decodeSearchLink(link) {
  if (!link) return "";
  try {
    if (link.includes('bing.com/ck/a?!')) {
      const uMatch = link.match(/[?&]u=a1([^&]+)/);
      if (uMatch && uMatch[1]) {
        let b64 = uMatch[1].replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4 !== 0) b64 += '=';
        const decoded = Buffer.from(b64, 'base64').toString('utf-8');
        if (decoded.startsWith('http')) return decoded;
      }
    }
    if (link.includes('google.com/url?')) {
      const qMatch = link.match(/[?&]q=([^&]+)/);
      if (qMatch && qMatch[1]) {
        const decoded = decodeURIComponent(qMatch[1]);
        if (decoded.startsWith('http')) return decoded;
      }
    }
    if (link.includes('uddg=')) {
      const match = link.match(/uddg=([^&]+)/);
      if (match && match[1]) {
        const decoded = decodeURIComponent(match[1]);
        if (decoded.startsWith('http')) return decoded;
      }
    }
  } catch (e) {}
  return link;
}

// Relevance Validation Rule
function isRelevantResult(item, rawQuery) {
  if (!item || !item.title || !item.link) return false;
  if (!item.link.startsWith('http')) return false;

  const combined = (item.title + " " + (item.snippet || "") + " " + item.link).toLowerCase();

  if (combined.includes("dictionary") || combined.includes("meaning") || combined.includes("undertaking")) {
    return false;
  }

  return true;
}

// Calculate Relevance Score for Sorting
function calculateRelevanceScore(title, snippet, rawQuery) {
  const combined = (title + " " + snippet).toLowerCase();
  const tokens = rawQuery.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  let score = 0;
  tokens.forEach(token => {
    if (combined.includes(token)) score += 2;
  });
  if (combined.includes("laptop") || combined.includes("notebook") || combined.includes("pc")) score += 3;
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

// Engine 1: Bing Primary Scraper
async function scrapeBing(page, query, steps) {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://www.bing.com/search?q=${encodedQuery}`;

  console.log(`[Bing Engine] Navigating to: ${url}`);
  steps.push(`Navigated to Bing search URL: ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

  try {
    const consentBtn = await page.$('#bnp_btn_accept, #b_consent button, button#id_a');
    if (consentBtn) await consentBtn.click().catch(() => {});
  } catch (e) {}

  try {
    await page.waitForSelector('li.b_algo, .b_algo, #b_results > li', { timeout: 6000 });
  } catch (err) {}

  let scraped = [];
  try {
    scraped = await page.evaluate(() => {
      const rows = document.querySelectorAll('li.b_algo, div.b_algo, .b_algo, #b_results > li');
      const items = [];

      rows.forEach((row) => {
        const titleEl = row.querySelector('h2') || row.querySelector('h2 a') || row.querySelector('a');
        const linkEl = row.querySelector('h2 a') || row.querySelector('a');
        const snippetEl = row.querySelector('.b_caption p') || row.querySelector('.b_caption') || row.querySelector('.b_algoSub') || row.querySelector('.b_lineclamp2') || row.querySelector('.b_lineclamp3') || row.querySelector('p');

        const title = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '';
        const link = linkEl ? (linkEl.href || linkEl.getAttribute('href') || '') : '';
        const snippet = snippetEl ? (snippetEl.innerText || snippetEl.textContent || '').replace(/\s+/g, ' ').trim() : '';

        if (title && link && link.startsWith('http') && !link.includes('bing.com/search')) {
          items.push({ title, link, snippet });
        }
      });

      return items;
    });
  } catch (e) {
    console.warn(`[Bing evaluate error]: ${e.message}`);
  }

  scraped.forEach(item => {
    item.link = decodeSearchLink(item.link);
  });

  console.log(`[Debug Log] Total scraped results from Bing: ${scraped.length}`);
  steps.push(`Total scraped results from Bing: ${scraped.length}`);

  return scraped;
}

// Engine 2: Google Search Fallback Scraper
async function scrapeGoogle(page, query, steps) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  console.log(`[Google Engine] Navigating to: ${url}`);
  steps.push(`Fallback: Navigated to Google search URL: ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

  try {
    await page.waitForSelector('div.g, .tF2Cxc, div.MjjYud', { timeout: 6000 });
  } catch (err) {}

  let scraped = [];
  try {
    scraped = await page.evaluate(() => {
      const items = [];
      const rows = document.querySelectorAll('div.g, .tF2Cxc, div.MjjYud');

      rows.forEach((row) => {
        const titleEl = row.querySelector('h3') || row.querySelector('a h3');
        const linkEl = row.querySelector('a[href^="http"]');
        const snippetEl = row.querySelector('.VwiC3b') || row.querySelector('.IsZvec') || row.querySelector('.yD2vf') || row.querySelector('div[style*="line-clamp"]');

        const title = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '';
        const link = linkEl ? (linkEl.getAttribute('href') || linkEl.href || '') : '';
        const snippet = snippetEl ? (snippetEl.innerText || snippetEl.textContent || '').replace(/\s+/g, ' ').trim() : '';

        if (title && link && link.startsWith('http') && !link.includes('google.com/search')) {
          items.push({ title, link, snippet });
        }
      });

      return items;
    });
  } catch (e) {
    console.warn(`[Google evaluate error]: ${e.message}`);
  }

  scraped.forEach(item => {
    item.link = decodeSearchLink(item.link);
  });

  console.log(`[Debug Log] Total scraped results from Google: ${scraped.length}`);
  steps.push(`Google scraped results: ${scraped.length}`);

  return scraped;
}

// Engine 3: DuckDuckGo Secondary Fallback Scraper
async function scrapeDuckDuckGo(page, query, steps) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  console.log(`[DuckDuckGo Fallback] Navigating to: ${url}`);
  steps.push(`Fallback: Navigated to DuckDuckGo search URL: ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

  let scraped = [];
  try {
    scraped = await page.evaluate(() => {
      const items = [];
      const rows = document.querySelectorAll('.result, .result__body');
      rows.forEach(row => {
        const a = row.querySelector('.result__title a') || row.querySelector('a.result__a');
        const snippetEl = row.querySelector('.result__snippet');
        if (a) {
          const title = (a.textContent || '').trim();
          let link = a.getAttribute('href') || '';
          const snippet = snippetEl ? (snippetEl.textContent || '').trim() : '';
          if (title && link) {
            items.push({ title, link, snippet });
          }
        }
      });
      return items;
    });
  } catch (e) {
    console.warn(`[DuckDuckGo evaluate error]: ${e.message}`);
  }

  scraped.forEach(item => {
    item.link = decodeSearchLink(item.link);
  });

  steps.push(`DuckDuckGo scraped results: ${scraped.length}`);
  return scraped;
}

// Engine 4: Direct HTTP Light Search Engine Fallback
function fetchDirectSearchFallback(query, steps) {
  return new Promise((resolve) => {
    steps.push(`Direct HTTP Engine: Fetching lightweight web search for "${query}"`);
    const encoded = encodeURIComponent(query);
    const postData = `q=${encoded}`;

    const options = {
      hostname: 'lite.duckduckgo.com',
      port: 443,
      path: '/lite/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const items = [];
        try {
          const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*class=["']result-link["'][^>]*>(.*?)<\/a>/gi;
          const snippetRegex = /<td[^>]+class=["']result-snippet["'][^>]*>(.*?)<\/td>/gi;

          let linkMatch;
          const links = [];
          while ((linkMatch = linkRegex.exec(data)) !== null) {
            let rawUrl = linkMatch[1];
            let rawTitle = linkMatch[2].replace(/<[^>]+>/g, '').trim();
            links.push({ title: rawTitle, link: decodeSearchLink(rawUrl) });
          }

          let snippetMatch;
          const snippets = [];
          while ((snippetMatch = snippetRegex.exec(data)) !== null) {
            snippets.push(snippetMatch[1].replace(/<[^>]+>/g, '').trim());
          }

          for (let i = 0; i < links.length; i++) {
            items.push({
              title: links[i].title,
              link: links[i].link,
              snippet: snippets[i] || `Organic result for ${query}`
            });
          }
        } catch (err) {
          console.warn(`[HTTP Direct Search Parse Error]: ${err.message}`);
        }

        steps.push(`Direct HTTP Engine extracted results: ${items.length}`);
        resolve(items);
      });
    });

    req.on('error', (err) => {
      console.warn(`[HTTP Direct Search Request Error]: ${err.message}`);
      steps.push(`Direct HTTP Engine failed: ${err.message}`);
      resolve([]);
    });

    req.setTimeout(8000, () => {
      req.destroy();
      resolve([]);
    });

    req.write(postData);
    req.end();
  });
}

// Multi-Tier Pipeline Execution
async function runSearchPipeline(rawQuery, steps) {
  let browser = null;
  let filtered = [];

  const cleanQuery = sanitizeQuery(rawQuery);
  steps.push(`Query: "${cleanQuery}"`);

  let searchTarget = cleanQuery;
  if (/^(best|top)\s+/i.test(cleanQuery)) {
    searchTarget = cleanQuery.replace(/^(best|top)\s+/i, "").trim();
  }

  try {
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

    // Tier 1: Bing Scraper with searchTarget
    let scraped = await scrapeBing(page, searchTarget, steps);
    filtered = scraped.filter(item => !isJunkDomain(item.link) && isRelevantResult(item, cleanQuery));
    steps.push(`Bing Filtered results count: ${filtered.length}`);

    // Tier 2: Failsafe Bing with raw cleanQuery if < 3
    if (filtered.length < 3) {
      steps.push(`Failsafe 1: Retrying Bing with raw query: "${cleanQuery}"`);
      const retryBing = await scrapeBing(page, cleanQuery, steps);
      const newFiltered = retryBing.filter(item => !isJunkDomain(item.link) && isRelevantResult(item, cleanQuery));
      filtered = deduplicateResults([...filtered, ...newFiltered]);
      steps.push(`Failsafe 1 Filtered total: ${filtered.length}`);
    }

    // Tier 3: Google Scraper Fallback if < 3
    if (filtered.length < 3) {
      steps.push(`Failsafe 2: Triggering Google search fallback for: "${cleanQuery}"`);
      const googleScraped = await scrapeGoogle(page, cleanQuery, steps);
      const googleFiltered = googleScraped.filter(item => !isJunkDomain(item.link) && isRelevantResult(item, cleanQuery));
      filtered = deduplicateResults([...filtered, ...googleFiltered]);
      steps.push(`Failsafe 2 Filtered total: ${filtered.length}`);
    }

    // Tier 4: DuckDuckGo Scraper Fallback if < 3
    if (filtered.length < 3) {
      steps.push(`Failsafe 3: Triggering DuckDuckGo fallback for: "${cleanQuery}"`);
      const ddgScraped = await scrapeDuckDuckGo(page, cleanQuery, steps);
      const ddgFiltered = ddgScraped.filter(item => !isJunkDomain(item.link) && isRelevantResult(item, cleanQuery));
      filtered = deduplicateResults([...filtered, ...ddgFiltered]);
      steps.push(`Failsafe 3 Filtered total: ${filtered.length}`);
    }
  } catch (browserErr) {
    console.warn(`[Browser Pipeline Warning]: ${browserErr.message}`);
    steps.push(`Browser automation warning: ${browserErr.message}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  // Tier 5: Direct HTTP Light Search Fallback if < 3
  if (filtered.length < 3) {
    steps.push(`Failsafe 4: Triggering Direct HTTP Engine search fallback...`);
    const httpResults = await fetchDirectSearchFallback(cleanQuery, steps);
    const httpFiltered = httpResults.filter(item => !isJunkDomain(item.link) && isRelevantResult(item, cleanQuery));
    filtered = deduplicateResults([...filtered, ...httpFiltered]);
    steps.push(`Failsafe 4 Filtered total: ${filtered.length}`);
  }

  if (filtered.length > 0) {
    console.log(`[Debug Log] First valid result:`, JSON.stringify(filtered[0], null, 2));
    steps.push(`First valid result: "${filtered[0].title}"`);
  }

  filtered.sort((a, b) => {
    const scoreA = calculateRelevanceScore(a.title, a.snippet, cleanQuery);
    const scoreB = calculateRelevanceScore(b.title, b.snippet, cleanQuery);
    return scoreB - scoreA;
  });

  return filtered.slice(0, 5);
}

function deduplicateResults(items) {
  const seen = new Set();
  return items.filter(item => {
    if (!item.link || seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
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

  const steps = [];

  try {
    const results = await runSearchPipeline(rawQuery, steps);

    return res.status(200).json({
      success: true,
      query: rawQuery,
      engine: "Multi-Engine Search Pipeline",
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
