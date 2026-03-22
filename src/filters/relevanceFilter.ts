import { z } from "zod";

import { APPLICANT } from "../config/config";
import { gemini } from "../ai/geminiClient";
import { type JobDetails, type RelevanceAssessment } from "../seek/types";
import { logger } from "../utils/logger";
import { normalizeForMatch, truncate, uniqueStrings } from "../utils/text";

const TITLE_WEIGHTS: Array<{ pattern: string; score: number }> = [
  { pattern: "java developer", score: 30 },
  { pattern: "java engineer", score: 28 },
  { pattern: "backend engineer", score: 25 },
  { pattern: "software engineer", score: 20 },
  { pattern: "spring boot", score: 25 },
  { pattern: "api developer", score: 22 },
  { pattern: "ai engineer", score: 28 },
  { pattern: "genai", score: 30 },
  { pattern: "llm engineer", score: 30 },
  { pattern: "full stack java", score: 25 },
  { pattern: "microservices", score: 20 },
];

const PRIMARY_SKILLS = [
  "Java",
  "Spring Boot",
  "Azure",
  "Docker",
  "Kubernetes",
  "PostgreSQL",
  "MongoDB",
  "GenAI",
  "Azure OpenAI",
  "LLM",
  "Microservices",
  "REST API",
  "Spring Batch",
];

const SECONDARY_SKILLS = [
  "React",
  "TypeScript",
  "AWS",
  "CI/CD",
  "Jenkins",
  "Git",
  "Agile",
  "Hibernate",
  "Python",
];

const RelevanceSchema = z.object({
  score: z.number().min(0).max(100),
  rationale: z.string(),
  matchingSkills: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
});

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const calculateHeuristicScore = (job: JobDetails): { score: number; matchingSkills: string[] } => {
  const title = normalizeForMatch(job.title);
  const combined = normalizeForMatch(`${job.title}\n${job.description}\n${job.keyRequirements}`);

  const titleMatch = TITLE_WEIGHTS.reduce((best, current) => {
    if (title.includes(normalizeForMatch(current.pattern))) {
      return Math.max(best, current.score);
    }

    return best;
  }, 0);

  const primaryMatches = PRIMARY_SKILLS.filter((skill) =>
    combined.includes(normalizeForMatch(skill)),
  ).slice(0, 10);
  const secondaryMatches = SECONDARY_SKILLS.filter((skill) =>
    combined.includes(normalizeForMatch(skill)),
  ).slice(0, 15);

  let seniorityScore = 0;
  if (/junior|graduate/.test(title)) {
    seniorityScore = -10;
  } else if (/senior|lead|principal/.test(title)) {
    seniorityScore = 15;
  } else if (/mid|mid-level/.test(title)) {
    seniorityScore = 10;
  }

  const hasFinancialDomain =
    /insurance|fintech|banking|financial services/.test(combined) ||
    normalizeForMatch(job.company).includes("metlife");
  const hasAiDomain = /ai|machine learning|genai|llm/.test(combined);
  const domainBonus = hasFinancialDomain || hasAiDomain ? 10 : 0;

  const score =
    titleMatch +
    Math.min(primaryMatches.length * 3, 30) +
    Math.min(secondaryMatches.length, 15) +
    seniorityScore +
    domainBonus;

  return {
    score: clamp(score, 0, 100),
    matchingSkills: uniqueStrings([...primaryMatches, ...secondaryMatches]),
  };
};

const parseGeminiJson = (raw: string): z.infer<typeof RelevanceSchema> => {
  const normalized = raw.replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
  return RelevanceSchema.parse(JSON.parse(normalized));
};

const analyzeWithGemini = async (
  job: JobDetails,
  heuristicScore: number,
): Promise<z.infer<typeof RelevanceSchema>> => {
  const prompt = `
You are analyzing job relevance for Aman Siddiqui, an overseas applicant targeting SEEK Australia
roles that can support Subclass 482 sponsorship.

Applicant profile:
- 3 years experience
- Lead API Developer at MetLife
- Former Deloitte software developer
- Core stack: ${APPLICANT.primarySkills.join(", ")}
- Secondary skills: ${APPLICANT.secondarySkills.join(", ")}
- Wants Java Developer / AI-ML Engineer / backend / GenAI roles
- Requires 482 sponsorship

Job:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Key requirements: ${job.keyRequirements}
Sponsorship status: ${job.sponsorshipScore}
Heuristic score already computed: ${heuristicScore}

Full job description:
${truncate(job.description, 12000)}

Using this exact rubric, assess fit from 0 to 100:
- Title match 0-30
- Primary skill matches 0-30
- Secondary skill matches 0-15
- Seniority match 0-15
- Domain bonus 0-10

Respond ONLY as JSON:
{
  "score": number,
  "rationale": "short paragraph",
  "matchingSkills": ["skill"],
  "concerns": ["concern"]
}
`;

  const raw = await gemini.generate(prompt, 0.1, {
    label: "relevance-analysis",
    metadata: {
      jobId: job.id,
      company: job.company,
      title: job.title,
      heuristicScore,
    },
    logPromptPreview: true,
    logResponsePreview: true,
  });
  return parseGeminiJson(raw);
};

export const relevanceFilter = async (job: JobDetails): Promise<RelevanceAssessment> => {
  try {
    const heuristic = calculateHeuristicScore(job);
    logger.info("Starting relevance scoring", {
      jobId: job.id,
      company: job.company,
      title: job.title,
      heuristicScore: heuristic.score,
      heuristicMatchingSkills: heuristic.matchingSkills,
    });
    let aiScore = heuristic.score;
    let rationale = `Heuristic fit based on title, skills, seniority, and domain scored ${heuristic.score}/100.`;
    let matchingSkills = heuristic.matchingSkills;
    let concerns: string[] = [];

    try {
      const aiAssessment = await analyzeWithGemini(job, heuristic.score);
      aiScore = aiAssessment.score;
      rationale = aiAssessment.rationale;
      matchingSkills = uniqueStrings([...matchingSkills, ...aiAssessment.matchingSkills]);
      concerns = aiAssessment.concerns;
    } catch (error) {
      logger.warn("Gemini relevance analysis failed, falling back to heuristic score", {
        error,
        jobId: job.id,
      });
    }

    const finalScore = clamp(Math.round((heuristic.score + aiScore) / 2), 0, 100);

    logger.info("Completed relevance scoring", {
      jobId: job.id,
      company: job.company,
      title: job.title,
      heuristicScore: heuristic.score,
      aiScore,
      finalScore,
      rationale,
      matchingSkills,
      concerns,
    });

    return {
      score: finalScore,
      heuristicScore: heuristic.score,
      aiScore,
      rationale,
      matchingSkills,
      concerns,
    };
  } catch (error) {
    logger.error("Failed to score job relevance", {
      error,
      jobId: job.id,
      company: job.company,
      title: job.title,
    });
    throw error;
  }
};
