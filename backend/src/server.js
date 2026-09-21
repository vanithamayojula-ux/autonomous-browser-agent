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
      totalSteps: 5,
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

    // Determine target search URL (DuckDuckGo avoids CAPTCHA walls on cloud servers)
    const targetUrl = "https://duckduckgo.com";
    addLog("goto", `Navigating to ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });

    // 2. Type objective query
    addLog("type", `Typing search query: "${cleanObjective}"`);
    const searchSelector = 'input[name="q"], input[type="text"]';
    await page.waitForSelector(searchSelector, { timeout: 10000 });
    await page.fill(searchSelector, cleanObjective);
    await page.keyboard.press("Enter");

    // 3. Wait for search results
    addLog("wait", "Waiting for search results to load...");
    await page.waitForTimeout(3000);

    // 4. Extract search result titles and snippets
    addLog("extract", "Extracting result titles, snippets, and page content...");
    const pageTitle = await page.title();

    // Extract top organic result titles and links
    const results = await page.evaluate(() => {
      const items = [];
      const titleElements = document.querySelectorAll('h2, a[data-testid="result-title-a"], article h2');
      titleElements.forEach((el, index) => {
        if (index < 5) {
          const text = (el.textContent || '').trim();
          if (text && text.length > 5) items.push(text);
        }
      });
      return items;
    });

    const bodyText = await page.textContent("body");
    // Clean snippet text, stripping excessive whitespace
    const cleanSnippet = (bodyText || '')
      .replace(/\s+/g, ' ')
      .replace(/<[^>]*>/g, '')
      .trim();

    const resultListText = results.length > 0
      ? results.map((r, i) => `${i + 1}. ${r}`).join('\n')
      : `Found page title: ${pageTitle}`;

    const summary = `### Autonomous Agent Results\n\n**Objective:** "${cleanObjective}"\n\n**Top Extracted Results:**\n${resultListText}\n\n**Extracted Content Snippet:**\n${cleanSnippet.slice(0, 500)}...`;

    addLog("SUCCESS", `Execution finished in ${Date.now() - startTime}ms`);

    return res.status(200).json({
      success: true,
      objective: cleanObjective,
      title: results[0] || pageTitle,
      pageTitle,
      results,
      snippet: cleanSnippet.slice(0, 600),
      summary,
      result: `Successfully searched for "${cleanObjective}". Top result: ${results[0] || pageTitle}`,
      logs,
      plan: [
        { action: "goto", url: targetUrl },
        { action: "type", selector: searchSelector, text: cleanObjective },
        { action: "wait", durationMs: 3000 },
        { action: "extract", selector: "results" }
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
