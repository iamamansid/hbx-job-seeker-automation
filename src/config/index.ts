import "dotenv/config";

export const config = {
  // Ollama configuration
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    model: process.env.OLLAMA_MODEL || "llama2",
    temperature: parseFloat(process.env.OLLAMA_TEMPERATURE || "0.7"),
    topP: parseFloat(process.env.OLLAMA_TOP_P || "0.9"),
  },

  // Candidate information
  candidate: {
    name: process.env.CANDIDATE_NAME || "Aman Siddiqui",
    email: process.env.CANDIDATE_EMAIL || "aman.siddiqui114@gmail.com",
    phone: process.env.CANDIDATE_PHONE || "+919415584405",
    linkedInUrl: process.env.LINKEDIN_URL || "https://www.linkedin.com/in/aman-siddiqui-b511871b6",
    portfolioUrl: process.env.PORTFOLIO_URL || "https://majestic-tarsier-5a5635.netlify.app/",
    currentLocation: process.env.CURRENT_LOCATION || "New Delhi, India",
    willingToRelocate: process.env.WILLING_TO_RELOCATE === "true",
    requiresSponsorship: process.env.REQUIRES_SPONSORSHIP === "true",
    visaStatus: process.env.VISA_STATUS || "No",
    resumePath: process.env.RESUME_PATH || "./data/resume.pdf",
    yearsOfExperience: parseInt(process.env.YEARS_EXPERIENCE || "3"),
    primarySkills: (process.env.PRIMARY_SKILLS || "Java,Spring Boot,Microservices,REST APIs").split(","),
    secondarySkills: (process.env.SECONDARY_SKILLS || "Docker,Kubernetes,PostgreSQL").split(","),
  },

  // Browser configuration
  browser: {
    headless: process.env.BROWSER_HEADLESS !== "false",
    slowMo: parseInt(process.env.BROWSER_SLOW_MO || "500"),
    timeout: parseInt(process.env.BROWSER_TIMEOUT || "30000"),
  },

  // Job search configuration
  search: {
    searchTerms: (process.env.SEARCH_TERMS || "Java Backend Developer").split("|"),
    maxJobsToApply: parseInt(process.env.MAX_JOBS_TO_APPLY || "5"),
    jobBoardUrls: (process.env.JOB_BOARDS || "").split("|").filter(Boolean),
  },

  // Agent configuration
  agent: {
    maxRetries: parseInt(process.env.MAX_RETRIES || "3"),
    maxSteps: parseInt(process.env.MAX_STEPS || "50"),
    enableAutoSubmit: process.env.ENABLE_AUTO_SUBMIT === "true", // SAFETY: Default is false
    verificationMode: process.env.VERIFICATION_MODE === "true", // Ask before actions
  },

  // Memory/Storage configuration
  memory: {
    dbPath: process.env.DB_PATH || "./data/applications.db",
    maxHistoryDays: parseInt(process.env.MAX_HISTORY_DAYS || "90"),
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || "info",
  },
};

export default config;
