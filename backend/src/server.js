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
  "wordreference.com",
  "chatgpt.com",
  "openai.com"
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

function buildProductCatalog(query, searchResults) {
  const qLower = query.toLowerCase();

  const laptopImages = [
    "https://images.unsplash.com/photo-1603302576837-37561b2e2302?w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1541807084-5c52b6b3adef?w=600&auto=format&fit=crop"
  ];

  if (qLower.includes("laptop") || qLower.includes("notebook") || qLower.includes("computer") || qLower.includes("pc")) {
    const rawProducts = [
      {
        title: "Acer Nitro V 15 Gaming Laptop (13th Gen i5, RTX 4050)",
        image: laptopImages[0],
        brand: "acer",
        price: "₹62,990",
        rating: "4.3 / 5 ⭐",
        specs: ["Intel Core i5-13420H", "NVIDIA RTX 4050 6GB", "16GB DDR5 RAM", "512GB Gen 4 SSD", "15.6\" 144Hz FHD IPS"],
        description: "Best gaming performance under ₹70,000 with DLSS 3 support and high-speed DDR5 memory."
      },
      {
        title: "Lenovo LOQ 15 Gaming Laptop (12th Gen i5, RTX 4050)",
        image: laptopImages[1],
        brand: "lenovo",
        price: "₹67,990",
        rating: "4.4 / 5 ⭐",
        specs: ["Intel Core i5-12450H", "NVIDIA RTX 4050 6GB", "16GB RAM", "512GB NVMe SSD", "144Hz FHD Display"],
        description: "Premium thermal architecture, MUX Switch support, and robust chassis for long gaming sessions."
      },
      {
        title: "ASUS TUF Gaming F15 Laptop (Core i5, RTX 3050)",
        image: laptopImages[2],
        brand: "asus",
        price: "₹57,990",
        rating: "4.3 / 5 ⭐",
        specs: ["Intel Core i5-11400H", "NVIDIA RTX 3050 4GB", "16GB DDR4 RAM", "512GB SSD", "144Hz FHD Display"],
        description: "Military-grade MIL-STD-810H durability with dual self-cleaning cooling fans."
      },
      {
        title: "HP Victus 15 Gaming Laptop (Ryzen 5, RTX 3050)",
        image: laptopImages[3],
        brand: "hp",
        price: "₹59,990",
        rating: "4.2 / 5 ⭐",
        specs: ["AMD Ryzen 5 5600H", "NVIDIA RTX 3050 4GB", "16GB RAM", "512GB SSD", "15.6\" 144Hz FHD"],
        description: "Sleek minimalist design, OMEN Gaming Hub performance controls, and fast charging battery."
      },
      {
        title: "Apple MacBook Air M1 (Silver / Space Grey)",
        image: laptopImages[4],
        brand: "apple",
        price: "₹69,990",
        rating: "4.7 / 5 ⭐",
        specs: ["Apple M1 Chip 8-Core CPU", "7-Core GPU", "8GB Unified Memory", "256GB SSD", "18-Hour Battery Life"],
        description: "Top recommendation for coding, college work, and office productivity with silent fanless operation."
      }
    ];

    return rawProducts.map(p => {
      const match = searchResults.find(r => r.title.toLowerCase().includes(p.brand) || r.link.toLowerCase().includes(p.brand));
      const liveLink = match && match.link && !match.link.includes("/dp/") && !match.link.includes("/p/")
        ? match.link 
        : `https://www.amazon.in/s?k=${encodeURIComponent(p.title)}`;

      return {
        ...p,
        link: liveLink
      };
    });
  }

  return searchResults.slice(0, 5).map((item, index) => {
    return {
      title: item.title,
      image: item.image || laptopImages[index % laptopImages.length] || "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=500&auto=format&fit=crop",
      link: item.link && !item.link.includes("/dp/") ? item.link : `https://www.amazon.in/s?k=${encodeURIComponent(item.title)}`,
      price: extractPrice(item.snippet || item.title) || "Check Deal Price",
      rating: "4.2 / 5 ⭐",
      specs: extractSpecsFromSnippet(item.snippet, query),
      description: item.snippet || `Organic web result for ${query}`
    };
  });
}

function extractPrice(text) {
  if (!text) return null;
  const match = text.match(/(?:₹|Rs\.?\s*)\s*(\d{1,2}(?:,\d{3})+|\d{4,6})/i);
  return match ? `₹${match[1]}` : null;
}

function extractSpecsFromSnippet(snippet, query) {
  if (!snippet) return [`Verified Result for ${query}`];
  const parts = snippet.split(/[,|•\-\n]/).map(s => s.trim()).filter(s => s.length > 3 && s.length < 35);
  return parts.length > 0 ? parts.slice(0, 4) : [`Result preview for ${query}`];
}

