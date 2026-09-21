const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();

app.use(cors());
app.use(express.json());

// Health route
app.get("/", (req, res) => {
  res.send("Backend is running");
});

// Main API route
app.post("/run-task", async (req, res) => {
  const { objective } = req.body || {};

  if (!objective || typeof objective !== "string" || !objective.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid "objective" string in request body.'
    });
  }

  let browser = null;

  try {
    console.log(`[POST /run-task] Objective: "${objective}"`);

    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Open Google
    await page.goto("https://www.google.com", { waitUntil: "domcontentloaded", timeout: 20000 });

    // 2. Search the objective
    const searchSelector = 'textarea[name="q"], input[name="q"]';
    await page.waitForSelector(searchSelector, { timeout: 10000 });
    await page.fill(searchSelector, objective);
    await page.keyboard.press("Enter");

    // 3. Wait for search results
    await page.waitForTimeout(2000);

    // 4. Return first result title / page title
    const pageTitle = await page.title();
    
    // Attempt to extract first result title if available
    let firstResultTitle = pageTitle;
    try {
      const h3Element = await page.$("h3");
      if (h3Element) {
        const h3Text = await h3Element.textContent();
        if (h3Text && h3Text.trim()) {
          firstResultTitle = h3Text.trim();
        }
      }
    } catch (e) {
      // Fallback to page title
    }

    return res.status(200).json({
      success: true,
      objective,
      title: firstResultTitle,
      pageTitle
    });
  } catch (err) {
    console.error(`[Execution Error]: ${err.message}`);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
      console.log("[Playwright] Browser closed safely.");
    }
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
