import { config, type Config } from "../config/index";
import {
  ApplicationPlanSchema,
  JobDescriptionSchema,
  RelevancyDecisionSchema,
  type ApplicationPlan,
  type JobDescription,
  type LLMClient,
  type RelevancyDecision,
} from "../types/index";
import { logger } from "../utils/logger";

export class PlannerAgent {
  constructor(
    private readonly llmClient: LLMClient,
    private readonly runtimeConfig: Config = config,
  ) {}

  async analyzeRelevance(jobDesc: JobDescription): Promise<RelevancyDecision> {
    try {
      const prompt = `
You are a senior recruiter evaluating whether a Java backend engineer who needs Australian visa sponsorship should apply.

Return valid JSON with:
- isRelevant: boolean
- relevanceScore: number from 0 to 100
- visaSponsorshipScore: number from 0 to 10
- reasoning: string
- criteriaMatched: string[]
- criteriaNotMatched: string[]

Candidate profile:
- Experience: ${this.runtimeConfig.candidate.yearsOfExperience} years
- Primary skills: ${this.runtimeConfig.candidate.primarySkills.join(", ")}
- Secondary skills: ${this.runtimeConfig.candidate.secondarySkills.join(", ")}
- Requires sponsorship: ${this.runtimeConfig.candidate.requiresSponsorship}
- Willing to relocate: ${this.runtimeConfig.candidate.willingToRelocate}
- Current location: ${this.runtimeConfig.candidate.currentLocation || "Not provided"}

Weight these Australia-specific signals heavily.

Positive signals:
- Mentions "482 visa", "visa sponsorship", "willing to sponsor", or "overseas applicants welcome"
- Java + Spring Boot + Microservices
- Azure or GCP
- Sponsoring employers such as Deloitte, Accenture, Capgemini, ANZ, NAB, Westpac, Commonwealth Bank, Atlassian, Canva, AWS, Microsoft AU
- Role location in NSW, VIC, QLD, SA, WA, or ACT
- Salary above AUD 90,000

Negative signals:
- No mention of visa or sponsorship
- Requires Australian citizenship or PR
- Says "Australian citizens only", "must have full work rights", or similar
- Requires security clearance
- Location is NT or Tasmania

Interpret visaSponsorshipScore as:
- 0 to 3: explicit blocker or no realistic sponsorship path
- 4 to 5: ambiguous sponsorship
- 6 to 8: reasonable sponsorship chance
- 9 to 10: explicit sponsorship support

Job posting:
${JSON.stringify(jobDesc, null, 2)}
`;

      return await this.llmClient.generateJSON<RelevancyDecision>(prompt, RelevancyDecisionSchema);
    } catch (error) {
      logger.warn("Falling back to heuristic relevancy analysis", { error });
      return this.getHeuristicRelevancy(jobDesc);
    }
  }

  async planApplication(jobDesc: JobDescription): Promise<ApplicationPlan> {
    try {
      const prompt = `
You are a strategic job application planner for an Australia-focused visa sponsorship job search.

Return valid JSON with:
- shouldApply: boolean
- estimatedFillTime: number in seconds
- fieldStrategy: object mapping field names to strategy notes
- expectedChallenges: string[]
- keyPracticesToHighlight: string[]

Candidate profile:
- Skills: ${this.runtimeConfig.candidate.primarySkills.join(", ")}
- Cloud experience: ${this.runtimeConfig.candidate.secondarySkills.join(", ")}
- Experience: ${this.runtimeConfig.candidate.yearsOfExperience} years
- Sponsorship required: ${this.runtimeConfig.candidate.requiresSponsorship}

Job posting:
${JSON.stringify(jobDesc, null, 2)}

Make the plan conservative. If sponsorship odds are poor, set shouldApply to false.
`;

      return await this.llmClient.generateJSON<ApplicationPlan>(prompt, ApplicationPlanSchema);
    } catch (error) {
      logger.warn("Falling back to heuristic application plan", { error });
      return {
        shouldApply: true,
        estimatedFillTime: 480,
        fieldStrategy: {
          resume: "Upload the latest backend engineering resume.",
          sponsorship: "Answer honestly that sponsorship is required.",
        },
        expectedChallenges: ["Potential sponsorship eligibility questions"],
        keyPracticesToHighlight: this.runtimeConfig.candidate.primarySkills.slice(0, 4),
      };
    }
  }

  async extractJobDescription(htmlContent: string): Promise<JobDescription | null> {
    try {
      const prompt = `
Extract structured job posting information from the following HTML snippet.
Return valid JSON with fields:
- jobTitle
- companyName
- location
- workType
- requirements
- responsibilities
- benefits
- fullDescription
- salaryRange

HTML:
${htmlContent.slice(0, 6000)}
`;

      return await this.llmClient.generateJSON<JobDescription>(prompt, JobDescriptionSchema);
    } catch (error) {
      logger.warn("Unable to extract structured job description", { error });
      return null;
    }
  }

  private getHeuristicRelevancy(jobDesc: JobDescription): RelevancyDecision {
    const description = [
      jobDesc.jobTitle,
      jobDesc.companyName,
      jobDesc.location,
      jobDesc.salaryRange,
      jobDesc.fullDescription,
      ...(jobDesc.requirements ?? []),
      ...(jobDesc.responsibilities ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matched: string[] = [];
    const missed: string[] = [];

    const includes = (value: string): boolean => description.includes(value);

    const skillSignals = ["java", "spring boot", "microservices"];
    let relevanceScore = 0;
    for (const signal of skillSignals) {
      if (includes(signal)) {
        matched.push(`Matched ${signal}`);
        relevanceScore += 20;
      } else {
        missed.push(`Missing ${signal}`);
      }
    }

    if (includes("azure") || includes("gcp")) {
      matched.push("Cloud stack alignment");
      relevanceScore += 10;
    }

    let visaSponsorshipScore = 3;
    if (
      includes("visa sponsorship") ||
      includes("482 visa") ||
      includes("willing to sponsor") ||
      includes("overseas applicants welcome")
    ) {
      matched.push("Visa sponsorship language present");
      visaSponsorshipScore = 8;
      relevanceScore += 20;
    } else {
      missed.push("No explicit visa sponsorship wording");
    }

    if (
      includes("australian citizen") ||
      includes("citizens only") ||
      includes("full work rights") ||
      includes("security clearance")
    ) {
      missed.push("Explicit work-rights restriction");
      visaSponsorshipScore = 0;
      relevanceScore = Math.max(0, relevanceScore - 40);
    }

    if (includes("nsw") || includes("vic") || includes("qld") || includes("wa") || includes("sa") || includes("act")) {
      matched.push("Preferred Australian location");
      relevanceScore += 10;
    }

    if (includes("tas") || includes("tasmania") || includes("nt") || includes("northern territory")) {
      missed.push("Low-priority location");
      relevanceScore = Math.max(0, relevanceScore - 10);
    }

    if (includes("aud") || includes("90000")) {
      matched.push("Salary signal present");
      relevanceScore += 10;
    }

    relevanceScore = Math.max(0, Math.min(100, relevanceScore));

    return {
      isRelevant: relevanceScore >= 50 && visaSponsorshipScore >= 6,
      relevanceScore,
      visaSponsorshipScore,
      reasoning:
        visaSponsorshipScore >= 6
          ? "Heuristic analysis found sponsorship-positive wording and relevant Java backend signals."
          : "Heuristic analysis did not find enough sponsorship support or relevant stack coverage.",
      criteriaMatched: matched,
      criteriaNotMatched: missed,
    };
  }
}
