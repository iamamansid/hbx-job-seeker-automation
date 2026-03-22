import { type ScreeningFieldType } from "../seek/types";
import { logger } from "../utils/logger";
import { normalizeForMatch } from "../utils/text";
import { gemini } from "./geminiClient";

const coerceToAvailableOption = (answer: string, options?: string[]): string => {
  if (!options || options.length === 0) {
    return answer.trim();
  }

  const exact = options.find((option) => normalizeForMatch(option) === normalizeForMatch(answer));
  if (exact) {
    return exact;
  }

  const partial = options.find((option) => normalizeForMatch(option).includes(normalizeForMatch(answer)));
  if (partial) {
    return partial;
  }

  const reversePartial = options.find((option) => normalizeForMatch(answer).includes(normalizeForMatch(option)));
  return reversePartial ?? answer.trim();
};

export const answerScreeningQuestion = async (
  question: string,
  fieldType: ScreeningFieldType,
  options?: string[],
): Promise<string> => {
  try {
    const optionsText =
      options && options.length > 0
        ? `AVAILABLE OPTIONS (select/radio must match one exactly): ${options.join(" | ")}`
        : "AVAILABLE OPTIONS: none provided";

    const prompt = `
You are answering job application screening questions on behalf of Aman Siddiqui.

APPLICANT PROFILE:
- 3+ years Java/Spring Boot/Azure/GenAI engineer
- Requires 482 visa sponsorship to work in Australia
- Located in India, available to relocate immediately
- AZ-204 Azure Developer Associate certified
- B.Tech SVNIT Surat (8.5 GPA), M.Tech CS BITS Pilani (in progress)
- Experience: MetLife (Lead API Developer) and Deloitte (Software Developer)
- Current salary: Indian market; Target Australian salary: AUD 110,000 to 130,000
- Notice period: 4 to 8 weeks, flexible for the right opportunity

SCREENING QUESTION: "${question}"
FIELD TYPE: ${fieldType}
${optionsText}

ANSWERING RULES - follow these strictly:
- Never lie, never exaggerate any claim
- "Years of experience with Java" type: answer "3"
- "Years of experience with Spring Boot" type: answer "3"
- "Years of experience with Azure/Cloud" type: answer "2"
- "Are you in Australia / located in Australia" type: answer "No, but available to relocate immediately with employer sponsorship"
- "Do you have right to work in Australia" type: answer "No, I require 482 employer sponsorship"
- "Salary expectation" type: answer "110000 to 130000 AUD, negotiable"
- "Notice period" type: answer "4 to 8 weeks, flexible"
- "Do you have [specific certification]" type: if AZ-204 or Azure, answer "Yes". Otherwise "No"
- "Are you willing to relocate" type: answer "Yes, immediately"
- "Do you have experience with [skill in Aman's primary stack]" type: answer "Yes"
- "Do you have experience with [skill NOT in Aman's stack]" type: answer "No"
- For radio/select fields: return only the exact option text to select
- For text/number fields: return only the answer value, no explanation

Return ONLY the answer - no preamble, no explanation, no punctuation beyond the answer itself.
`;

    const answer = await gemini.generate(prompt, 0.1, {
      label: "screening-question",
      metadata: {
        fieldType,
        optionsCount: options?.length ?? 0,
      },
      logPromptPreview: true,
      logResponsePreview: true,
    });
    const coercedAnswer = coerceToAvailableOption(answer, options);

    logger.info("Screening question answered", {
      fieldType,
      questionPreview: question.slice(0, 200),
      rawAnswer: answer,
      coercedAnswer,
      optionsCount: options?.length ?? 0,
    });

    return coercedAnswer;
  } catch (error) {
    logger.error("Failed to answer screening question", {
      error,
      question,
      fieldType,
    });
    throw error;
  }
};