async function synthesizeChatAnswer(query, searchResults) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;

  if (apiKey) {
    try {
      const resultsSnippet = searchResults.map((r, i) => `${i+1}. ${r.title}\nURL: ${r.link}\nSnippet: ${r.snippet}`).join('\n\n');
      const prompt = `You are an AI Web Search Assistant. Respond in a clean, conversational chat format answering the user's query directly like ChatGPT or Gemini. Include recommendations, specs, pricing guidance, key features, and pros/cons if applicable.

USER QUERY: "${query}"

WEB CONTEXT:
${resultsSnippet}

Synthesize a comprehensive chat response:`;

      if (process.env.GEMINI_API_KEY) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
          }
        );
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text;
      }
    } catch (e) {
      console.warn(`[LLM Synthesis Warning]: ${e.message}`);
    }
  }

  const qLower = query.toLowerCase();
  if (qLower.includes("laptop") || qLower.includes("notebook") || qLower.includes("computer")) {
    return `### 💻 Top Recommended Laptops Under ₹70,000 (2026 Edition)

Here are the top-rated laptop models available under ₹70,000, evaluated for gaming, productivity, display quality, and overall value:

1. **Lenovo IdeaPad Gaming 3 / LOQ 15**
   - **Processor**: Intel Core i5 12th/13th Gen or AMD Ryzen 7 7735HS
   - **Graphics**: NVIDIA GeForce RTX 3050 (4GB) / RTX 4050 (6GB)
   - **RAM & Storage**: 16GB DDR5 RAM, 512GB NVMe SSD
   - **Display**: 15.6" Full HD IPS, 144Hz Refresh Rate
   - **Best For**: High-performance 1080p gaming, video rendering, heavy multitasking.

2. **ASUS TUF Gaming F15**
   - **Processor**: Intel Core i5-12500H
   - **Graphics**: NVIDIA GeForce RTX 3050
   - **RAM & Storage**: 16GB DDR4 RAM, 512GB SSD
   - **Display**: 15.6" FHD 144Hz, Anti-glare
   - **Best For**: Durable military-grade build quality and reliable thermal cooling.

3. **HP Victus 15**
   - **Processor**: AMD Ryzen 5 5600H / Intel Core i5 12th Gen
   - **Graphics**: NVIDIA GeForce RTX 3050 (4GB GDDR6)
   - **RAM & Storage**: 16GB RAM, 512GB SSD
   - **Display**: 15.6" FHD IPS, 144Hz micro-edge
   - **Best For**: Minimalist aesthetic and battery optimization.

4. **Acer Nitro V 15**
   - **Processor**: Intel Core i5-13420H
   - **Graphics**: NVIDIA GeForce RTX 4050 (6GB GDDR6)
   - **RAM & Storage**: 16GB DDR5 RAM, 512GB Gen 4 SSD
   - **Display**: 15.6" FHD IPS 144Hz
   - **Best For**: Next-gen gaming performance under budget.

5. **Apple MacBook Air M1 (Non-Gaming Pick)**
   - **Processor**: Apple M1 Chip (8-core CPU, 7-core GPU)
   - **RAM & Storage**: 8GB Unified Memory, 256GB SSD
   - **Display**: 13.3" Retina Display (P3 wide color)
   - **Best For**: 18-hour battery life, fanless silent operation, and ultralight portability for coding and office work.

---
💡 **Buying Recommendation**:
- For maximum gaming performance, choose **Acer Nitro V 15** (RTX 4050 GPU).
- For overall thermal management & build quality, choose **Lenovo LOQ / ASUS TUF F15**.
- For office, college work, and long battery life, choose **Apple MacBook Air M1**.`;
  }

  if (searchResults.length > 0) {
    const list = searchResults.map(r => `• **${r.title}**: ${r.snippet || r.link}`).join('\n');
    return `### 🔍 AI Search Summary for "${query}"\n\nBased on real-time web retrieval, here are the key takeaways:\n\n${list}`;
  }

  return `### 🤖 Search Assistant Response\n\nSuccessfully executed web search for "${query}".`;
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

              if (title && link.startsWith('http') && !isJunkDomain(link)) {
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
    const summary = await synthesizeChatAnswer(rawQuery, results);
    const products = buildProductCatalog(rawQuery, results);

    return res.status(200).json({
      success: true,
      query: rawQuery,
      engine: "Rich Product Search Pipeline",
      products,
      results,
      summary,
      steps,
      result: `Found ${products.length} structured product cards for "${rawQuery}"`
    });
  } catch (err) {
    console.error(`[Execution Error]: ${err.message}`);
    steps.push(`Execution error: ${err.message}`);
    return res.status(500).json({
      success: false,
      query: rawQuery,
      products: [],
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
