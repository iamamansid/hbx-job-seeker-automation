# Autonomous Local Job Application Agent

A sophisticated, **fully local** autonomous AI job application agent that operates without any cloud APIs. Uses Llama 3.2 running locally via Ollama, Node.js, and Playwright.

## 🎯 Key Features

- **Fully Local**: No cloud APIs, all reasoning happens on your machine
- **Autonomous Agents**: 
  - **PlannerAgent**: Analyzes job relevance and creates strategy
  - **ExecutorAgent**: Controls browser and fills forms
  - **ProfileReasoner**: Infers missing candidate information
- **Smart Decision Making**: Uses LLM to:
  - Determine if a job is relevant
  - Plan the best approach for each application
  - Generate contextual answers to questions
  - Detect duplicates to avoid re-applying
- **Memory System**: SQLite database tracks all applications
- **Safety Layer**: Explicitly prevents auto-submission by default
- **Deterministic Prompts**: Structured JSON outputs from LLM
- **Human-like Behavior**: Scrolling, waiting, retries to avoid bot detection

## 🏗️ Architecture

```
SEARCH → ANALYZE → PLAN → ACT → VERIFY → LEARN
  ↓        ↓        ↓     ↓       ↓        ↓
Find    Relevancy  Plan  Execute Check   Extract
Jobs    Check      Form  Form    Fill    Insights
```

### Core Components

```
┌─────────────────────────────────────────────┐
│         Orchestrator (Main Loop)            │
├─────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌──────────┐   │
│  │ Planner │  │Executor │  │ Reasoner │   │
│  │ Agent   │  │ Agent   │  │ Agent    │   │
│  └────┬────┘  └────┬────┘  └────┬─────┘   │
├──────┴──────────────┴──────────────┴───────┤
│                                             │
│  ┌──────────────┐    ┌──────────────┐     │
│  │  Ollama      │    │   Browser    │     │
│  │  (Llama3.2)  │    │  (Playwright)│     │
│  └──────────────┘    └──────────────┘     │
├─────────────────────────────────────────────┤
│         Memory Manager (SQLite)             │
├─────────────────────────────────────────────┤
│  • Application History                      │
│  • Rejected Jobs (Duplicates)               │
│  • Statistics & Learning                    │
└─────────────────────────────────────────────┘
```

## 📋 Prerequisites

