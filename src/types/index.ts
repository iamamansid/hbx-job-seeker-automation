import { z, type ZodType } from "zod";

export const PortalSourceSchema = z.enum([
  "LinkedIn",
  "Seek",
  "Indeed",
  "ETaxJobs",
  "WorkVisa",
]);

export type PortalSource = z.infer<typeof PortalSourceSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export interface LLMClient {
  generate(prompt: string): Promise<string>;
  generateJSON<T>(prompt: string, schema: ZodType<T, z.ZodTypeDef, unknown>): Promise<T>;
  chat(messages: ChatMessage[]): Promise<string>;
}

export const JobDescriptionSchema = z.object({
  jobTitle: z.string().optional(),
  companyName: z.string().optional(),
  requirements: z.array(z.string()).default([]),
  responsibilities: z.array(z.string()).default([]),
  benefits: z.array(z.string()).default([]),
  location: z.string().optional(),
  workType: z.string().optional(),
  fullDescription: z.string().optional(),
  salaryRange: z.string().optional(),
  url: z.string().optional(),
});

export type JobDescription = z.infer<typeof JobDescriptionSchema>;

export const JobListingSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  url: z.string().url(),
  description: z.string(),
  salary: z.string().optional(),
  portalSource: PortalSourceSchema,
  visaSponsorshipMentioned: z.boolean(),
  scrapedAt: z.coerce.date(),
});

export type JobListing = z.infer<typeof JobListingSchema>;

export const RelevancyDecisionSchema = z.object({
  isRelevant: z.boolean(),
  relevanceScore: z.number().min(0).max(100),
  visaSponsorshipScore: z.number().min(0).max(10),
  reasoning: z.string(),
  criteriaMatched: z.array(z.string()),
  criteriaNotMatched: z.array(z.string()),
});

export type RelevancyDecision = z.infer<typeof RelevancyDecisionSchema>;

export const ApplicationPlanSchema = z.object({
  shouldApply: z.boolean(),
  estimatedFillTime: z.number().nonnegative(),
  fieldStrategy: z.record(z.string(), z.string()),
  expectedChallenges: z.array(z.string()),
  keyPracticesToHighlight: z.array(z.string()),
});

export type ApplicationPlan = z.infer<typeof ApplicationPlanSchema>;

export const ProfileInferenceSchema = z.object({
  inferredSalaryExpectation: z.string().optional(),
  inferredNoticePeriod: z.string().optional(),
  inferredWorkPreference: z.enum(["remote", "hybrid", "onsite"]).optional(),
  inferredAvailability: z.string().optional(),
  confidenceScores: z.record(z.string(), z.number().min(0).max(100)),
});

export type ProfileInference = z.infer<typeof ProfileInferenceSchema>;

export const ApplicationStatusSchema = z.enum([
  "pending",
  "applied",
  "failed",
  "withdrawn",
]);

export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;

export const ApplicationRecordSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.number(),
  runId: z.string().uuid().optional(),
  companyName: z.string(),
  jobTitle: z.string(),
  jobUrl: z.string(),
  portalSource: PortalSourceSchema.optional(),
  status: ApplicationStatusSchema,
  relevanceScore: z.number(),
  fillRating: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
  formDataFilled: z.record(z.string(), z.unknown()),
  errorLog: z.string().optional(),
});

export type ApplicationRecord = z.infer<typeof ApplicationRecordSchema>;

export const RunStatusSchema = z.enum(["running", "completed", "failed", "cancelled"]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunRecordSchema = z.object({
  id: z.string().uuid(),
  runType: z.string(),
  mode: z.string(),
  status: RunStatusSchema,
  targetCountry: z.string(),
  targetPortals: z.array(PortalSourceSchema),
  jobsDiscovered: z.number().int().nonnegative(),
  applicationsAttempted: z.number().int().nonnegative(),
  applicationsApplied: z.number().int().nonnegative(),
  applicationsPending: z.number().int().nonnegative(),
  applicationsFailed: z.number().int().nonnegative(),
  notes: z.string().optional(),
  errorMessage: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().optional(),
});

export type RunRecord = z.infer<typeof RunRecordSchema>;

export const EventRecordSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  jobUrl: z.string().optional(),
  portalSource: PortalSourceSchema.optional(),
  eventType: z.string(),
  eventStatus: z.string().optional(),
  message: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.coerce.date(),
});

export type EventRecord = z.infer<typeof EventRecordSchema>;

export const JobLifecycleStatusSchema = z.enum([
  "discovered",
  "planned",
  "rejected",
  "pending",
  "applied",
  "failed",
  "withdrawn",
  "skipped",
]);

export type JobLifecycleStatus = z.infer<typeof JobLifecycleStatusSchema>;

export const JobRecordSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  url: z.string(),
  description: z.string(),
  salary: z.string().optional(),
  portalSource: z.string().optional(),
  visaSponsorshipMentioned: z.boolean(),
  currentStatus: JobLifecycleStatusSchema,
  relevanceScore: z.number().optional(),
  visaSponsorshipScore: z.number().int().optional(),
  fillRate: z.number().int().optional(),
  runId: z.string().uuid().optional(),
  notes: z.string().optional(),
  latestError: z.string().optional(),
  latestFormData: z.record(z.string(), z.unknown()).default({}),
  scrapedAt: z.coerce.date(),
  lastProcessedAt: z.coerce.date().optional(),
  lastAppliedAt: z.coerce.date().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type JobRecord = z.infer<typeof JobRecordSchema>;

export const FormFieldSchema = z.object({
  name: z.string(),
  type: z.enum([
    "text",
    "textarea",
    "select",
    "checkbox",
    "radio",
    "email",
    "tel",
    "file",
    "number",
    "date",
  ]),
  label: z.string().optional(),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  value: z.unknown().optional(),
  selector: z.string().optional(),
});

export type FormField = z.infer<typeof FormFieldSchema>;

export const FormSchema = z.object({
  id: z.string(),
  fields: z.array(FormFieldSchema),
  submitButtonSelector: z.string().optional(),
});

export type Form = z.infer<typeof FormSchema>;

export const BrowserActionSchema = z.object({
  type: z.enum(["click", "fill", "select", "upload", "scroll", "wait", "navigate"]),
  selector: z.string().optional(),
  value: z.unknown().optional(),
  description: z.string(),
});

export type BrowserAction = z.infer<typeof BrowserActionSchema>;

export interface ExecutionResult {
  success: boolean;
  message: string;
  filledFields: Record<string, string>;
  totalFields: number;
  errors: string[];
}

export interface SafetyCheck {
  action: string;
  riskLevel: "low" | "medium" | "high";
  requiresApproval: boolean;
  reason: string;
}

export interface JobScraper {
  searchJobs(keywords: string[], location: string, maxPages: number): Promise<JobListing[]>;
  extractJobDetails(url: string): Promise<JobListing>;
}

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
  currentJob: JobListing | null;
  currentPlan: ApplicationPlan | null;
  currentApplicationId: string | null;
  startTime: number;
  stepCount: number;
  historicalData: ApplicationRecord[];
}

export interface StoredJobRecord extends JobListing {
  id: string;
}
