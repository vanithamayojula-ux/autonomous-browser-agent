import { chromium, Browser, BrowserContext, Page } from 'playwright';

export interface BrowserEngineConfig {
  headless?: boolean;
  slowMoMs?: number;
  viewport?: { width: number; height: number };
}

export class BrowserEngine {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private isHeadless: boolean;

  constructor(config?: BrowserEngineConfig) {
    this.isHeadless = config?.headless ?? (process.env.HEADLESS !== 'false');
  }

  async initialize(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: this.isHeadless,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      this.page = await this.context.newPage();
    }
  }

  async goto(url: string, timeoutMs = 15000): Promise<string> {
    if (!this.page) await this.initialize();
    await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    return this.page!.title();
  }

  async type(selector: string, text: string, timeoutMs = 10000): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.waitForSelector(selector, { timeout: timeoutMs, state: 'visible' });
    await this.page.fill(selector, text);
  }

  async click(selector: string, timeoutMs = 10000): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.waitForSelector(selector, { timeout: timeoutMs, state: 'visible' });
    await this.page.click(selector);
  }

  async wait(durationMs = 2000, selector?: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    if (selector) {
      await this.page.waitForSelector(selector, { timeout: durationMs });
    } else {
      await this.page.waitForTimeout(durationMs);
    }
  }

  async extractText(selector = 'body', maxLength = 4000): Promise<string> {
    if (!this.page) throw new Error('Browser not initialized');
    const element = await this.page.$(selector);
    if (!element) return '';
    const rawText = (await element.innerText()) || '';
    return rawText.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  async takeScreenshot(): Promise<string> {
    if (!this.page) throw new Error('Browser not initialized');
    const buffer = await this.page.screenshot({ type: 'jpeg', quality: 60 });
    return buffer.toString('base64');
  }

  async close(): Promise<void> {
    if (this.page) await this.page.close().catch(() => {});
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}
