import OllamaClient from "../llm/ollama-client";
import logger from "../utils/logger";
import {
  JobDescription,
  RelevancyDecision,
  RelevancyDecisionSchema,
  ApplicationPlan,
  ApplicationPlanSchema,
} from "../types/index";
import { config } from "../config/index";

export class PlannerAgent {
  private llm: OllamaClient;

  constructor() {
    this.llm = new OllamaClient();
  }

  /**
   * Analyze job description and decide relevance
   */
  async analyzeRelevance(jobDesc: JobDescription): Promise<RelevancyDecision> {
    try {
      logger.info(`Analyzing relevance for: ${jobDesc.jobTitle} at ${jobDesc.companyName}`);

      const systemPrompt = `You are an expert recruiter analyzing job postings for a candidate. Evaluate the job based on the candidate's background and determine if this is a relevant opportunity.

Return a JSON object with:
- isRelevant (boolean): Is this a good match?
- relevanceScore (0-100): How well does the candidate fit?
- reasoning (string): Why is this relevant/not relevant?
- criteriaMatched (array): What requirements match the candidate?
- criteriaNotMatched (array): What's missing?`;

      const userPrompt = `
CANDIDATE PROFILE:
- Years of Experience: ${config.candidate.yearsOfExperience}
- Primary Skills: ${config.candidate.primarySkills.join(", ")}
- Secondary Skills: ${config.candidate.secondarySkills.join(", ")}
- Willing to Relocate: ${config.candidate.willingToRelocate}
- Requires Sponsorship: ${config.candidate.requiresSponsorship}
- Location: ${config.candidate.currentLocation}

JOB POSTING:
Title: ${jobDesc.jobTitle}
Company: ${jobDesc.companyName}
Location: ${jobDesc.location}
Work Type: ${jobDesc.workType}
Requirements: ${jobDesc.requirements?.join(", ") || "Not specified"}
Responsibilities: ${jobDesc.responsibilities?.join(", ") || "Not specified"}
Full Description: ${jobDesc.fullDescription?.substring(0, 500) || "Not provided"}

Analyze this job and respond with JSON:`;

      const response = await this.llm.generateJSON<RelevancyDecision>(
        systemPrompt,
        userPrompt + `

{
  "isRelevant": boolean,
  "relevanceScore": number,
  "reasoning": string,
  "criteriaMatched": [string],
  "criteriaNotMatched": [string]
}`,
      );

      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to analyze relevance");
      }

      logger.info(`Relevance Analysis: ${response.data.relevanceScore}% - ${response.data.isRelevant ? "RELEVANT" : "NOT RELEVANT"}`);
      return response.data;
    } catch (error) {
      logger.error("Error analyzing relevance:", error);
      // Fallback: assume low relevance if analysis fails
      return {
        isRelevant: false,
        relevanceScore: 0,
        reasoning: "Failed to analyze: " + (error instanceof Error ? error.message : "Unknown error"),
        criteriaMatched: [],
        criteriaNotMatched: ["Unable to analyze"],
      };
    }
  }

  /**
   * Create application plan for a job
   */
  async planApplication(jobDesc: JobDescription): Promise<ApplicationPlan> {
    try {
      logger.info(`Creating application plan for: ${jobDesc.jobTitle}`);

      const systemPrompt = `You are a strategic career consultant. Create a detailed plan for filling out a job application to maximize the candidate's chances. Consider the job requirements and suggest how to highlight relevant experience.

Return a JSON object with:
- shouldApply (boolean): Should the candidate apply?
- estimatedFillTime (number): Estimated seconds to complete application
- fieldStrategy (object): Key -> how to approach each field
- expectedChallenges (array): What obstacles might we face?
- keyPracticesToHighlight (array): What should we emphasize?`;

      const userPrompt = `
JOB DETAILS:
Title: ${jobDesc.jobTitle}
Company: ${jobDesc.companyName}
Requirements: ${jobDesc.requirements?.join(", ") || "Not specified"}
Responsibilities: ${jobDesc.responsibilities?.join(", ") || "Not specified"}
Description: ${jobDesc.fullDescription?.substring(0, 800) || "Not provided"}

CANDIDATE INFO:
Skills: ${config.candidate.primarySkills.join(", ")}
Experience: ${config.candidate.yearsOfExperience} years
Location: ${config.candidate.currentLocation}

Create an application strategy and respond with JSON:`;

      const response = await this.llm.generateJSON<ApplicationPlan>(
        systemPrompt,
        userPrompt + `

{
  "shouldApply": boolean,
  "estimatedFillTime": number,
  "fieldStrategy": {
    "field_name": "strategy description"
  },
  "expectedChallenges": [string],
  "keyPracticesToHighlight": [string]
}`,
      );

      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to create plan");
      }

      logger.info(`Application plan created. Should apply: ${response.data.shouldApply}`);
      return response.data;
    } catch (error) {
      logger.error("Error creating application plan:", error);
      // Fallback plan
      return {
        shouldApply: false,
        estimatedFillTime: 300,
        fieldStrategy: {},
        expectedChallenges: ["Unable to create detailed plan"],
        keyPracticesToHighlight: [],
      };
    }
  }

  /**
   * Extract job description from HTML content
   */
  async extractJobDescription(htmlContent: string): Promise<JobDescription | null> {
    try {
      logger.debug("Extracting job description from HTML...");

      const systemPrompt = `Extract structured job posting information from the given HTML. Look for job title, company name, location, requirements, responsibilities, and benefits. Return only valid JSON.`;

      const userPrompt = `HTML Content (first 2000 chars):
${htmlContent.substring(0, 2000)}

Extract and return:`;

      const response = await this.llm.generateJSON<JobDescription>(
        systemPrompt,
        userPrompt + `

{
  "jobTitle": string,
  "companyName": string,
  "location": string,
  "workType": string,
  "requirements": [string],
  "responsibilities": [string],
  "benefits": [string],
  "fullDescription": string
}`,
      );

      if (!response.success) {
        logger.warn("Failed to extract job description from HTML");
        return null;
      }

      return response.data || null;
    } catch (error) {
      logger.error("Error extracting job description:", error);
      return null;
    }
  }
}

export default PlannerAgent;
