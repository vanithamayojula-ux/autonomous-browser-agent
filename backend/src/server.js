const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const https = require("https");
const http = require("http");

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Backend is running");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "backend" });
});

app.get("/api/agent/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "backend" });
});

function sanitizeQuery(rawQuery) {
  if (!rawQuery) return "";
  let clean = rawQuery.trim().replace(/^["'\s]+|["'\s]+$/g, "");
  clean = clean.replace(/^(?:search\s+google\s+for|search\s+for|search|find|go\s+to|open)\s+/i, "").trim();
  return clean || rawQuery.trim();
}

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

function isRelevantResult(item, rawQuery) {
  if (!item || !item.title || !item.link) return false;
  if (!item.link.startsWith('http')) return false;

  const combined = (item.title + " " + (item.snippet || "") + " " + item.link).toLowerCase();

  if (combined.includes("dictionary") || combined.includes("meaning") || combined.includes("undertaking") || combined.includes("oltana")) {
    return false;
  }

  return true;
}

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

function fetchDuckDuckGoHtmlGet(query, steps) {
  return new Promise((resolve) => {
    steps.push(`HTTP Search Engine: Executing web search for "${query}"`);
    const encoded = encodeURIComponent(query);
    const targetUrl = `https://html.duckduckgo.com/html/?q=${encoded}&kl=us-en`;

    const req = https.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const items = [];
        try {
          const blocks = data.split(/<div[^>]*class=["'](?:result|results_links)[^"']*["']/i);

          blocks.slice(1).forEach(block => {
            const titleMatch = block.match(/<a[^>]*class=["']result__a["'][^>]*>(.*?)<\/a>/i);
            const linkMatch = block.match(/href=["']([^"']+)["']/i);
            const snippetMatch = block.match(/<a[^>]*class=["']result__snippet["'][^>]*>(.*?)<\/a>/i) ||
                                 block.match(/class=["']result__snippet["'][^>]*>(.*?)<\/(?:a|td|div)>/i);

            if (titleMatch && linkMatch) {
              const title = titleMatch[1].replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
              let link = decodeSearchLink(linkMatch[1]);

              let snippet = snippetMatch 
                ? snippetMatch[1].replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim() 
                : `Top result for ${query}: ${title}`;

              if (title && link.startsWith('http') && !link.includes('duckduckgo.com')) {
                items.push({ title, link, snippet });
              }
            }
          });
        } catch (err) {
          console.warn(`[HTTP Search Parse Error]: ${err.message}`);
        }

        steps.push(`HTTP Search Engine extracted results: ${items.length}`);
        resolve(items);
      });
    });

    req.on('error', (err) => {
      console.warn(`[HTTP Search Request Error]: ${err.message}`);
      steps.push(`HTTP Search Engine failed: ${err.message}`);
      resolve([]);
    });

    req.setTimeout(8000, () => {
      req.destroy();
      resolve([]);
    });
  });
}

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

async function scrapeBing(page, query, steps) {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://www.bing.com/search?q=${encodedQuery}&setlang=en-us&cc=US`;

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

  steps.push(`Total scraped results from Bing: ${scraped.length}`);
  return scraped;
}

async function runSearchPipeline(rawQuery, steps) {
  const cleanQuery = sanitizeQuery(rawQuery);
  steps.push(`Query: "${cleanQuery}"`);

  let httpResults = await fetchDuckDuckGoHtmlGet(cleanQuery, steps);
  let filtered = httpResults.filter(item => !isJunkDomain(item.link) && isRelevantResult(item, cleanQuery));
  steps.push(`HTTP Search Filtered results count: ${filtered.length}`);

  if (filtered.length < 3) {
    let browser = null;
    try {
      steps.push(`Triggering Playwright browser search scraper for "${cleanQuery}"...`);
      browser = await launchBrowserSafely();
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale: "en-US",
        timezoneId: "America/New_York",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      });

      const page = await context.newPage();
      const bingScraped = await scrapeBing(page, cleanQuery, steps);
      const bingFiltered = bingScraped.filter(item => !isJunkDomain(item.link) && isRelevantResult(item, cleanQuery));
      filtered = deduplicateResults([...filtered, ...bingFiltered]);
      steps.push(`Combined Filtered total: ${filtered.length}`);
    } catch (browserErr) {
      console.warn(`[Browser Pipeline Warning]: ${browserErr.message}`);
      steps.push(`Browser automation warning: ${browserErr.message}`);
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  if (filtered.length > 0) {
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

app.post("/execute", handleTaskExecution);
app.post("/run-task", handleTaskExecution);
app.post("/api/agent/run", handleTaskExecution);

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
