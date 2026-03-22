import type { BrowserContext, Page } from "playwright";

import { config, type Config } from "../config/index";
import { type Form, type FormField } from "../types/index";
import { logger } from "../utils/logger";
import { BrowserLifecycleManager } from "./browser-lifecycle-manager";

type EvaluatedFormField = FormField;

type EvaluatedForm = Form;

export class BrowserAgent {
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(
    private readonly browserLifecycleManager: BrowserLifecycleManager,
    private readonly runtimeConfig: Config = config,
  ) {}

  async launch(): Promise<void> {
    if (this.page && !this.page.isClosed()) {
      return;
    }

    const { context, page } = await this.browserLifecycleManager.createPage();
    this.context = context;
    this.page = page;
    await page.setViewportSize({ width: 1440, height: 960 });
    logger.info("Browser agent attached to shared browser");
  }

  async goto(url: string): Promise<boolean> {
    try {
      if (!this.page) {
        throw new Error("Browser not initialized");
      }

      await this.page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.runtimeConfig.browser.timeout,
      });
      return true;
    } catch (error) {
      logger.warn(`Failed to navigate to ${url}`, { error });
      return false;
    }
  }

  async getPageContent(): Promise<string> {
    if (!this.page) {
      throw new Error("Browser not initialized");
    }

    return this.page.content();
  }

  async extractText(selector: string): Promise<string> {
    if (!this.page) {
      throw new Error("Browser not initialized");
    }

    const text = await this.page.locator(selector).first().textContent().catch(() => "");
    return text?.trim() ?? "";
  }

  async findForms(): Promise<Form[]> {
    if (!this.page) {
      throw new Error("Browser not initialized");
    }

    const forms = await this.page.evaluate((): EvaluatedForm[] => {
      const normalize = (value: string | null | undefined): string | undefined => {
        const trimmed = value?.replace(/\s+/g, " ").trim();
        return trimmed ? trimmed : undefined;
      };

      const buildSelector = (element: Element): string | undefined => {
        if (element.id) {
          return `#${CSS.escape(element.id)}`;
        }

        const name = element.getAttribute("name");
        const tagName = element.tagName.toLowerCase();
        if (name) {
          return `${tagName}[name="${CSS.escape(name)}"]`;
        }

        return undefined;
      };

      const getInlineLabel = (element: Element): string | undefined => {
        const id = element.getAttribute("id");
        if (id) {
          const explicitLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          const explicitText = normalize(explicitLabel?.textContent);
          if (explicitText) {
            return explicitText;
          }
        }

        const wrappedLabel = element.closest("label");
        const wrappedText = normalize(wrappedLabel?.textContent);
        if (wrappedText) {
          return wrappedText;
        }

        const ariaLabel = normalize(element.getAttribute("aria-label"));
        if (ariaLabel) {
          return ariaLabel;
        }

        return normalize(element.getAttribute("placeholder"));
      };

      const mapInputType = (inputType: string | null): EvaluatedFormField["type"] | null => {
        const normalized = (inputType ?? "text").toLowerCase();
        switch (normalized) {
          case "email":
          case "tel":
          case "file":
          case "number":
          case "date":
          case "checkbox":
          case "radio":
            return normalized;
          case "text":
          case "search":
          case "url":
          case "password":
            return "text";
          case "hidden":
          case "submit":
          case "button":
          case "reset":
            return null;
          default:
            return "text";
        }
      };

      return Array.from(document.querySelectorAll("form")).map((formElement, formIndex) => {
        const fields: EvaluatedFormField[] = [];
        const interactiveElements = Array.from(
          formElement.querySelectorAll("input, textarea, select"),
        );

        for (const element of interactiveElements) {
          if (element instanceof HTMLInputElement) {
            const fieldType = mapInputType(element.type);
            if (!fieldType) {
              continue;
            }

            fields.push({
              name: normalize(element.name) ?? `input_${formIndex}_${fields.length}`,
              type: fieldType,
              label: getInlineLabel(element),
              required: element.required || element.getAttribute("aria-required") === "true",
              selector: buildSelector(element),
            });
            continue;
          }

          if (element instanceof HTMLTextAreaElement) {
            fields.push({
              name: normalize(element.name) ?? `textarea_${formIndex}_${fields.length}`,
              type: "textarea",
              label: getInlineLabel(element),
              required: element.required || element.getAttribute("aria-required") === "true",
              selector: buildSelector(element),
            });
            continue;
          }

          if (element instanceof HTMLSelectElement) {
            fields.push({
              name: normalize(element.name) ?? `select_${formIndex}_${fields.length}`,
              type: "select",
              label: getInlineLabel(element),
              required: element.required || element.getAttribute("aria-required") === "true",
              options: Array.from(element.options)
                .map((option) => normalize(option.textContent))
                .filter((option): option is string => Boolean(option)),
              selector: buildSelector(element),
            });
          }
        }

        const submitButton = formElement.querySelector(
          "button[type='submit'], input[type='submit']",
        );

        return {
          id: formElement.id || `form_${formIndex}`,
          fields,
          submitButtonSelector: submitButton ? buildSelector(submitButton) : undefined,
        };
      });
    });

    logger.info(`Detected ${forms.length} form(s) on page`);
    return forms;
  }

  async fillField(selector: string, value: string): Promise<boolean> {
    try {
      if (!this.page) {
        throw new Error("Browser not initialized");
      }

      await this.page.locator(selector).first().fill(value);
      await this.page.waitForTimeout(this.runtimeConfig.browser.slowMo);
      return true;
    } catch (error) {
      logger.warn(`Failed to fill selector ${selector}`, { error });
      return false;
    }
  }

  async click(selector: string): Promise<boolean> {
    try {
      if (!this.page) {
        throw new Error("Browser not initialized");
      }

      await this.page.locator(selector).first().click();
      await this.page.waitForTimeout(this.runtimeConfig.browser.slowMo);
      return true;
    } catch (error) {
      logger.warn(`Failed to click selector ${selector}`, { error });
      return false;
    }
  }

  async selectOption(selector: string, value: string): Promise<boolean> {
    try {
      if (!this.page) {
        throw new Error("Browser not initialized");
      }

      await this.page.locator(selector).first().selectOption({ label: value }).catch(async () => {
        await this.page?.locator(selector).first().selectOption(value);
      });
      await this.page.waitForTimeout(this.runtimeConfig.browser.slowMo);
      return true;
    } catch (error) {
      logger.warn(`Failed to select option on ${selector}`, { error });
      return false;
    }
  }

  async uploadFile(selector: string, filePath: string): Promise<boolean> {
    try {
      if (!this.page) {
        throw new Error("Browser not initialized");
      }

      await this.page.locator(selector).first().setInputFiles(filePath);
      return true;
    } catch (error) {
      logger.warn(`Failed to upload file for selector ${selector}`, { error });
      return false;
    }
  }

  async scroll(direction: "down" | "up" = "down", amount: number = 300): Promise<void> {
    if (!this.page) {
      throw new Error("Browser not initialized");
    }

    await this.page.evaluate(
      ({ dir, px }) => {
        window.scrollBy(0, dir === "down" ? px : -px);
      },
      { dir: direction, px: amount },
    );
  }

  async waitForElement(selector: string, timeout: number = 5000): Promise<boolean> {
    try {
      if (!this.page) {
        throw new Error("Browser not initialized");
      }

      await this.page.locator(selector).first().waitFor({ timeout });
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentUrl(): Promise<string> {
    if (!this.page) {
      throw new Error("Browser not initialized");
    }

    return this.page.url();
  }

  async screenshot(filename: string): Promise<void> {
    if (!this.page) {
      throw new Error("Browser not initialized");
    }

    await this.page.screenshot({ path: `./data/screenshots/${filename}` });
  }

  async close(): Promise<void> {
    await this.browserLifecycleManager.closePage(this.page);
    await this.browserLifecycleManager.closeContext(this.context);
    this.page = null;
    this.context = null;
  }
}
