import logger from "./logger";
import { Form, FormField } from "../types/index";

/**
 * Utility to analyze and understand forms found on job application pages
 */
export class FormAnalyzer {
  /**
   * Analyze form complexity
   */
  static analyzeComplexity(form: Form): {
    fieldCount: number;
    requiredCount: number;
    fileFields: number;
    complexity: "simple" | "moderate" | "complex";
    score: number;
  } {
    const fieldCount = form.fields.length;
    const requiredCount = form.fields.filter((f) => f.required).length;
    const fileFields = form.fields.filter((f) => f.type === "file").length;

    // Scoring logic
    let score = 0;
    score += fieldCount * 5; // Base points per field
    score += requiredCount * 2; // Extra points for required fields
    score += fileFields * 10; // File fields are complex

    let complexity: "simple" | "moderate" | "complex" = "simple";
    if (score > 50) complexity = "moderate";
    if (score > 100) complexity = "complex";

    return { fieldCount, requiredCount, fileFields, complexity, score };
  }

  /**
   * Identify field types and patterns
   */
  static identifyFieldPatterns(form: Form): {
    personalInfo: FormField[];
    workInfo: FormField[];
    fileUploads: FormField[];
    openEnded: FormField[];
    choices: FormField[];
  } {
    const patterns = {
      personalInfo: [] as FormField[],
      workInfo: [] as FormField[],
      fileUploads: [] as FormField[],
      openEnded: [] as FormField[],
      choices: [] as FormField[],
    };

    for (const field of form.fields) {
      const name = (field.name || "").toLowerCase();
      const label = (field.label || "").toLowerCase();
      const key = name + label;

      if (key.includes("file") || key.includes("upload") || key.includes("cv") || key.includes("resume")) {
        patterns.fileUploads.push(field);
      } else if (
        key.includes("name") ||
        key.includes("email") ||
        key.includes("phone") ||
        key.includes("address")
      ) {
        patterns.personalInfo.push(field);
      } else if (
        key.includes("experience") ||
        key.includes("skill") ||
        key.includes("education") ||
        key.includes("job")
      ) {
        patterns.workInfo.push(field);
      } else if (field.type === "select" || field.type === "radio" || field.type === "checkbox") {
        patterns.choices.push(field);
      } else {
        patterns.openEnded.push(field);
      }
    }

    return patterns;
  }

  /**
   * Predict fill difficulty for each field
   */
  static predictFillDifficulty(
    field: FormField,
  ): {
    difficulty: "easy" | "medium" | "hard";
    strategy: string;
  } {
    const name = (field.name || "").toLowerCase();
    const label = (field.label || "").toLowerCase();
    const key = name + label;

    // Easy fields - can auto-fill
    if (
      key.includes("name") ||
      key.includes("email") ||
      key.includes("phone") ||
      key.includes("linkedin") ||
      key.includes("portfolio")
    ) {
      return { difficulty: "easy", strategy: "Auto-fill from candidate profile" };
    }

    // Medium fields - need some reasoning
    if (
      key.includes("experience") ||
      key.includes("location") ||
      key.includes("willing") ||
      key.includes("relocat") ||
      key.includes("sponsorship")
    ) {
      return { difficulty: "medium", strategy: "Use profile inference + LLM" };
    }

    // Hard fields - need contextual understanding
    if (
      key.includes("why") ||
      key.includes("interest") ||
      key.includes("cover") ||
      key.includes("about") ||
      key.includes("describe")
    ) {
      return { difficulty: "hard", strategy: "Generate contextual answer with LLM" };
    }

    // Default
    if (field.type === "file") {
      return { difficulty: "hard", strategy: "Upload file if available" };
    }

    return { difficulty: "medium", strategy: "Attempt with LLM-generated response" };
  }

  /**
   * Generate fill report
   */
  static generateFillReport(form: Form, filledFields: Record<string, string>): string {
    const analysis = this.analyzeComplexity(form);
    const patterns = this.identifyFieldPatterns(form);
    const fillRate = (Object.keys(filledFields).length / form.fields.length) * 100;

    let report = `\n${"=".repeat(60)}\n`;
    report += `FORM ANALYSIS REPORT\n`;
    report += `${"=".repeat(60)}\n\n`;

    report += `COMPLEXITY:\n`;
    report += `  - Total Fields: ${analysis.fieldCount}\n`;
    report += `  - Required Fields: ${analysis.requiredCount}\n`;
    report += `  - File Uploads: ${analysis.fileFields}\n`;
    report += `  - Complexity Level: ${analysis.complexity.toUpperCase()}\n`;
    report += `  - Complexity Score: ${analysis.score}/100\n\n`;

    report += `FIELD PATTERNS:\n`;
    report += `  - Personal Info: ${patterns.personalInfo.length} fields\n`;
    report += `  - Work Info: ${patterns.workInfo.length} fields\n`;
    report += `  - File Uploads: ${patterns.fileUploads.length} fields\n`;
    report += `  - Open-ended Q&A: ${patterns.openEnded.length} fields\n`;
    report += `  - Multiple choice: ${patterns.choices.length} fields\n\n`;

    report += `FILL RATE:\n`;
    report += `  - Filled: ${Object.keys(filledFields).length}/${form.fields.length} (${fillRate.toFixed(1)}%)\n\n`;

    report += `DIFFICULT FIELDS (require special handling):\n`;
    const difficultFields = form.fields.filter((f) => {
      const diff = this.predictFillDifficulty(f);
      return diff.difficulty === "hard";
    });

    if (difficultFields.length > 0) {
      difficultFields.forEach((f) => {
        const filled = filledFields[f.name] ? "✓" : "✗";
        report += `  ${filled} ${f.label || f.name} (${f.type})\n`;
      });
    } else {
      report += `  None - All fields are straightforward\n`;
    }

    report += `\n${"=".repeat(60)}\n`;

    return report;
  }

  /**
   * Suggest missing fields to fill
   */
  static suggestNextFields(form: Form, filledFields: Record<string, string>): FormField[] {
    const unfilled = form.fields.filter((f) => !filledFields[f.name]);

    // Prioritize by: required > difficult > optional
    unfilled.sort((a, b) => {
      if (a.required !== b.required) return a.required ? -1 : 1;
      const aDiff = this.predictFillDifficulty(a);
      const bDiff = this.predictFillDifficulty(b);
      const diffOrder = { hard: 0, medium: 1, easy: 2 };
      return diffOrder[aDiff.difficulty] - diffOrder[bDiff.difficulty];
    });

    return unfilled.slice(0, 5); // Return top 5 priorities
  }
}

export default FormAnalyzer;
