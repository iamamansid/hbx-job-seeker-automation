import { existsSync } from "fs";
import { z } from "zod";

import { BrowserAgent } from "../browser/browser-agent";
import { config, type Config } from "../config/index";
import {
  BrowserActionSchema,
  type BrowserAction,
  type ExecutionResult,
  type Form,
  type FormField,
  type JobDescription,
  type LLMClient,
} from "../types/index";
import { logger } from "../utils/logger";
import { ProfileReasoner } from "./profile-reasoner";

const SuggestBrowserActionSchema = BrowserActionSchema.or(
  z.object({
    type: z.literal("null"),
    description: z.string(),
    selector: z.string().optional(),
    value: z.unknown().optional(),
  }),
);

export class ExecutorAgent {
  constructor(
    private readonly browserAgent: BrowserAgent,
    private readonly profileReasoner: ProfileReasoner,
    private readonly llmClient: LLMClient,
    private readonly runtimeConfig: Config = config,
  ) {}

  async executeApplication(jobUrl: string, jobDesc: JobDescription): Promise<ExecutionResult> {
    const errors: string[] = [];
    const filledFields: Record<string, string> = {};

    try {
      await this.browserAgent.launch();

      const navigated = await this.browserAgent.goto(jobUrl);
      if (!navigated) {
        throw new Error("Failed to navigate to job URL");
      }

      await this.browserAgent.waitForElement("form", 10_000).catch(() => false);
      const forms = await this.browserAgent.findForms();
      const totalFields = forms.reduce((sum, form) => sum + form.fields.length, 0);

      if (forms.length === 0) {
        throw new Error("No application forms detected on the page");
      }

      for (const form of forms) {
        await this.processForm(form, jobDesc, filledFields, errors);
      }

      await this.uploadResume(errors);

      const fillRate = this.calculateFillRate(totalFields, filledFields);
      logger.info(`Application form processed with fill rate ${fillRate}%`);

      return {
        success: true,
        message: `Application processed. Filled ${Object.keys(filledFields).length} of ${totalFields} fields.`,
        filledFields,
        totalFields,
        errors,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      logger.error("Application execution failed", { error });

      return {
        success: false,
        message,
        filledFields,
        totalFields: Object.keys(filledFields).length,
        errors,
      };
    } finally {
      await this.browserAgent.close();
    }
  }

  async suggestNextAction(pageContent: string): Promise<BrowserAction | null> {
    try {
      const prompt = `
You are guiding a browser agent through a job application form.
Review the page content and suggest the single most helpful next action.

Return valid JSON with:
- type: click | fill | select | upload | scroll | wait | navigate | null
- selector: optional CSS selector
- value: optional value
- description: short description

Page content:
${pageContent.slice(0, 2000)}
`;

      const action = await this.llmClient.generateJSON<BrowserAction | { type: "null"; description: string; selector?: string; value?: unknown }>(
        prompt,
        SuggestBrowserActionSchema,
      );
      return action.type === "null" ? null : action;
    } catch (error) {
      logger.warn("Unable to suggest next browser action", { error });
      return null;
    }
  }

  private async processForm(
    form: Form,
    jobDesc: JobDescription,
    filledFields: Record<string, string>,
    errors: string[],
  ): Promise<void> {
    logger.info(`Processing form ${form.id} with ${form.fields.length} fields`);

    for (const field of form.fields) {
      try {
        const filledValue = await this.fillFormField(field, jobDesc);
        if (filledValue) {
          filledFields[field.name] = filledValue;
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? `Failed to fill ${field.name}: ${error.message}`
            : `Failed to fill ${field.name}`;
        errors.push(message);
        logger.warn(message);
      }
    }
  }

  private async fillFormField(field: FormField, jobDesc: JobDescription): Promise<string | null> {
    const fieldKey = `${field.name} ${field.label ?? ""}`.toLowerCase();
    const selector = field.selector ?? this.fallbackSelector(field);
    let value: string | null = null;

    if (!selector) {
      return null;
    }

    if (fieldKey.includes("resume") || fieldKey.includes("cv") || field.type === "file") {
      return null;
    }

    if (fieldKey.includes("name")) {
      value = this.runtimeConfig.candidate.name;
    } else if (fieldKey.includes("email")) {
      value = this.runtimeConfig.candidate.email;
    } else if (fieldKey.includes("phone") || field.type === "tel") {
      value = this.runtimeConfig.candidate.phone;
    } else if (fieldKey.includes("linkedin")) {
      value = this.runtimeConfig.candidate.linkedInUrl;
    } else if (fieldKey.includes("portfolio") || fieldKey.includes("website")) {
      value = this.runtimeConfig.candidate.portfolioUrl || null;
    } else if (fieldKey.includes("location") || fieldKey.includes("city")) {
      value = this.runtimeConfig.candidate.currentLocation || this.runtimeConfig.search.targetCountry;
    } else if (fieldKey.includes("sponsor") || fieldKey.includes("visa")) {
      value = this.runtimeConfig.candidate.requiresSponsorship ? "Yes" : "No";
      return this.handleChoiceField(field, selector, value);
    } else if (fieldKey.includes("relocat") || fieldKey.includes("move")) {
      value = this.runtimeConfig.candidate.willingToRelocate ? "Yes" : "No";
      return this.handleChoiceField(field, selector, value);
    } else if (fieldKey.includes("experience")) {
      value = `${this.runtimeConfig.candidate.yearsOfExperience}`;
    } else if (
      fieldKey.includes("why") ||
      fieldKey.includes("motivation") ||
      fieldKey.includes("interest") ||
      fieldKey.includes("cover")
    ) {
      value = await this.profileReasoner.generateAnswer(field.label ?? field.name, jobDesc);
    } else if (fieldKey.includes("salary")) {
      value =
        (await this.profileReasoner.inferMissingInfo(jobDesc)).inferredSalaryExpectation ??
        "AUD 100,000 - 120,000";
    } else if (field.required) {
      value = await this.profileReasoner.generateAnswer(
        `Provide a concise application response for the field "${field.label ?? field.name}"`,
        jobDesc,
      );
    }

    if (!value) {
      return null;
    }

    if (field.type === "select") {
      return this.handleChoiceField(field, selector, value);
    }

    if (field.type === "checkbox" || field.type === "radio") {
      return this.handleChoiceField(field, selector, value);
    }

    const filled = await this.browserAgent.fillField(selector, value);
    return filled ? value : null;
  }

  private async handleChoiceField(field: FormField, selector: string, value: string): Promise<string | null> {
    if (field.type === "select") {
      const selectedValue =
        field.options?.find((option) => option.toLowerCase().includes(value.toLowerCase())) ?? value;
      const selected = await this.browserAgent.selectOption(selector, selectedValue);
      return selected ? selectedValue : null;
    }

    const clicked = await this.browserAgent.click(selector);
    return clicked ? value : null;
  }

  private async uploadResume(errors: string[]): Promise<void> {
    const resumePath = this.runtimeConfig.candidate.resumePath;
    if (!existsSync(resumePath)) {
      logger.warn(`Resume file not found at ${resumePath}`);
      return;
    }

    const uploaded = await this.browserAgent.uploadFile('input[type="file"]', resumePath);
    if (!uploaded) {
      errors.push("Resume upload was not completed");
    }
  }

  private fallbackSelector(field: FormField): string | null {
    if (field.name) {
      const tag = field.type === "textarea" ? "textarea" : field.type === "select" ? "select" : "input";
      return `${tag}[name="${field.name.replace(/"/g, '\\"')}"]`;
    }

    return null;
  }

  private calculateFillRate(totalFields: number, filledFields: Record<string, string>): number {
    if (totalFields === 0) {
      return 0;
    }

    return Math.round((Object.keys(filledFields).length / totalFields) * 100);
  }
}
