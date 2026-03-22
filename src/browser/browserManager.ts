import { chromium, type Browser, type BrowserContext } from "playwright";

import { seekConfig } from "../config/config";
import { logger } from "../utils/logger";

export class BrowserManager {
  async launchBrowser(): Promise<Browser> {
    try {
      logger.info("Launching Playwright Chromium browser", {
        headless: seekConfig.browser.headless,
      });

      return await chromium.launch({
        headless: seekConfig.browser.headless,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
        ],
        ignoreDefaultArgs: ["--enable-automation"],
      });
    } catch (error) {
      logger.error("Failed to launch Chromium", { error });
      throw error;
    }
  }

  async createStealthContext(
    browser: Browser,
    storageStatePath?: string,
  ): Promise<BrowserContext> {
    try {
      const context = await browser.newContext({
        userAgent: seekConfig.browser.userAgent,
        viewport: seekConfig.browser.viewport,
        locale: seekConfig.browser.locale,
        timezoneId: seekConfig.browser.timezoneId,
        geolocation: seekConfig.browser.geolocation,
        permissions: ["geolocation"],
        extraHTTPHeaders: { "Accept-Language": seekConfig.browser.acceptLanguage },
        storageState: storageStatePath ?? undefined,
      });

      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });

        Object.defineProperty(navigator, "languages", {
          get: () => ["en-AU", "en"],
        });

        Object.defineProperty(navigator, "plugins", {
          get: () => [1, 2, 3, 4, 5],
        });

        (window as Window & { chrome?: Record<string, unknown> }).chrome = {
          runtime: {},
        };
      });

      return context;
    } catch (error) {
      logger.error("Failed to create stealth browser context", { error });
      throw error;
    }
  }
}

export const browserManager = new BrowserManager();
export const createStealthContext = async (
  browser: Browser,
  storageStatePath?: string,
): Promise<BrowserContext> => browserManager.createStealthContext(browser, storageStatePath);
