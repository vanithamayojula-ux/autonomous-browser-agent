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
      totalSteps: 3,
      action,
      status,
      detail
    });
  };

  let browser = null;

  try {
    const cleanObjective = objective.trim();
    console.log(`[POST Task] Objective: "${cleanObjective}"`);

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

    // Direct search URL navigation (100% resilient, zero input selector timeout)
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanObjective)}`;
    addLog("goto", `Navigating directly to search URL: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });

    // Extract search result titles and snippets
    addLog("extract", "Extracting result titles, snippets, and page content...");
    const pageTitle = await page.title();

    // Extract organic search result titles and snippets
    const searchResults = await page.evaluate(() => {
      const items = [];
      const links = document.querySelectorAll('.result__title a, .result__a, h2 a');
      const snippets = document.querySelectorAll('.result__snippet');
      
      links.forEach((el, index) => {
        if (index < 5) {
          const title = (el.textContent || '').trim();
          const href = el.getAttribute('href') || '';
          const snippetText = snippets[index] ? (snippets[index].textContent || '').trim() : '';
          if (title) {
            items.push({ title, href, snippet: snippetText });
          }
        }
      });
      return items;
    });

    const bodyText = await page.textContent("body");
    const cleanBodySnippet = (bodyText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);

    const resultListFormatted = searchResults.length > 0
      ? searchResults.map((r, i) => `**${i + 1}. ${r.title}**\n${r.snippet ? '   - ' + r.snippet : ''}`).join('\n\n')
      : `Page Title: ${pageTitle}`;

    const primaryTitle = searchResults[0]?.title || pageTitle;

    const summary = `### Autonomous Agent Results\n\n**Objective:** "${cleanObjective}"\n\n**Top Search Results:**\n${resultListFormatted}\n\n**Raw Extracted Content:**\n${cleanBodySnippet.slice(0, 400)}...`;
    const resultText = `Successfully executed objective: "${cleanObjective}". Found result: ${primaryTitle}`;

    addLog("SUCCESS", `Execution finished in ${Date.now() - startTime}ms`);

    return res.status(200).json({
      success: true,
      objective: cleanObjective,
      title: primaryTitle,
      pageTitle,
      results: searchResults,
      snippet: cleanBodySnippet,
      summary,
      result: resultText,
      logs,
      plan: [
        { action: "goto", url: searchUrl },
        { action: "extract", selector: ".result__title" }
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
