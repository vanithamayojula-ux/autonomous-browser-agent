/**
 * Playwright Execution Engine (Cloud Hardened for Render)
 */

const { chromium } = require('playwright');
const { createLogger } = require('./utils/logger');

async function executeSteps(steps) {
  const logger = createLogger();
  const extractedData = [];
  let browser = null;
  let context = null;
  let page = null;

  try {
    logger.log('BROWSER_INIT', 'Launching Playwright Chromium in headless cloud mode...', 'RUNNING', 0, steps.length);

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    page = await context.newPage();
    page.setDefaultNavigationTimeout(20000);
    page.setDefaultTimeout(10000);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepNum = i + 1;

      try {
        switch (step.action) {
          case 'goto': {
            if (!step.url) throw new Error('Missing URL for goto action');
            logger.log('goto', `Navigating to ${step.url}`, 'RUNNING', stepNum, steps.length);
            await page.goto(step.url, { waitUntil: 'domcontentloaded' });
            const title = await page.title();
            logger.log('goto', `Successfully loaded ${step.url} (Title: ${title})`, 'SUCCESS', stepNum, steps.length);
            break;
          }

          case 'type': {
            if (!step.selector || step.text === undefined) throw new Error('Missing selector or text for type action');
            logger.log('type', `Typing "${step.text}" into ${step.selector}`, 'RUNNING', stepNum, steps.length);
            await page.waitForSelector(step.selector, { state: 'visible', timeout: 8000 });
            await page.fill(step.selector, step.text);
            if (step.pressEnter || step.selector.includes('name="q"') || step.selector.includes('search')) {
              await page.keyboard.press('Enter');
            }
            logger.log('type', `Typed text into ${step.selector}`, 'SUCCESS', stepNum, steps.length);
            break;
          }

          case 'click': {
            if (!step.selector) throw new Error('Missing selector for click action');
            logger.log('click', `Clicking ${step.selector}`, 'RUNNING', stepNum, steps.length);
            await page.waitForSelector(step.selector, { state: 'visible', timeout: 8000 });
            await page.click(step.selector);
            logger.log('click', `Clicked ${step.selector}`, 'SUCCESS', stepNum, steps.length);
            break;
          }

          case 'wait': {
            const ms = step.durationMs || 2000;
            logger.log('wait', `Waiting ${ms}ms`, 'RUNNING', stepNum, steps.length);
            await page.waitForTimeout(ms);
            logger.log('wait', `Completed wait of ${ms}ms`, 'SUCCESS', stepNum, steps.length);
            break;
          }

          case 'extract': {
            const selector = step.selector || 'body';
            logger.log('extract', `Extracting text from ${selector}`, 'RUNNING', stepNum, steps.length);
            const content = await page.textContent(selector);
            const cleaned = (content || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
            if (cleaned) {
              extractedData.push(cleaned);
            }
            logger.log('extract', `Extracted ${cleaned.length} characters from ${selector}`, 'SUCCESS', stepNum, steps.length);
            break;
          }

          default:
            logger.error(step.action, `Unknown action step`, stepNum, steps.length);
        }
      } catch (stepErr) {
        logger.error(step.action, `Step failed: ${stepErr.message}`, stepNum, steps.length);
      }
    }

    return {
      success: true,
      logs: logger.getLogs(),
      extractedData
    };
  } catch (err) {
    logger.error('BROWSER_FATAL', `Fatal execution error: ${err.message}`, 0, steps.length);
    return {
      success: false,
      logs: logger.getLogs(),
      extractedData,
      error: err.message
    };
  } finally {
    // CRITICAL CLOUD CLEANUP: Ensure browser instances are closed after every request
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    console.log('[Agent] Playwright browser instance successfully closed.');
  }
}

module.exports = { executeSteps };
