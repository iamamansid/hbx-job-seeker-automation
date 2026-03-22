import fs from "fs/promises";

import { APPLICANT, seekConfig } from "../config/config";
import { type JobDetails } from "../seek/types";
import { logger } from "../utils/logger";
import { truncate } from "../utils/text";
import { gemini } from "./geminiClient";

const loadBaseCoverLetter = async (): Promise<string> => {
  try {
    return await fs.readFile(seekConfig.paths.coverLetterBasePath, "utf8");
  } catch {
    return "";
  }
};

export const generateCoverLetter = async (job: JobDetails): Promise<string> => {
  try {
    const baseText = await loadBaseCoverLetter();
    const prompt = `
You are writing a professional cover letter for Aman Siddiqui applying to an
Australian employer for a ${job.title} role at ${job.company}.

APPLICANT BACKGROUND:
- Senior Software Engineer / AI Integration Specialist
- Lead API Developer at MetLife (Oct 2025-Present): Built high-performance REST APIs
  for IVR/mobile channels; MongoDB caching layer reducing DB load 40%, latency 55%;
  Spring Batch vulnerability automation saving 8hrs/week; Elastic Stack migration.
- Software Developer at Deloitte (Jul 2023-Oct 2025): Azure OpenAI Python solution
  automating JUnit test generation (200% QA efficiency gain, Applause Award);
  Java Azure Queue/Blob Storage integrations handling 500GB+ daily; Java 11 to 17 migration.
- Research: Authoring EMNLP 2026 paper benchmarking 6 LLMs (Gemini 2.5 Pro,
  Llama 4 Maverick, Mistral Medium) on invoice entity extraction via Google Cloud
  Document AI, Neo4j, BigQuery, Spring Boot pipeline.
- Certifications: Microsoft AZ-204 Azure Developer Associate
- Education: ${APPLICANT.education}; ${APPLICANT.additionalEducation}
- Requires Subclass 482 employer sponsorship to relocate to Australia

JOB BEING APPLIED TO:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Key Requirements from JD: ${job.keyRequirements}
Sponsorship status detected: ${job.sponsorshipScore}

FULL JOB DESCRIPTION:
${truncate(job.description, 12_000)}

BASE COVER LETTER CONTEXT:
${baseText || "No base letter provided."}

INSTRUCTIONS:
1. Write a single-page (max 350 words body) professional Australian-market cover letter
2. Opening: Express interest, state 482 sponsorship requirement upfront, no apology
3. Paragraph 2: Match 2-3 specific requirements from the JD to Aman's concrete
   achievements with metrics
4. Paragraph 3: If role has AI/ML component, mention the EMNLP 2026 LLM research paper.
   If fintech/banking/insurance role, reference MetLife insurance domain experience.
   If pure Java/backend, highlight the 500GB Azure data pipeline and caching work.
5. Closing: State availability for interview, thank them professionally
6. Sign off: "Warm regards, Aman Siddiqui"
7. Tone: Confident, direct, professional - Australian market style
8. Do NOT start with "I am writing to express my interest"
9. Do NOT use bullet points in the letter body
10. Return ONLY the letter body text - no subject line, no address headers, no metadata

Generate the cover letter now:
`;

    const coverLetter = await gemini.generate(prompt, 0.7, {
      label: "cover-letter",
      metadata: {
        jobId: job.id,
        company: job.company,
        title: job.title,
      },
      logPromptPreview: true,
      logResponsePreview: true,
    });

    logger.info("Cover letter generated", {
      jobId: job.id,
      company: job.company,
      title: job.title,
      length: coverLetter.length,
    });

    return coverLetter;
  } catch (error) {
    logger.error("Failed to generate cover letter", {
      error,
      jobId: job.id,
      company: job.company,
      title: job.title,
    });
    throw error;
  }
};
