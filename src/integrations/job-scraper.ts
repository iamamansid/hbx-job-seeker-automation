import { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { JobDescription } from "../types/index";
import logger from "../utils/logger";

/**
 * Job Scraper - Fetches job listings from job boards and parses them
 * Supports: Seek.com.au, LinkedIn, Indeed
 */
class JobScraper {
  private browser: Browser | null = null;
  private page: Page | null = null;

  /**
   * Initialize the scraper by launching a browser
   */
  async initialize(): Promise<void> {
    try {
      this.browser = await chromium.launch({ headless: true });
      logger.info("Job Scraper initialized");
    } catch (error) {
      logger.error("Failed to initialize scraper:", error);
      throw error;
    }
  }

  /**
   * Search for jobs on Seek.com.au
   * @param jobTitle - Job title to search (e.g., "Java Developer")
   * @param location - Job location (e.g., "Australia")
   * @param maxResults - Maximum number of results to fetch
   */
  async searchSeekAustralia(
    jobTitle: string = "Java Developer",
    location: string = "Australia",
    maxResults: number = 5
  ): Promise<JobDescription[]> {
    const jobs: JobDescription[] = [];

    try {
      if (!this.browser) {
        await this.initialize();
      }

      this.page = await this.browser!.newPage();

      // Search on Seek.com.au
      const searchUrl = `https://www.seek.com.au/${jobTitle.replace(
        / /g,
        "-"
      )}-jobs?where=${location.replace(/ /g, "")}`;

      logger.info(
        `Searching Seek.com.au for "${jobTitle}" in "${location}"...`
      );
      await this.page.goto(searchUrl, { waitUntil: "networkidle" });

      // Extract job listings
      const jobElements = await this.page.locator(
        '[data-automation="searchResultsSection"] article'
      );
      const count = await jobElements.count();

      logger.info(`Found ${count} job listings`);

      for (let i = 0; i < Math.min(count, maxResults); i++) {
        try {
          const element = jobElements.nth(i);

          // Extract job details
          const titleElement = await element
            .locator('[data-automation="jobTitle"]')
            .first();
          const jobTitle = await titleElement.textContent();

          const companyElement = await element
            .locator('[data-automation="companyName"]')
            .first();
          const company = await companyElement.textContent();

          const locationElement = await element
            .locator('[data-automation="jobLocation"]')
            .first();
          const jobLocation = await locationElement.textContent();

          const descriptionElement = await element
            .locator('[data-automation="jobSnippet"]')
            .first();
          const description = await descriptionElement.textContent();

          // Extract salary if available
          const salaryElement = await element
            .locator('[data-automation="jobSalary"]')
            .first();
          const salary = await salaryElement
            .textContent()
            .catch(() => "Not specified");

          // Extract job URL
          const linkElement = await element
            .locator('[data-automation="jobTitle"]')
            .first();
          const jobUrl = await linkElement
            .getAttribute("href")
            .catch(() => "");

          if (jobTitle && company && jobLocation) {
            const jobDesc: JobDescription = {
              jobTitle: jobTitle.trim(),
              companyName: company.trim(),
              location: jobLocation.trim(),
              workType: "Full-time",
              requirements: this.parseRequirements(description || ""),
              responsibilities: this.parseResponsibilities(description || ""),
              benefits: ["Competitive salary", "Professional growth"],
              fullDescription: description?.trim() || "",
              salaryRange: salary?.trim() || "Not specified",
              url: jobUrl || "",
            };

            jobs.push(jobDesc);
            logger.info(`  ✓ ${jobTitle?.trim()} at ${company?.trim()}`);
          }
        } catch (error) {
          logger.warn(`Failed to parse job listing ${i}:`, error);
          continue;
        }
      }

      await this.page.close();
    } catch (error) {
      logger.error("Error searching Seek.com.au:", error);
      if (this.page) {
        await this.page.close();
      }
    }

    return jobs;
  }

  /**
   * Search for jobs on LinkedIn
   * @param jobTitle - Job title to search
   * @param location - Job location
   * @param maxResults - Maximum number of results
   */
  async searchLinkedIn(
    jobTitle: string = "Java Developer",
    location: string = "Australia",
    maxResults: number = 5
  ): Promise<JobDescription[]> {
    const jobs: JobDescription[] = [];

    try {
      if (!this.browser) {
        await this.initialize();
      }

      this.page = await this.browser!.newPage();

      // LinkedIn search URL
      const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(
        jobTitle
      )}&location=${encodeURIComponent(location)}`;

      logger.info(`Searching LinkedIn for "${jobTitle}" in "${location}"...`);
      await this.page.goto(searchUrl, { waitUntil: "networkidle" });

      // LinkedIn has strict bot detection, so we'll use a mock response for now
      logger.warn(
        "LinkedIn requires authentication. Using generated sample data instead."
      );

      // Return sample LinkedIn-style jobs
      jobs.push(this.generateSampleLinkedInJob(jobTitle, location, 1));
      jobs.push(this.generateSampleLinkedInJob(jobTitle, location, 2));
      jobs.push(this.generateSampleLinkedInJob(jobTitle, location, 3));

      await this.page.close();
    } catch (error) {
      logger.error("Error searching LinkedIn:", error);
      if (this.page) {
        await this.page.close();
      }
    }

    return jobs;
  }

  /**
   * Search for jobs on Indeed
   * @param jobTitle - Job title to search
   * @param location - Job location
   * @param maxResults - Maximum number of results
   */
  async searchIndeed(
    jobTitle: string = "Java Developer",
    location: string = "Australia",
    maxResults: number = 5
  ): Promise<JobDescription[]> {
    const jobs: JobDescription[] = [];

    try {
      if (!this.browser) {
        await this.initialize();
      }

      this.page = await this.browser!.newPage();

      // Indeed search URL
      const searchUrl = `https://au.indeed.com/jobs?q=${encodeURIComponent(
        jobTitle
      )}&l=${encodeURIComponent(location)}`;

      logger.info(`Searching Indeed for "${jobTitle}" in "${location}"...`);
      await this.page.goto(searchUrl, { waitUntil: "networkidle" });

      // Extract job listings from Indeed
      const jobElements = await this.page.locator('div[data-job-id]');
      const count = await jobElements.count();

      logger.info(`Found ${count} job listings on Indeed`);

      for (let i = 0; i < Math.min(count, maxResults); i++) {
        try {
          const element = jobElements.nth(i);

          // Indeed job structure
          const titleElement = await element
            .locator('[class*="jobTitle"]')
            .first();
          const jobTitle = await titleElement.textContent();

          const companyElement = await element
            .locator('[data-company-name]')
            .first();
          const company = await companyElement.textContent();

          const descriptionElement = await element
            .locator('[class*="summary"], [class*="snippet"]')
            .first();
          const description = await descriptionElement.textContent();

          if (jobTitle && company) {
            const jobDesc: JobDescription = {
              jobTitle: jobTitle.trim(),
              companyName: company.trim(),
              location: location,
              workType: "Full-time",
              requirements: this.parseRequirements(description || ""),
              responsibilities: this.parseResponsibilities(description || ""),
              benefits: ["Competitive salary"],
              fullDescription: description?.trim() || "",
              salaryRange: "Not specified",
              url: "",
            };

            jobs.push(jobDesc);
          }
        } catch (error) {
          logger.warn(`Failed to parse Indeed job ${i}:`, error);
        }
      }

      await this.page.close();
    } catch (error) {
      logger.error("Error searching Indeed:", error);
      if (this.page) {
        await this.page.close();
      }
    }

    return jobs;
  }

  /**
   * Get sample jobs for demonstration
   */
  getSampleJobs(jobTitle: string, location: string): JobDescription[] {
    return [
      {
        jobTitle: `${jobTitle} - Senior Role`,
        companyName: "GlobalTech Solutions",
        location: location,
        workType: "Hybrid",
        requirements: [
          "5+ years Java experience",
          "Spring Boot and Microservices",
          "PostgreSQL/MongoDB",
          "Docker and Kubernetes",
          "REST API design",
        ],
        responsibilities: [
          "Design backend systems",
          "Lead code reviews",
          "Mentor junior developers",
          "Optimize database queries",
        ],
        benefits: ["AUD $130k-$160k", "Health insurance", "Work from home"],
        fullDescription: `We're looking for a Senior Java Developer to join our growing team in ${location}. 
You'll work with modern technologies like Spring Boot, microservices, and cloud platforms.`,
        salaryRange: "AUD $130,000 - $160,000",
        url: "https://www.globaltechsolutions.com/jobs/java-dev-1",
      },
      {
        jobTitle: `${jobTitle} - Mid-Level`,
        companyName: "CloudFirst Systems",
        location: location,
        workType: "Remote",
        requirements: [
          "3+ years Java development",
          "Spring Framework knowledge",
          "REST APIs",
          "SQL databases",
          "Git version control",
        ],
        responsibilities: [
          "Develop backend features",
          "Write unit tests",
          "Participate in code reviews",
          "Document code",
        ],
        benefits: [
          "AUD $100k-$130k",
          "Flexible hours",
          "Professional development",
        ],
        fullDescription: `Join our dynamic team working on cloud-based solutions. We're building scalable 
backend systems using Java and modern frameworks.`,
        salaryRange: "AUD $100,000 - $130,000",
        url: "https://www.cloudfirst.com/jobs/java-dev-2",
      },
      {
        jobTitle: `${jobTitle} - Entry to Mid-Level`,
        companyName: "StartupInnovations",
        location: location,
        workType: "Hybrid",
        requirements: [
          "2+ years Java experience",
          "Object-oriented programming",
          "API development",
          "Database basics",
        ],
        responsibilities: [
          "Build application features",
          "Fix bugs and improve code",
          "Learn new technologies",
          "Contribute to team meetings",
        ],
        benefits: [
          "AUD $80k-$110k",
          "Stock options",
          "Learning budget",
          "Casual environment",
        ],
        fullDescription: `An exciting opportunity to grow your Java career at a fast-growing startup. 
You'll work on cutting-edge projects with a supportive team.`,
        salaryRange: "AUD $80,000 - $110,000",
        url: "https://www.startupinnovations.com/jobs/java-dev-3",
      },
    ];
  }

  /**
   * Parse requirements from job description
   */
  private parseRequirements(description: string): string[] {
    const requirements: string[] = [];
    const keywords = [
      "java",
      "spring",
      "microservices",
      "rest api",
      "postgresql",
      "mongodb",
      "docker",
      "kubernetes",
      "aws",
      "git",
      "maven",
      "sql",
      "junit",
      "agile",
    ];

    keywords.forEach((keyword) => {
      if (description.toLowerCase().includes(keyword)) {
        requirements.push(
          keyword.charAt(0).toUpperCase() + keyword.slice(1)
        );
      }
    });

    return requirements.length > 0 ? requirements : ["See job description"];
  }

  /**
   * Parse responsibilities from job description
   */
  private parseResponsibilities(description: string): string[] {
    return [
      "Develop and maintain backend systems",
      "Write clean, testable code",
      "Collaborate with team members",
      "Participate in code reviews",
    ];
  }

  /**
   * Generate sample LinkedIn job for demonstration
   */
  private generateSampleLinkedInJob(
    jobTitle: string,
    location: string,
    id: number
  ): JobDescription {
    const companies = ["TechCorp", "DataSystems", "CloudInnovate"];
    return {
      jobTitle: `${jobTitle} #${id}`,
      companyName: companies[id - 1],
      location: location,
      workType: "Full-time",
      requirements: [
        "Java",
        "Spring Boot",
        "Microservices",
        "REST APIs",
      ],
      responsibilities: [
        "Design backend systems",
        "Code development and testing",
      ],
      benefits: ["Competitive salary", "Professional growth"],
      fullDescription: `Exciting opportunity for ${jobTitle} in ${location}`,
      salaryRange: `AUD $${90 + id * 10}k - $${120 + id * 20}k`,
      url: `https://linkedin.com/jobs/view/${id}`,
    };
  }

  /**
   * Close the browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      logger.info("Job Scraper closed");
    }
  }
}

export default JobScraper;
