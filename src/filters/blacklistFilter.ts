import { db } from "../db/jobDatabase";
import { type BlacklistMatchResult, type JobDetails } from "../seek/types";
import { normalizeForMatch, uniqueStrings } from "../utils/text";

const blacklistedCompanies = new Set<string>();
const blacklistedTitlePatterns = new Set<string>();

export async function loadBlacklistFromDb(): Promise<void> {
  const entries = await db.getBlacklist();

  blacklistedCompanies.clear();
  blacklistedTitlePatterns.clear();

  for (const entry of entries) {
    const normalized = normalizeForMatch(entry.value);
    if (!normalized) {
      continue;
    }

    if (entry.type === "company") {
      blacklistedCompanies.add(normalized);
      continue;
    }

    if (entry.type === "title_pattern") {
      blacklistedTitlePatterns.add(normalized);
    }
  }
}

export const blacklistFilter = (job: JobDetails): BlacklistMatchResult => {
  const company = normalizeForMatch(job.company);
  const title = normalizeForMatch(job.title);
  const reasons: string[] = [];

  for (const blacklistedCompany of blacklistedCompanies) {
    if (company.includes(blacklistedCompany)) {
      reasons.push(`Blacklisted company: ${blacklistedCompany}`);
    }
  }

  for (const titlePattern of blacklistedTitlePatterns) {
    if (title.includes(titlePattern)) {
      reasons.push(`Blacklisted title pattern: ${titlePattern}`);
    }
  }

  return {
    blocked: reasons.length > 0,
    reasons: uniqueStrings(reasons),
  };
};
