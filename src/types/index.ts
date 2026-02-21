import { z } from "zod";

// Job Application schemas
export const JobDescriptionSchema = z.object({
  jobTitle: z.string().optional(),
  companyName: z.string().optional(),
  requirements: z.array(z.string()).optional(),
  responsibilities: z.array(z.string()).optional(),
  benefits: z.array(z.string()).optional(),
  location: z.string().optional(),
  workType: z.string().optional(), // Remote, Hybrid, On-site
  fullDescription: z.string().optional(),
  salaryRange: z.string().optional(),
  url: z.string().optional(), // Job posting URL
});

export type JobDescription = z.infer<typeof JobDescriptionSchema>;

// Agent Decision schemas
export const RelevancyDecisionSchema = z.object({
  isRelevant: z.boolean(),
  relevanceScore: z.number().min(0).max(100),
  reasoning: z.string(),
  criteriaMatched: z.array(z.string()),
  criteriaNotMatched: z.array(z.string()),
});

export type RelevancyDecision = z.infer<typeof RelevancyDecisionSchema>;

export const ApplicationPlanSchema = z.object({
  shouldApply: z.boolean(),
  estimatedFillTime: z.number(), // in seconds
  fieldStrategy: z.record(z.string(), z.string()), // field_name -> strategy
  expectedChallenges: z.array(z.string()),
  keyPracticesToHighlight: z.array(z.string()),
});

export type ApplicationPlan = z.infer<typeof ApplicationPlanSchema>;

export const ProfileInferenceSchema = z.object({
  inferredSalaryExpectation: z.string().optional(),
  inferredNoticePeriod: z.string().optional(),
  inferredWorkPreference: z.enum(["remote", "hybrid", "onsite"]).optional(),
  inferredAvailability: z.string().optional(),
  confidenceScores: z.record(z.string(), z.number()),
});

export type ProfileInference = z.infer<typeof ProfileInferenceSchema>;

// Memory/Database schemas
export const ApplicationRecordSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.number(), // Unix timestamp
  companyName: z.string(),
  jobTitle: z.string(),
  jobUrl: z.string(),
  status: z.enum(["pending", "applied", "failed", "withdrawn"]),
  relevanceScore: z.number(),
  fillRating: z.number().optional(), // 0-100, how well form was filled
  notes: z.string().optional(),
  formDataFilled: z.record(z.string(), z.any()),
  errorLog: z.string().optional(),
});

export type ApplicationRecord = z.infer<typeof ApplicationRecordSchema>;

// Browser interaction schemas
export const FormFieldSchema = z.object({
  name: z.string(),
  type: z.enum(["text", "textarea", "select", "checkbox", "radio", "email", "tel", "file", "number", "date"]),
  label: z.string().optional(),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  value: z.any().optional(),
});

export type FormField = z.infer<typeof FormFieldSchema>;

export const FormSchema = z.object({
  id: z.string(),
  fields: z.array(FormFieldSchema),
  submitButtonSelector: z.string().optional(),
});

export type Form = z.infer<typeof FormSchema>;

// Orchestrator state
export enum AgentState {
  IDLE = "idle",
  SEARCHING = "searching",
  ANALYZING = "analyzing",
  PLANNING = "planning",
  EXECUTING = "executing",
  VERIFYING = "verifying",
  LEARNING = "learning",
  ERROR = "error",
  COMPLETED = "completed",
}

export interface OrchestratorState {
  currentState: AgentState;
  currentJob: JobDescription | null;
  currentPlan: ApplicationPlan | null;
  currentApplicationId: string | null;
  startTime: number;
  stepCount: number;
  historicalData: ApplicationRecord[];
}

// LLM Response wrapper
export interface LLMResponse<T> {
  success: boolean;
  data?: T;
  reasoning?: string;
  error?: string;
  tokensUsed?: {
    prompt: number;
    completion: number;
  };
}

// Safety layer
export interface SafetyCheck {
  action: string;
  riskLevel: "low" | "medium" | "high";
  requiresApproval: boolean;
  reason: string;
}

export interface BrowserAction {
  type: "click" | "fill" | "select" | "upload" | "scroll" | "wait" | "navigate";
  selector?: string;
  value?: any;
  description: string;
}
