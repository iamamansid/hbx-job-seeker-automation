import { type JobDetails, type SponsorshipDecision } from "../seek/types";
import { normalizeForMatch, uniqueStrings } from "../utils/text";

const INCLUDE_SIGNALS = [
  "482",
  "subclass 482",
  "visa sponsorship",
  "sponsor visa",
  "employer sponsor",
  "sponsorship available",
  "visa support",
  "we sponsor",
  "sponsorship considered",
  "open to sponsoring",
  "relocation assistance",
  "willing to sponsor",
  "sponsorship provided",
  "work visa",
  "work rights not required",
  "all visa types",
];

const EXCLUDE_SIGNALS = [
  "must hold australian citizenship",
  "australian citizenship or permanent residency",
  "australian citizen or pr only",
  "pr or citizenship required",
  "must be australian citizen",
  "no visa sponsorship",
  "unable to sponsor",
  "cannot sponsor",
  "sponsorship not available",
  "must have full work rights",
  "must have unrestricted work rights",
  "australian residents only",
  "nv1 clearance",
  "security clearance required",
  "baseline clearance",
];

const KNOWN_SPONSORS = [
  "tcs",
  "tata consultancy",
  "infosys",
  "wipro",
  "hcl",
  "accenture",
  "capgemini",
  "thoughtworks",
  "dxc technology",
  "anz bank",
  "commonwealth bank",
  "cba",
  "nab",
  "westpac",
  "rea group",
  "canva",
  "atlassian",
  "iag",
  "amp",
  "suncorp",
  "qbe",
  "deloitte",
  "kpmg",
  "pwc",
  "ey",
];

const KNOWN_NON_SPONSORS = [
  "dws limited",
  "dws group",
  "australian public service",
  "aps",
  "department of",
  "australian government",
  "state government",
  "defence",
  "department of defence",
];

const findMatches = (text: string, candidates: string[]): string[] => {
  const normalized = normalizeForMatch(text);
  return candidates.filter((candidate) => normalized.includes(normalizeForMatch(candidate)));
};

export const sponsorshipFilter = (job: JobDetails): SponsorshipDecision => {
  const combined = `${job.title}\n${job.company}\n${job.location}\n${job.description}`;
  const company = normalizeForMatch(job.company);

  const knownNonSponsorMatches = KNOWN_NON_SPONSORS.filter((candidate) => company.includes(candidate));
  if (knownNonSponsorMatches.length > 0) {
    return {
      status: "excluded",
      reasons: uniqueStrings(knownNonSponsorMatches.map((match) => `Known non-sponsor: ${match}`)),
    };
  }

  const excludeMatches = findMatches(combined, EXCLUDE_SIGNALS);
  if (excludeMatches.length > 0) {
    return {
      status: "excluded",
      reasons: uniqueStrings(excludeMatches),
    };
  }

  const includeMatches = findMatches(combined, INCLUDE_SIGNALS);
  const knownSponsorMatches = KNOWN_SPONSORS.filter((candidate) => company.includes(candidate));

  if (includeMatches.length > 0) {
    return {
      status: "confirmed",
      reasons: uniqueStrings([
        ...includeMatches,
        ...knownSponsorMatches.map((match) => `Known sponsor: ${match}`),
      ]),
    };
  }

  if (knownSponsorMatches.length > 0) {
    return {
      status: "likely",
      reasons: uniqueStrings(knownSponsorMatches.map((match) => `Known sponsor: ${match}`)),
    };
  }

  return {
    status: "silent",
    reasons: [],
  };
};