### Required
- **Node.js** 18+ ([download](https://nodejs.org/))
- **Ollama** with Llama 3.2 ([download](https://ollama.ai))
- **Playwright** (auto-installed)
- **SQLite3** (auto-installed)

### Hardware Recommendations
- **Minimum**: 4GB RAM + 8GB storage for Ollama
- **Recommended**: 16GB RAM for smooth operation
- **Optimal**: GPU acceleration (CUDA/Metal)

## 🚀 Setup

### 1. Clone and Install

```bash
# Navigate to project directory
cd "Job Seeker"

# Install dependencies
npm install

# Or with Yarn
yarn install
```

### 2. Install Ollama and Download Model

```bash
# Download Ollama from https://ollama.ai
# Run Ollama service
ollama serve

# In another terminal, download Llama 3.2
ollama pull llama2
# Or try neural-chat for smaller size:
ollama pull neural-chat
```

### 3. Configure Environment

```bash
# Copy example configuration
cp .env.example .env

# Edit .env with your information
# - Candidate details (name, email, skills, etc.)
# - Job search preferences
# - Ollama model and settings
```

### 4. Verify Setup

```bash
# Check Ollama connection
npm run check:ollama

# If successful, you'll see:
# ✓ Ollama is running!
# ✓ Available models listed
# ✓ Model generation works!
```

## 🧪 Testing

Run full test suite:

```bash
npm run test:agent
```

Tests cover:
- ✓ Ollama connectivity and generation
- ✓ Browser launch and navigation
- ✓ Job relevance analysis
- ✓ Profile information inference
- ✓ Memory/database operations

## 💻 Usage

### Basic Example

```typescript
import JobApplicationOrchestrator from "@/orchestrator/orchestrator";
import { JobDescription } from "@/types/index";

const orchestrator = new JobApplicationOrchestrator();
await orchestrator.initialize();

const jobDescription: JobDescription = {
  jobTitle: "Senior Java Backend Engineer",
  companyName: "TechCorp",
  location: "San Francisco, CA",
  workType: "Hybrid",
  requirements: ["5+ years Java", "Spring Boot", "Microservices"],
  responsibilities: ["Design systems", "Lead team"],
  fullDescription: "...",
};

// Process a single job
await orchestrator.processJob("https://example.com/job/1", jobDescription);

// Or process multiple jobs
const jobs = [
  { url: "https://...", description: jobDescription },
  // ... more jobs
];
await orchestrator.processJobs(jobs);
```

### Configuration

All settings in `.env` file:

| Setting | Purpose | Default |
|---------|---------|---------|
| `OLLAMA_MODEL` | LLM model to use | `llama2` |
| `ENABLE_AUTO_SUBMIT` | Auto-click submit (⚠️ safety off) | `false` |
| `MAX_JOBS_TO_APPLY` | Jobs to apply per session | `5` |
| `BROWSER_HEADLESS` | Hide browser window | `true` |
| `LOG_LEVEL` | Logging verbosity | `info` |

### Candidate Profile

Configure in `.env`:

```env
CANDIDATE_NAME=Your Name
CANDIDATE_EMAIL=your@email.com
PRIMARY_SKILLS=Java,Spring Boot,Microservices
YEARS_EXPERIENCE=5
WILLING_TO_RELOCATE=true
REQUIRES_SPONSORSHIP=false
RESUME_PATH=./data/resume.pdf
```

## 🔄 Workflow Loop

### Phase 1: ANALYZE
```
✓ Check if already applied
✓ Analyze job description
✓ Rate relevance (0-100%)
✓ Extract key requirements
```

### Phase 2: PLAN
```
✓ Decide "should we apply?"
✓ Plan field-by-field strategy
✓ Identify expected challenges
✓ Note key practices to highlight
```

### Phase 3: EXECUTE
```
✓ Navigate to application URL
✓ Find form fields
✓ Fill with candidate info (name, email, phone)
✓ Generate contextual answers
✓ Upload resume
✓ Handle dynamic forms/validations
```

### Phase 4: VERIFY
```
✓ Calculate form completion %
✓ Check for errors
✓ Validate all required fields filled
✓ Preview before submission
```

### Phase 5: LEARN
```
✓ Record in database
✓ Update statistics
✓ Log patterns for future improvements
```

## 📊 Memory & Statistics

Applications are stored in SQLite database:

```bash
# View database (uses SQLite CLI)
sqlite3 data/applications.db

# Check statistics
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN status='applied' THEN 1 END) as successful,
  SUM(CASE WHEN status='failed' THEN 1 END) as failed,
  AVG(relevanceScore) as avg_relevance
FROM applications;
```

## 🛡️ Safety Features

### 1. Auto-Submit Protection
- **Default**: `ENABLE_AUTO_SUBMIT=false` (safe mode)
- No automatic form submission unless explicitly enabled
- Forms are filled but NOT submitted without verification

### 2. Duplicate Prevention
- Tracks all applications in local database
- Avoids re-applying to same job
- Maintains "rejected jobs" list

### 3. Verification Mode
- `VERIFICATION_MODE=true` asks before sensitive actions
- Human-in-the-loop for critical decisions
- Prevents bot-like behavior

### 4. Rate Limiting
- Delays between form actions
- Respects website request rates
- Human-like interactions (scrolling, waiting)

## 📝 LLM Prompts

All prompts are **deterministic** and structured:

```typescript
// Examples of structured outputs
{
  "isRelevant": boolean,
  "relevanceScore": number,
  "reasoning": string,
  "criteriaMatched": [string],
  "criteriaNotMatched": [string]
}
```

Prevents hallucination through:
- Schema validation with Zod
- Clear JSON formatting requirements
- Temperature set to 0.7 (balance between creativity and consistency)

## 🐛 Troubleshooting

### Ollama Not Connecting
```bash
# Ensure Ollama is running
ollama serve

# Check the service is accessible
curl http://localhost:11434/api/tags
```

### Model Not Found
```bash
# List installed models
ollama list

# Install a model
ollama pull llama2
ollama pull neural-chat  # Faster, smaller
```

### Browser Launcher Issues
```bash
# Playwright might need system dependencies
# On Linux:
sudo apt-get install libglib2.0-0 libx11-6

# On macOS:
brew install libffi libxkbcommon
```

### Database Lock
```bash
# Remove stale database
rm data/applications.db

# Restart application
npm run dev
```

## 📈 Extending the Agent

### Add Custom Job Source
```typescript
// src/search/custom-source.ts
class CustomJobSource {
  async search(query: string): Promise<JobDescription[]> {
    // Implement job scraping
  }
}
```

### Implement ML Learning
```typescript
// src/learning/ml-learner.ts
class MLLearner {
  async findPatterns(history: ApplicationRecord[]) {
    // Analyze success patterns
    // Improve future job matching
  }
}
```

### Add More Job Boards
- Integrate LinkedIn API
- Scrape Indeed
- Parse custom job feeds
- Connect to ATS systems

## 📚 Project Structure

```
src/
├── agents/           # AI decision makers
│   ├── planner-agent.ts      # Job relevance & strategy
│   ├── executor-agent.ts     # Browser automation
│   └── profile-reasoner.ts   # Infer missing info
├── browser/          # Playwright wrapper
│   └── browser-agent.ts      # Form interaction
├── llm/              # Ollama integration
│   └── ollama-client.ts      # LLM communication
├── memory/           # Data persistence
│   └── memory-manager.ts     # SQLite operations
├── orchestrator/     # Main workflow
│   └── orchestrator.ts       # Orchestration loop
├── types/            # TypeScript definitions
│   └── index.ts              # Zod schemas
├── utils/            # Helpers
│   ├── logger.ts             # Winston logging
│   └── check-ollama.ts       # Validation
├── config/
│   └── index.ts              # Configuration
├── index.ts          # Main entry point
└── test.ts           # Test suite
```

## 🔐 Privacy & Security

- ✓ **All processing local**: No data sent to cloud
- ✓ **No API keys needed**: Uses only local Ollama
- ✓ **Secure storage**: Local SQLite database
- ✓ **Resume privacy**: Kept locally, only used for filling forms
- ✓ **No telemetry**: Zero external tracking

## ⚖️ Legal & Ethical

This agent is designed for:
- ✓ Automating YOUR OWN job applications
- ✓ Filling forms with YOUR OWN information
- ✓ Saving time on administrative tasks

⚠️ NOT for:
- ✗ Scraping job boards
- ✗ Falsifying information
- ✗ Violating terms of service
- ✗ Spam or abuse

## 📄 License

MIT - Use freely, modify as needed

## 🤝 Contributing

Ideas welcome! The architecture is modular:
- Add new agents for specific tasks
- Extend supported job board types
- Improve LLM prompt engineering
- Add data analytics/learning

## 📞 Support

For issues:
1. Check logs: `data/combined.log`
2. Run test suite: `npm run test:agent`
3. Verify Ollama: `npm run check:ollama`
4. Check `.env` configuration

## 🚀 Future Enhancements

**Planned:**
- [ ] LinkedIn authentication for job search
- [ ] Interview scheduling automation
- [ ] Email conversation with recruiters
- [ ] ML-based success prediction
- [ ] Web UI dashboard
- [ ] Mobile push notifications
- [ ] Multi-language support
- [ ] Career coaching with LLM

**In Development:**
- Job board integrations (Indeed, Dice, LinkedIn)
- Resume parsing for auto-profiling
- Cover letter generation
- Salary negotiation suggestions

---

**Status**: ✨ Production Ready (with safety features)

**Version**: 1.0.0

**Last Updated**: February 2026
