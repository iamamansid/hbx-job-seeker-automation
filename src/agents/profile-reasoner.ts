import { z } from "zod";

import { config, type Config } from "../config/index";
import {
  ProfileInferenceSchema,
  type JobDescription,
  type LLMClient,
  type ProfileInference,
} from "../types/index";
import { logger } from "../utils/logger";

const ResponseScoreSchema = z.object({
  score: z.number().min(0).max(100),
});

export class ProfileReasoner {
  constructor(
    private readonly llmClient: LLMClient,
    private readonly runtimeConfig: Config = config,
  ) {}

  async inferMissingInfo(jobDesc: JobDescription, resumeContent?: string): Promise<ProfileInference> {
    try {
      const prompt = `
You are helping a job candidate answer missing application fields honestly and professionally.

Return valid JSON with:
- inferredSalaryExpectation
- inferredNoticePeriod
- inferredWorkPreference
- inferredAvailability
- confidenceScores

Candidate:
- Experience: ${this.runtimeConfig.candidate.yearsOfExperience} years
- Location: ${this.runtimeConfig.candidate.currentLocation || "Not provided"}
- Skills: ${this.runtimeConfig.candidate.primarySkills.join(", ")}
- Willing to relocate: ${this.runtimeConfig.candidate.willingToRelocate}
- Requires sponsorship: ${this.runtimeConfig.candidate.requiresSponsorship}

Job:
${JSON.stringify(jobDesc, null, 2)}

Resume excerpt:
${resumeContent?.slice(0, 2000) ?? "Not provided"}
`;

      return await this.llmClient.generateJSON<ProfileInference>(prompt, ProfileInferenceSchema);
    } catch (error) {
      logger.warn("Falling back to default profile inference", { error });
      return this.getDefaultInference();
    }
  }

  async generateAnswer(question: string, jobDesc: JobDescription, context?: string): Promise<string> {
    try {
      const prompt = `
Write a concise, professional answer for a job application.

Question: ${question}

Candidate:
- Experience: ${this.runtimeConfig.candidate.yearsOfExperience} years
- Primary skills: ${this.runtimeConfig.candidate.primarySkills.join(", ")}
- Secondary skills: ${this.runtimeConfig.candidate.secondarySkills.join(", ")}
- Location: ${this.runtimeConfig.candidate.currentLocation || "Not provided"}
- Requires sponsorship: ${this.runtimeConfig.candidate.requiresSponsorship}

Job:
${JSON.stringify(jobDesc, null, 2)}

Additional context:
${context ?? "None"}

Answer in 2 to 3 sentences. Be honest, confident, and tailored to the role.
`;

      return (await this.llmClient.generate(prompt)).replace(/^["']|["']$/g, "").trim();
    } catch (error) {
      logger.warn("Falling back to default generated answer", { error });
      return "I am excited about this role because it aligns well with my Java backend experience, and I would welcome the opportunity to contribute while relocating or securing sponsorship as needed.";
    }
  }

  async scoreResponse(response: string, jobDesc: JobDescription): Promise<number> {
    try {
      const prompt = `
Evaluate how well this application response fits the job.

Return valid JSON with:
- score: number from 0 to 100

Job:
${JSON.stringify(jobDesc, null, 2)}

Response:
${response}
`;

      const result = await this.llmClient.generateJSON<{ score: number }>(prompt, ResponseScoreSchema);
      return result.score;
    } catch (error) {
      logger.warn("Falling back to default response score", { error });
      return 50;
    }
  }

  private getDefaultInference(): ProfileInference {
    return {
      inferredSalaryExpectation: "AUD 100,000 - 120,000",
      inferredNoticePeriod: "2 to 4 weeks",
      inferredWorkPreference: "hybrid",
      inferredAvailability: "Within 2 to 4 weeks",
      confidenceScores: {
        salary: 45,
        noticePeriod: 70,
        workPreference: 60,
        availability: 55,
      },
    };
  }
}
