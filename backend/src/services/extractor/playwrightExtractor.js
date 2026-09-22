/**
 * Playwright Autonomous Search & Extraction Service
 * Hardened for Render & multi-environment module resolution
 */

const https = require("https");
const { scoreAndFilterResults } = require("./filterAndScorer");

// Safe Playwright Module Loader across root & backend subdirectories
let chromium = null;
try {
  const pw = require("playwright");
  chromium = pw.chromium;
} catch (e1) {
  try {
    const pw = require("playwright-chromium");
    chromium = pw.chromium;
  } catch (e2) {
    try {
      const pw = require("../../node_modules/playwright");
      chromium = pw.chromium;
    } catch (e3) {
      try {
        const pw = require("../node_modules/playwright");
        chromium = pw.chromium;
      } catch (e4) {
        console.warn("[Playwright Loader Warning]: Playwright module not found. Operating in HTTP mode.");
      }
    }
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
  } catch (e) {}
  return link;
}

function fetchHttpFallback(query) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(query);
    const targetUrl = `https://html.duckduckgo.com/html/?q=${encoded}&kl=us-en`;

    const req = https.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
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
            const snippetMatch = block.match(/class=["']result__snippet["'][^>]*>(.*?)<\/(?:a|td|div)>/i);

            if (titleMatch && linkMatch) {
              const title = titleMatch[1].replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
              const link = decodeSearchLink(linkMatch[1]);
              const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : `Result for ${query}`;

              if (title && link.startsWith('http')) {
                items.push({ title, link, snippet });
              }
            }
          });
        } catch (e) {}
        resolve(items);
      });
    });

    req.on('error', () => resolve([]));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve([]);
    });
  });
}

async function scrapeBingWithPlaywright(query) {
  const enhancedQuery = `${query} India 2026 reviews buying guide`;
  const encodedQuery = encodeURIComponent(enhancedQuery);
  const bingUrl = `https://www.bing.com/search?q=${encodedQuery}&setmkt=en-IN`;

  if (!chromium) {
    console.warn("[Playwright Scraper]: Chromium binary not loaded. Delegating to HTTP extraction.");
    return { rawItems: [], enhancedQuery };
  }

  let browser = null;
  const rawItems = [];

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--lang=en-US,en"
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: "en-IN",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    });

    const page = await context.newPage();
    await page.goto(bingUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});

    try {
      await page.waitForSelector('li.b_algo, .b_algo, #b_results > li', { timeout: 8000 });
    } catch (e) {}

    const items = await page.evaluate(() => {
      const rows = document.querySelectorAll('li.b_algo, div.b_algo, .b_algo, #b_results > li');
      const parsed = [];

      rows.forEach(row => {
        const titleEl = row.querySelector('h2') || row.querySelector('h2 a') || row.querySelector('a');
        const linkEl = row.querySelector('h2 a') || row.querySelector('a');
        const snippetEl = row.querySelector('.b_caption p') || row.querySelector('.b_caption') || row.querySelector('p');

        const title = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '';
        const link = linkEl ? (linkEl.href || linkEl.getAttribute('href') || '') : '';
        const snippet = snippetEl ? (snippetEl.innerText || snippetEl.textContent || '').replace(/\s+/g, ' ').trim() : '';

        if (title && link && link.startsWith('http') && !link.includes('bing.com/search')) {
          parsed.push({ title, link, snippet });
        }
      });

      return parsed;
    });

    items.forEach(item => {
      rawItems.push({
        ...item,
        link: decodeSearchLink(item.link)
      });
    });
  } catch (err) {
    console.warn(`[Playwright Extraction Warning]: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  return { rawItems, enhancedQuery };
}

async function executeAutonomousSearchPipeline(userQuery, targetCount = 5) {
  const startTime = Date.now();
  let retries = 0;
  let allRawItems = [];
  let enhancedQueryStr = `${userQuery} India 2026 reviews buying guide`;

  // 1. Primary Extraction (Playwright if available)
  const primaryResult = await scrapeBingWithPlaywright(userQuery);
  allRawItems.push(...primaryResult.rawItems);
  enhancedQueryStr = primaryResult.enhancedQuery;

  let filtered = scoreAndFilterResults(allRawItems, userQuery);

  // 2. Refinement Retry 1
  if (filtered.length < 3) {
    retries++;
    const query1 = `${userQuery} India reviews`;
    const res1 = await scrapeBingWithPlaywright(query1);
    allRawItems.push(...res1.rawItems);
    filtered = scoreAndFilterResults(allRawItems, userQuery);
  }

  // 3. Refinement Retry 2
  if (filtered.length < 3) {
    retries++;
    const query2 = `${userQuery} Amazon Flipkart`;
    const res2 = await scrapeBingWithPlaywright(query2);
    allRawItems.push(...res2.rawItems);
    filtered = scoreAndFilterResults(allRawItems, userQuery);
  }

  // 4. HTTP Extraction Fallback
  if (filtered.length < 3) {
    const httpItems = await fetchHttpFallback(userQuery);
    allRawItems.push(...httpItems);
    filtered = scoreAndFilterResults(allRawItems, userQuery);
  }

  const finalResults = filtered.slice(0, targetCount);
  const elapsedMs = Date.now() - startTime;

  return {
    query: userQuery,
    enhancedQuery: enhancedQueryStr,
    results: finalResults,
    meta: {
      elapsedMs,
      retries,
      rawCount: allRawItems.length
    }
  };
}

module.exports = {
  executeAutonomousSearchPipeline,
  scrapeBingWithPlaywright,
  fetchHttpFallback
};
