import { chromium, Page, Browser, BrowserContext } from "playwright";
import { config } from "../config/index";
import logger from "../utils/logger";
import { FormField, Form } from "../types/index";

export class BrowserAgent {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async launch(): Promise<void> {
    try {
      logger.info("Launching browser...");
      this.browser = await chromium.launch({
        headless: config.browser.headless,
      });

      this.context = await this.browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });

      this.page = await this.context.newPage();

      // Set viewport
      await this.page.setViewportSize({ width: 1920, height: 1080 });

      logger.info("Browser launched successfully");
    } catch (error) {
      logger.error("Failed to launch browser:", error);
      throw error;
    }
  }

  async goto(url: string): Promise<boolean> {
    try {
      if (!this.page) throw new Error("Browser not initialized");

      logger.info(`Navigating to: ${url}`);
      await this.page.goto(url, { waitUntil: "networkidle", timeout: config.browser.timeout });
      logger.info("Page loaded successfully");
      return true;
    } catch (error) {
      logger.error(`Failed to navigate to ${url}:`, error);
      return false;
    }
  }

  async getPageContent(): Promise<string> {
    if (!this.page) throw new Error("Browser not initialized");
    return this.page.content();
  }

  async extractText(selector: string): Promise<string> {
    try {
      if (!this.page) throw new Error("Browser not initialized");
      const text = await this.page.textContent(selector);
      return text || "";
    } catch (error) {
      logger.warn(`Failed to extract text from ${selector}:`, error);
      return "";
    }
  }

  /**
   * Find all forms on page
   */
  async findForms(): Promise<Form[]> {
    try {
      if (!this.page) throw new Error("Browser not initialized");

      const forms: Form[] = [];
      const formElements = await this.page.locator("form").all();

      for (let i = 0; i < formElements.length; i++) {
        const form = formElements[i];
        const fields: FormField[] = [];

        // Get all input fields
        const inputs = await form.locator("input").all();
        for (const input of inputs) {
          const name = await input.getAttribute("name");
          const type = (await input.getAttribute("type")) || "text";
          const required = (await input.getAttribute("required")) !== null;
          const label = await this.getFieldLabel(name || "");

          fields.push({
            name: name || `field_${i}`,
            type: type as any,
            required,
            label,
          });
        }

        // Get all textareas
        const textareas = await form.locator("textarea").all();
        for (const textarea of textareas) {
          const name = await textarea.getAttribute("name");
          const required = (await textarea.getAttribute("required")) !== null;
          const label = await this.getFieldLabel(name || "");

          fields.push({
            name: name || `textarea_${i}`,
            type: "textarea",
            required,
            label,
          });
        }

        // Get all selects
        const selects = await form.locator("select").all();
        for (const select of selects) {
          const name = await select.getAttribute("name");
          const required = (await select.getAttribute("required")) !== null;
          const label = await this.getFieldLabel(name || "");
          const options = await select.locator("option").allTextContents();

          fields.push({
            name: name || `select_${i}`,
            type: "select",
            required,
            label,
            options,
          });
        }

        forms.push({
          id: `form_${i}`,
          fields,
          submitButtonSelector: (await form.locator('button[type="submit"], input[type="submit"]').first().isVisible())
            ? (await form.locator('button[type="submit"], input[type="submit"]').first().getAttribute("class")) || undefined
            : undefined,
        });
      }

      logger.info(`Found ${forms.length} forms on page`);
      return forms;
    } catch (error) {
      logger.error("Failed to find forms:", error);
      return [];
    }
  }

  /**
   * Get label for form field
   */
  private async getFieldLabel(fieldName: string): Promise<string | undefined> {
    try {
      if (!this.page) return undefined;
      const label = await this.page.locator(`label[for="${fieldName}"]`).textContent();
      return label || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Fill a text field
   */
  async fillField(selector: string, value: string, delay: number = 50): Promise<boolean> {
    try {
      if (!this.page) throw new Error("Browser not initialized");

      logger.debug(`Filling field ${selector} with value: ${value.substring(0, 50)}...`);
      await this.page.locator(selector).fill(value);

      // Simulate human typing with small delay
      if (delay > 0) {
        await this.page.waitForTimeout(delay);
      }

      return true;
    } catch (error) {
      logger.warn(`Failed to fill field ${selector}:`, error);
      return false;
    }
  }

  /**
   * Click an element
   */
  async click(selector: string): Promise<boolean> {
    try {
      if (!this.page) throw new Error("Browser not initialized");

      logger.debug(`Clicking element: ${selector}`);
      await this.page.locator(selector).click();
      await this.page.waitForTimeout(config.browser.slowMo);
      return true;
    } catch (error) {
      logger.warn(`Failed to click ${selector}:`, error);
      return false;
    }
  }

  /**
   * Select option from dropdown
   */
  async selectOption(selector: string, value: string): Promise<boolean> {
    try {
      if (!this.page) throw new Error("Browser not initialized");

      logger.debug(`Selecting ${value} from ${selector}`);
      await this.page.locator(selector).selectOption(value);
      await this.page.waitForTimeout(config.browser.slowMo);
      return true;
    } catch (error) {
      logger.warn(`Failed to select option from ${selector}:`, error);
      return false;
    }
  }

  /**
   * Upload file
   */
  async uploadFile(selector: string, filePath: string): Promise<boolean> {
    try {
      if (!this.page) throw new Error("Browser not initialized");

      logger.info(`Uploading file: ${filePath} to ${selector}`);
      const fileInput = this.page.locator(selector).first();

      // Check if element exists
      if (!(await fileInput.isVisible({ timeout: 5000 }))) {
        // Try to find in iframes
        const frames = this.page.frames();
        for (const frame of frames) {
          const frameFileInput = frame.locator(selector).first();
          if (await frameFileInput.isVisible({ timeout: 5000 })) {
            await frameFileInput.setInputFiles(filePath);
            logger.info("File uploaded from iframe");
            return true;
          }
        }
      }

      await fileInput.setInputFiles(filePath);
      logger.info("File uploaded successfully");
      return true;
    } catch (error) {
      logger.warn(`Failed to upload file to ${selector}:`, error);
      return false;
    }
  }

  /**
   * Scroll page
   */
  async scroll(direction: "down" | "up" = "down", amount: number = 3): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");

    // Use page's native scroll method
    await this.page.keyboard.down("End");
    await this.page.waitForTimeout(500);
  }

  /**
   * Wait for element
   */
  async waitForElement(selector: string, timeout: number = 5000): Promise<boolean> {
    try {
      if (!this.page) throw new Error("Browser not initialized");
      await this.page.locator(selector).waitFor({ timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current URL
   */
  async getCurrentUrl(): Promise<string> {
    if (!this.page) throw new Error("Browser not initialized");
    return this.page.url();
  }

  /**
   * Take screenshot for debugging
   */
  async screenshot(filename: string): Promise<void> {
    try {
      if (!this.page) throw new Error("Browser not initialized");
      await this.page.screenshot({ path: `./data/screenshots/${filename}` });
      logger.info(`Screenshot saved: ${filename}`);
    } catch (error) {
      logger.warn(`Failed to take screenshot:`, error);
    }
  }

  /**
   * Close browser
   */
  async close(): Promise<void> {
    try {
      if (this.browser) {
        await this.browser.close();
        logger.info("Browser closed");
      }
    } catch (error) {
      logger.error("Failed to close browser:", error);
    }
  }
}

export default BrowserAgent;
