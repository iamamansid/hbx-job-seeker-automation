import logger from "./logger";
import { SafetyCheck, BrowserAction } from "../types/index";

/**
 * Safety layer for critical operations
 * Prevents the agent from taking dangerous actions without confirmation
 */
export class SafetyHandler {
  /**
   * Check if an action requires safety approval
   */
  static evaluateAction(action: BrowserAction): SafetyCheck {
    const actionLower = action.type.toLowerCase();
    const descLower = action.description.toLowerCase();

    // High risk actions
    if (
      actionLower === "click" &&
      (descLower.includes("submit") || descLower.includes("apply"))
    ) {
      return {
        action: action.description,
        riskLevel: "high",
        requiresApproval: true,
        reason: "Form submission - will apply to job",
      };
    }

    if (
      actionLower === "upload" &&
      (descLower.includes("resume") || descLower.includes("cv"))
    ) {
      return {
        action: action.description,
        riskLevel: "high",
        requiresApproval: true,
        reason: "Document upload - will share resume",
      };
    }

    // Medium risk actions
    if (actionLower === "fill" || actionLower === "select") {
      if (
        descLower.includes("email") ||
        descLower.includes("phone") ||
        descLower.includes("salary")
      ) {
        return {
          action: action.description,
          riskLevel: "medium",
          requiresApproval: false,
          reason: "Filling sensitive personal information",
        };
      }
    }

    // Low risk actions
    return {
      action: action.description,
      riskLevel: "low",
      requiresApproval: false,
      reason: "Standard form interaction",
    };
  }

  /**
   * Check form completion before submission
   */
  static validateBeforeSubmit(
    form: any,
    filledFields: Record<string, string>,
  ): {
    canSubmit: boolean;
    missingFields: string[];
    warnings: string[];
  } {
    const missingFields: string[] = [];
    const warnings: string[] = [];

    // Check required fields
    const requiredFields = form.fields.filter((f: any) => f.required);
    for (const field of requiredFields) {
      if (!filledFields[field.name]) {
        missingFields.push(field.label || field.name);
      }
    }

    // Check for minimum information
    if (Object.keys(filledFields).length < 3) {
      warnings.push("Very few fields filled - form may be incomplete");
    }

    // Warn if no email
    const hasEmail = Object.values(filledFields).some(
      (v) => typeof v === "string" && v.includes("@"),
    );
    if (!hasEmail) {
      warnings.push("No email address detected in form");
    }

    return {
      canSubmit: missingFields.length === 0,
      missingFields,
      warnings,
    };
  }

  /**
   * Log security event
   */
  static logSecurityEvent(
    eventType: "ACTION_BLOCKED" | "APPROVAL_REQUIRED" | "HIGH_RISK_DETECTED",
    details: string,
  ): void {
    logger.warn(`[SECURITY] ${eventType}: ${details}`);
  }

  /**
   * Check for suspicious patterns
   */
  static detectSuspiciousPatterns(formData: Record<string, string>): string[] {
    const warnings: string[] = [];

    // Check for repeated text (copy-paste from resume)
    const values = Object.values(formData).filter((v) => typeof v === "string");
    if (values.length > 0) {
      const joinedText = values.join(" ");

      // Very long single response (might be copy-pasted)
      for (const value of values) {
        if (value.length > 500) {
          warnings.push("Unusually long response - might be copy-pasted");
          break;
        }
      }

      // All fields with same value
      if (new Set(values).size === 1) {
        warnings.push("All fields have identical values");
      }
    }

    return warnings;
  }

  /**
   * Rate action safety
   */
  static getSafetyRating(
    action: BrowserAction,
    formData?: Record<string, string>,
  ): {
    safetyScore: number; // 0-100, 100 = safest
    recommendation: string;
    requiresManualReview: boolean;
  } {
    const actionCheck = this.evaluateAction(action);

    let safetyScore = 100;

    // Reduce score based on risk level
    if (actionCheck.riskLevel === "high") {
      safetyScore = 40;
    } else if (actionCheck.riskLevel === "medium") {
      safetyScore = 70;
    }

    // Check form data if provided
    if (formData) {
      const suspicious = this.detectSuspiciousPatterns(formData);
      if (suspicious.length > 0) {
        safetyScore -= 20;
      }
    }

    safetyScore = Math.max(0, Math.min(100, safetyScore));

    let recommendation = "Proceed with caution";
    let requiresManualReview = actionCheck.requiresApproval;

    if (safetyScore < 30) {
      recommendation = "DO NOT PROCEED - Manual review required";
      requiresManualReview = true;
    } else if (safetyScore < 60) {
      recommendation = "Verify details before proceeding";
      requiresManualReview = true;
    } else if (safetyScore >= 80) {
      recommendation = "Safe to proceed";
      requiresManualReview = false;
    }

    return { safetyScore, recommendation, requiresManualReview };
  }
}

export default SafetyHandler;
