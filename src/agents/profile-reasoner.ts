import OllamaClient from "../llm/ollama-client";
import logger from "../utils/logger";
import { ProfileInference, ProfileInferenceSchema, JobDescription } from "../types/index";
import { config } from "../config/index";

export class ProfileReasoner {
  private llm: OllamaClient;

  constructor() {
    this.llm = new OllamaClient();
  }

  /**
   * Infer missing profile information based on resume and job context
   */
  async inferMissingInfo(
    jobDesc: JobDescription,
    resumeContent?: string,
  ): Promise<ProfileInference> {
    try {
      logger.info("Inferring missing profile information...");

      const systemPrompt = `You are an expert career advisor. Based on the candidate's background and the job posting, infer reasonable professional answers for missing fields in a job application.

Consider:
- The candidate's years of experience and seniority level
- The job's location and work type
- Current tech industry norms
- The candidate's career trajectory

Return a JSON object with inferred responses and confidence scores (0-100) for each.`;

      const userPrompt = `
CANDIDATE PROFILE:
- Years of Experience: ${config.candidate.yearsOfExperience}
- Current Location: ${config.candidate.currentLocation}
- Skills: ${config.candidate.primarySkills.join(", ")}
- Willing to Relocate: ${config.candidate.willingToRelocate}
- Requires Sponsorship: ${config.candidate.requiresSponsorship}

JOB POSTING:
- Title: ${jobDesc.jobTitle}
- Location: ${jobDesc.location}
- Work Type: ${jobDesc.workType}
- Company: ${jobDesc.companyName}

${resumeContent ? `RESUME SUMMARY:\n${resumeContent.substring(0, 1000)}` : ""}

Infer reasonable answers for:
1. Expected salary (based on location and role)
2. Notice period (days to start)
3. Work preference (remote/hybrid/onsite)
4. Availability to start

Respond with JSON:`;

      const response = await this.llm.generateJSON<ProfileInference>(
        systemPrompt,
        userPrompt + `

{
  "inferredSalaryExpectation": "e.g., '80,000 - 100,000 USD'",
  "inferredNoticePeriod": "e.g., '2 weeks'",
  "inferredWorkPreference": "remote|hybrid|onsite",
  "inferredAvailability": "e.g., 'Immediately'",
  "confidenceScores": {
    "salary": number,
    "noticePeriod": number,
    "workPreference": number,
    "availability": number
  }
}`,
      );

      if (!response.success || !response.data) {
        logger.warn("Failed to infer profile information");
        return this.getDefaultInference();
      }

      logger.info("Profile information inferred successfully");
      return response.data;
    } catch (error) {
      logger.error("Error inferring profile information:", error);
      return this.getDefaultInference();
    }
  }

  /**
   * Generate context-aware answer for a specific question
   */
  async generateAnswer(
    question: string,
    jobDesc: JobDescription,
    context?: string,
  ): Promise<string> {
    try {
      logger.debug(`Generating answer for: ${question.substring(0, 50)}...`);

      const prompt = `

You are helping a job candidate answer the following question about a job application:

Question: "${question}"

Job Context:
- Title: ${jobDesc.jobTitle}
- Company: ${jobDesc.companyName}
- Location: ${jobDesc.location}
- Requirements: ${jobDesc.requirements?.join(", ") || "N/A"}

Candidate Background:
- Experience: ${config.candidate.yearsOfExperience} years
- Skills: ${config.candidate.primarySkills.join(", ")}
- Current Location: ${config.candidate.currentLocation}

${context ? `Additional Context: ${context}` : ""}

Write a professional, honest answer that highlights the candidate's relevant experience and enthusiasm for this specific role. The answer should be 2-3 sentences, natural and conversational.`;

      const response = await this.llm.generate(prompt);

      if (!response.success || !response.data) {
        logger.warn("Failed to generate answer");
        return "I am interested in this opportunity.";
      }

      // Clean up the response
      let answer = response.data.trim();
      // Remove any leading/trailing quotes
      answer = answer.replace(/^["']|["']$/g, "");

      return answer;
    } catch (error) {
      logger.error("Error generating answer:", error);
      return "I am interested in this opportunity.";
    }
  }

  /**
   * Score responses based on job fit
   */
  async scoreResponse(response: string, jobDesc: JobDescription): Promise<number> {
    try {
      const prompt = `

Rate how well this response answers a job application question in the context of this job posting.

Job: ${jobDesc.jobTitle} at ${jobDesc.companyName}
Requirements: ${jobDesc.requirements?.join(", ") || "N/A"}

Response: "${response}"

Rate on a scale of 0-100 how well this response:
1. Directly addresses the question
2. Highlights relevant skills/experience
3. Shows genuine interest in the role
4. Is professional and well-written

Respond with ONLY a number between 0 and 100.`;

      const response_obj = await this.llm.generate(prompt);

      if (!response_obj.success || !response_obj.data) {
        return 50; // Default to middle score if unable to evaluate
      }

      const scoreMatch = response_obj.data.match(/\d+/);
      const score = scoreMatch ? parseInt(scoreMatch[0]) : 50;

      return Math.min(100, Math.max(0, score));
    } catch (error) {
      logger.error("Error scoring response:", error);
      return 50;
    }
  }

  /**
   * Get default inference values
   */
  private getDefaultInference(): ProfileInference {
    return {
      inferredSalaryExpectation: undefined,
      inferredNoticePeriod: "2 weeks",
      inferredWorkPreference: config.candidate.willingToRelocate ? "remote" : "onsite",
      inferredAvailability: "2-4 weeks",
      confidenceScores: {
        salary: 20,
        noticePeriod: 70,
        workPreference: 60,
        availability: 50,
      },
    };
  }
}

export default ProfileReasoner;
