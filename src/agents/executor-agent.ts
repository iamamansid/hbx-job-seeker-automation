import BrowserAgent from "../browser/browser-agent";
import ProfileReasoner from "./profile-reasoner";
import logger from "../utils/logger";
import OllamaClient from "../llm/ollama-client";
import { JobDescription, FormField, Form, BrowserAction } from "../types/index";
import { config } from "../config/index";

export class ExecutorAgent {
  private browser: BrowserAgent;
  private reasoner: ProfileReasoner;
  private llm: OllamaClient;

  constructor() {
    this.browser = new BrowserAgent();
    this.reasoner = new ProfileReasoner();
    this.llm = new OllamaClient();
  }

  /**
   * Execute application workflow
   */
  async executeApplication(
    jobUrl: string,
    jobDesc: JobDescription,
  ): Promise<{
    success: boolean;
    message: string;
    filledFields: Record<string, string>;
    errors: string[];
  }> {
    const errors: string[] = [];
    const filledFields: Record<string, string> = {};

    try {
      logger.info(`Executing application for: ${jobDesc.jobTitle}`);

      // Launch browser
      await this.browser.launch();

      // Navigate to job posting
      const navigated = await this.browser.goto(jobUrl);
      if (!navigated) {
        throw new Error("Failed to navigate to job URL");
      }

      // Wait for forms to load
      const formsFound = await this.browser.waitForElement("form", 10000);
      if (!formsFound) {
        logger.warn("No forms detected on page, attempting to find them anyway");
      }

      // Find all forms
      const forms = await this.browser.findForms();
      if (forms.length === 0) {
        throw new Error("No application forms found on page");
      }

      logger.info(`Found ${forms.length} form(s) on page`);

      // Process each form
      for (let formIndex = 0; formIndex < forms.length; formIndex++) {
        const form = forms[formIndex];
        logger.info(`Processing form ${formIndex + 1}/${forms.length}`);

        for (const field of form.fields) {
          try {
            const value = await this.fillFormField(field, jobDesc);

            if (value) {
              filledFields[field.name] = value;
            }
          } catch (fieldError) {
            const errorMsg = `Failed to fill field ${field.name}: ${fieldError instanceof Error ? fieldError.message : String(fieldError)}`;
            errors.push(errorMsg);
            logger.warn(errorMsg);
          }
        }
      }

      // Upload resume if available
      try {
        const resumeUploaded = await this.uploadResume();
        if (!resumeUploaded) {
          logger.warn("Resume upload not completed (may not exist on form)");
        }
      } catch (uploadError) {
        logger.warn("Resume upload failed:", uploadError);
      }

      // Verify form completion
      const fillRate = this.calculateFillRate(forms, filledFields);
      logger.info(`Form fill rate: ${fillRate}%`);

      if (config.agent.enableAutoSubmit && fillRate > 50) {
        logger.warn("Auto-submit is ENABLED. This should only be used for testing!");
        // Safety check: require manual confirmation before submitting
        logger.info("Submission would happen here if auto-submit was fully enabled");
      } else {
        logger.info("Auto-submit is DISABLED (safeguard enabled)");
      }

      return {
        success: errors.length === 0,
        message: `Application processed. Filled ${Object.keys(filledFields).length} fields. Fill rate: ${fillRate}%`,
        filledFields,
        errors,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(errorMsg);
      logger.error("Application execution failed:", error);

      return {
        success: false,
        message: `Application failed: ${errorMsg}`,
        filledFields,
        errors,
      };
    } finally {
      await this.browser.close();
    }
  }

  /**
   * Fill a single form field
   */
  private async fillFormField(field: FormField, jobDesc: JobDescription): Promise<string | null> {
    const fieldNameLower = (field.name || "").toLowerCase();
    const fieldLabelLower = (field.label || "").toLowerCase();
    const fieldKey = fieldNameLower + fieldLabelLower;

    try {
      let value: string | null = null;

      // Match field patterns
      if (
        fieldKey.includes("resume") ||
        fieldKey.includes("attachment") ||
        fieldKey.includes("cv") ||
        fieldKey.includes("document")
      ) {
        // File upload - skip for now, handled separately
        return null;
      } else if (
        fieldKey.includes("name") &&
        (fieldKey.includes("first") || fieldKey.includes("full"))
      ) {
        value = config.candidate.name;
      } else if (fieldKey.includes("email")) {
        value = config.candidate.email;
      } else if (fieldKey.includes("phone")) {
        value = config.candidate.phone;
      } else if (fieldKey.includes("location") || fieldKey.includes("city")) {
        value = config.candidate.currentLocation;
      } else if (fieldKey.includes("linkedin")) {
        value = config.candidate.linkedInUrl;
      } else if (fieldKey.includes("portfolio") || fieldKey.includes("website")) {
        value = config.candidate.portfolioUrl;
      } else if (
        fieldKey.includes("relocat") ||
        fieldKey.includes("willing") ||
        fieldKey.includes("move")
      ) {
        value = config.candidate.willingToRelocate ? "yes" : "no";
        return await this.selectFromDropdown(field, value);
      } else if (fieldKey.includes("sponsorship") || fieldKey.includes("visa")) {
        value = config.candidate.requiresSponsorship ? "yes" : "no";
        return await this.selectFromDropdown(field, value);
      } else if (fieldKey.includes("experience")) {
        value = config.candidate.yearsOfExperience.toString();
      } else if (
        fieldKey.includes("why") ||
        fieldKey.includes("interest") ||
        fieldKey.includes("motivation")
      ) {
        // Generate dynamic answer
        const question = field.label || field.name || "Why are you interested?";
        value = await this.reasoner.generateAnswer(question, jobDesc);
      } else if (fieldKey.includes("about") || fieldKey.includes("background")) {
        value = await this.reasoner.generateAnswer("Tell us about your background", jobDesc);
      } else if (
        fieldKey.includes("skill") ||
        fieldKey.includes("technical") ||
        fieldKey.includes("proficien")
      ) {
        value = config.candidate.primarySkills.join(", ");
      } else {
        // For unknown fields, generate a contextual answer
        if (field.required) {
          const fieldDesc = field.label || field.name || "this field";
          value = await this.reasoner.generateAnswer(`What is your ${fieldDesc}?`, jobDesc);
        } else {
          // Optional field - skip
          return null;
        }
      }

      if (!value) {
        return null;
      }

      // Fill the field based on type
      if (field.type === "file") {
        // Handled separately
        return null;
      } else if (field.type === "select") {
        return await this.selectFromDropdown(field, value);
      } else if (field.type === "checkbox" || field.type === "radio") {
        return await this.selectCheckboxOrRadio(field, value);
      } else {
        // Text, textarea, email, tel, etc.
        const selector = `input[name="${field.name}"], textarea[name="${field.name}"]`;
        const filled = await this.browser.fillField(selector, value);
        return filled ? value : null;
      }
    } catch (error) {
      logger.warn(`Error filling field ${field.name}:`, error);
      return null;
    }
  }

  /**
   * Select from dropdown
   */
  private async selectFromDropdown(field: FormField, value: string): Promise<string | null> {
    try {
      const selector = `select[name="${field.name}"]`;

      if (field.options && field.options.length > 0) {
        // Find best match in options
        const lowerValue = value.toLowerCase();
        const match = field.options.find((opt) => opt.toLowerCase().includes(lowerValue));

        if (match) {
          const selected = await this.browser.selectOption(selector, match);
          return selected ? match : null;
        } else {
          // Try first option as default
          const selected = await this.browser.selectOption(selector, field.options[0]);
          return selected ? field.options[0] : null;
        }
      }

      return null;
    } catch (error) {
      logger.warn(`Error selecting dropdown for ${field.name}:`, error);
      return null;
    }
  }

  /**
   * Select checkbox or radio
   */
  private async selectCheckboxOrRadio(field: FormField, value: string): Promise<string | null> {
    try {
      const selector = `input[name="${field.name}"][value*="${value}"], input[name="${field.name}"]`;
      const clicked = await this.browser.click(selector);
      return clicked ? value : null;
    } catch (error) {
      logger.warn(`Error clicking checkbox/radio for ${field.name}:`, error);
      return null;
    }
  }

  /**
   * Upload resume
   */
  private async uploadResume(): Promise<boolean> {
    try {
      const selector = 'input[type="file"]';
      const uploaded = await this.browser.uploadFile(selector, config.candidate.resumePath);
      return uploaded;
    } catch (error) {
      logger.warn("Resume upload failed:", error);
      return false;
    }
  }

  /**
   * Calculate what percentage of form was filled
   */
  private calculateFillRate(forms: Form[], filledFields: Record<string, string>): number {
    const totalFields = forms.reduce((sum, form) => sum + form.fields.length, 0);
    if (totalFields === 0) return 0;

    const filledCount = Object.keys(filledFields).length;
    return Math.round((filledCount / totalFields) * 100);
  }

  /**
   * Get next suggested action for form
   */
  async suggestNextAction(pageContent: string): Promise<BrowserAction | null> {
    try {
      const prompt = `

Based on this webpage content, what should the automation do next to complete the job application?

Content (first 1500 chars):
${pageContent.substring(0, 1500)}

Suggest the next action. Focus on fields that haven't been filled yet. Respond with a JSON object:
{
  "type": "click|fill|select|upload|scroll",
  "selector": "CSS selector or element identifier",
  "value": "value to fill/select if applicable",
  "description": "what this action does"
}

Or null if no action is needed (form is complete).`;

      const response = await this.llm.generate(prompt);

      if (!response.success || !response.data) {
        return null;
      }

      // Try to parse as JSON
      const jsonMatch = response.data.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as BrowserAction;
      }

      return null;
    } catch (error) {
      logger.warn("Error suggesting next action:", error);
      return null;
    }
  }
}

export default ExecutorAgent;
