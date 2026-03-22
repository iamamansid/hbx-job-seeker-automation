import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type LaunchOptions,
  type Page,
} from "playwright";

import type { Config } from "../config/index";
import { logger } from "../utils/logger";

export class BrowserLifecycleManager {
  private static instance: BrowserLifecycleManager | null = null;

  static getInstance(config: Config): BrowserLifecycleManager {
    if (!BrowserLifecycleManager.instance) {
      BrowserLifecycleManager.instance = new BrowserLifecycleManager(config);
    }

    return BrowserLifecycleManager.instance;
  }

  private browser: Browser | null = null;
  private readonly contexts = new Set<BrowserContext>();
  private readonly pages = new Set<Page>();

  private constructor(private readonly config: Config) {}

  async getBrowser(): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }

    const launchOptions: LaunchOptions = {
      headless: this.config.browser.headless,
      slowMo: this.config.browser.slowMo,
    };

    logger.info("Launching shared Playwright browser instance");
    this.browser = await chromium.launch(launchOptions);
    return this.browser;
  }

  async createContext(options: BrowserContextOptions = {}): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent: this.config.browser.userAgent,
      viewport: { width: 1440, height: 960 },
      ...options,
    });

    this.contexts.add(context);
    context.on("close", () => {
      this.contexts.delete(context);
    });

    return context;
  }

  async createPage(
    contextOptions: BrowserContextOptions = {},
  ): Promise<{ context: BrowserContext; page: Page }> {
    const context = await this.createContext(contextOptions);
    const page = await context.newPage();
    this.pages.add(page);

    page.on("close", () => {
      this.pages.delete(page);
    });

    page.setDefaultTimeout(this.config.browser.timeout);
    page.setDefaultNavigationTimeout(this.config.browser.timeout);

    return { context, page };
  }

  async closePage(page: Page | null): Promise<void> {
    if (!page || page.isClosed()) {
      return;
    }

    await page.close().catch((error: unknown) => {
      logger.warn("Failed to close page", { error });
    });
  }

  async closeContext(context: BrowserContext | null): Promise<void> {
    if (!context) {
      return;
    }

    await context.close().catch((error: unknown) => {
      logger.warn("Failed to close browser context", { error });
    });
  }

  async closeAll(): Promise<void> {
    for (const page of [...this.pages]) {
      await this.closePage(page);
    }

    for (const context of [...this.contexts]) {
      await this.closeContext(context);
    }

    if (this.browser) {
      await this.browser.close().catch((error: unknown) => {
        logger.warn("Failed to close shared browser", { error });
      });
      this.browser = null;
    }
  }
}
