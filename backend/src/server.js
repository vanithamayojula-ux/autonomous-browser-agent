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

// Helper: Query Sanitizer to strip enclosing quotes and command prefixes
function sanitizeQuery(rawObjective) {
  if (!rawObjective) return "";
  let clean = rawObjective.trim();
  // Strip leading and trailing quotes or brackets
  clean = clean.replace(/^["'\s]+|["'\s]+$/g, "");
  // Strip command prefixes like "Search Google for", "Search for", "Find"
  clean = clean.replace(/^(?:search\s+google\s+for|search\s+for|search|find|go\s+to|open)\s+/i, "");
  return clean.trim() || rawObjective.replace(/["']/g, "").trim();
}

// Helper: Safely launch Chromium with dynamic self-healing browser installer
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

// Shared task execution logic
async function handleTaskExecution(req, res) {
  const { objective } = req.body || {};

  if (!objective || typeof objective !== "string" || !objective.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid "objective" string in request body.'
    });
  }

  const logs = [];
  const startTime = Date.now();
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
    const rawObjective = objective.trim();
    const cleanSearchTerms = sanitizeQuery(rawObjective);
    console.log(`[POST Task] Raw Objective: "${rawObjective}" -> Sanitized Search Query: "${cleanSearchTerms}"`);

    addLog("BROWSER_INIT", "Launching Playwright Chromium engine with stealth headers...");
    browser = await launchBrowserSafely();

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": "1"
      }
    });

    const page = await context.newPage();

    // 1. Primary Navigation to Search Engine (DuckDuckGo HTML)
    let searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanSearchTerms)}`;
    addLog("goto", `Navigating to search URL: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });

    let pageTitle = await page.title();
    let bodyText = (await page.textContent("body")) || "";

    // 2. Fallback check: If DuckDuckGo limits or blocks, switch to Bing Search
    if (!bodyText || bodyText.includes("If this persists, please email us") || bodyText.length < 300) {
      searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(cleanSearchTerms)}`;
      addLog("fallback", `Primary engine limited. Switching to search engine: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      pageTitle = await page.title();
      bodyText = (await page.textContent("body")) || "";
    }

    // 3. Extract organic search result titles and snippets
    addLog("extract", "Extracting result titles, snippets, and page content...");

    const searchResults = await page.evaluate(() => {
      const items = [];
      // Selectors matching both DuckDuckGo and Bing organic headers
      const links = document.querySelectorAll('.result__title a, .result__a, h2 a, .b_algo h2 a');
      const snippets = document.querySelectorAll('.result__snippet, .b_caption p, p');

      links.forEach((el, index) => {
        if (items.length < 5) {
          const title = (el.textContent || '').trim();
          const href = el.getAttribute('href') || '';
          const snippetText = snippets[index] ? (snippets[index].textContent || '').trim() : '';
          if (title && title.length > 3 && !title.toLowerCase().includes('javascript')) {
            items.push({ title, href, snippet: snippetText });
          }
        }
      });
      return items;
    });

    const cleanBodySnippet = bodyText
      .replace(/\s+/g, ' ')
      .replace(/<[^>]*>/g, '')
      .trim()
      .slice(0, 600);

    const resultListFormatted = searchResults.length > 0
      ? searchResults.map((r, i) => `**${i + 1}. ${r.title}**\n${r.snippet ? '   - ' + r.snippet : ''}`).join('\n\n')
      : `Page Title: ${pageTitle}`;

    const primaryTitle = searchResults[0]?.title || pageTitle;

    const summary = `### Autonomous Agent Results\n\n**Search Query:** "${cleanSearchTerms}"\n\n**Top Search Results:**\n${resultListFormatted}\n\n**Raw Extracted Content:**\n${cleanBodySnippet.slice(0, 500)}...`;
    const resultText = `Successfully executed query: "${cleanSearchTerms}". Found top result: ${primaryTitle}`;

    addLog("SUCCESS", `Execution finished in ${Date.now() - startTime}ms`);

    return res.status(200).json({
      success: true,
      objective: rawObjective,
      query: cleanSearchTerms,
      title: primaryTitle,
      pageTitle,
      results: searchResults,
      snippet: cleanBodySnippet,
      summary,
      result: resultText,
      logs,
      plan: [
        { action: "goto", url: searchUrl },
        { action: "extract", selector: "organic_results" }
      ]
    });
  } catch (err) {
    console.error(`[Execution Error]: ${err.message}`);
    addLog("FAILED", `Error: ${err.message}`, "FAILED");
    return res.status(500).json({
      success: false,
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

// Support both endpoint paths
app.post("/run-task", handleTaskExecution);
app.post("/api/agent/run", handleTaskExecution);

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
