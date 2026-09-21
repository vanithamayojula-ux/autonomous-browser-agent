const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

// Health check endpoint for Render
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "backend" });
});

app.get("/", (req, res) => {
  res.json({ message: "Backend API is running" });
});

// Main endpoint
app.post("/run-task", async (req, res) => {
  const { objective } = req.body || {};

  if (!objective || typeof objective !== "string" || !objective.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid "objective" in request body.'
    });
  }

  let browser = null;

  try {
    console.log(`[POST /run-task] Running objective: "${objective}"`);

    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Navigate to Google
    await page.goto("https://www.google.com", { waitUntil: "domcontentloaded", timeout: 20000 });

    // 2. Type search query
    const searchSelector = 'textarea[name="q"], input[name="q"]';
    await page.waitForSelector(searchSelector, { timeout: 10000 });
    await page.fill(searchSelector, objective);
    await page.keyboard.press("Enter");

    // 3. Wait brief moment for results
    await page.waitForTimeout(2000);

    // 4. Extract page title and content snippet
    const pageTitle = await page.title();
    const bodyText = await page.textContent("body");
    const snippet = (bodyText || "").replace(/\s+/g, " ").trim().slice(0, 500);

    return res.status(200).json({
      success: true,
      objective,
      title: pageTitle,
      snippet,
      result: `Successfully searched for "${objective}". Page title: ${pageTitle}`
    });
  } catch (err) {
    console.error(`[Task Error]: ${err.message}`);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  } finally {
    // ALWAYS close browser
    if (browser) {
      await browser.close().catch(() => {});
      console.log("[Playwright] Browser closed safely.");
    }
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});
