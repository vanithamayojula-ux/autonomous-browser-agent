const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

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
    const cleanObjective = objective.trim();
    console.log(`[POST Task] Objective: "${cleanObjective}"`);

    addLog("BROWSER_INIT", "Launching Playwright Chromium in cloud headless mode...");
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });

    const page = await context.newPage();

    // 1. Open Google
    addLog("goto", "Navigating to https://www.google.com");
    await page.goto("https://www.google.com", { waitUntil: "domcontentloaded", timeout: 20000 });

    // 2. Search objective
    addLog("type", `Searching query: "${cleanObjective}"`);
    const searchSelector = 'textarea[name="q"], input[name="q"]';
    await page.waitForSelector(searchSelector, { timeout: 10000 });
    await page.fill(searchSelector, cleanObjective);
    await page.keyboard.press("Enter");

    // 3. Wait for search results
    addLog("wait", "Waiting for search results to load...");
    await page.waitForTimeout(2500);

    // 4. Extract search results
    addLog("extract", "Extracting result titles and page content...");
    const pageTitle = await page.title();
    
    let firstResultTitle = pageTitle;
    try {
      const h3Element = await page.$("h3");
      if (h3Element) {
        const h3Text = await h3Element.textContent();
        if (h3Text && h3Text.trim()) {
          firstResultTitle = h3Text.trim();
        }
      }
    } catch (e) {}

    const bodyText = await page.textContent("body");
    const snippet = (bodyText || "").replace(/\s+/g, " ").trim().slice(0, 800);

    const summary = `### Autonomous Agent Summary\n\n**Objective:** ${cleanObjective}\n\n**Primary Result Found:** ${firstResultTitle}\n\n**Page Title:** ${pageTitle}\n\n**Extracted Snippet:**\n${snippet.slice(0, 350)}...`;
    const resultText = `Successfully executed objective: "${cleanObjective}". Found result: ${firstResultTitle}`;

    addLog("SUCCESS", `Execution finished in ${Date.now() - startTime}ms`);

    return res.status(200).json({
      success: true,
      objective: cleanObjective,
      title: firstResultTitle,
      pageTitle,
      snippet,
      summary,
      result: resultText,
      logs,
      plan: [
        { action: "goto", url: "https://www.google.com" },
        { action: "type", selector: searchSelector, text: cleanObjective },
        { action: "wait", durationMs: 2500 },
        { action: "extract", selector: "body" }
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

// Support both endpoint paths for seamless frontend compatibility
app.post("/run-task", handleTaskExecution);
app.post("/api/agent/run", handleTaskExecution);

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
