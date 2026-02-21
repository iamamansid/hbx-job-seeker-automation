# Quick Reference Guide

## 🚀 Getting Started (5 minutes)

### 1. Install & Setup
```bash
cd "Job Seeker"
npm install
cp .env.example .env
```

### 2. Configure Your Profile
Edit `.env`:
```env
CANDIDATE_NAME=Your Name
CANDIDATE_EMAIL=your@email.com
PRIMARY_SKILLS=Java,Spring Boot,Microservices
```

### 3. Start Ollama
```bash
# Terminal 1
ollama serve

# Terminal 2
ollama pull llama2
```

### 4. Verify Setup
```bash
npm run check:ollama
npm run test:agent
```

### 5. Build
```bash
npm run build
```

---

## 📚 Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies |
| `npm run build` | Compile TypeScript |
| `npm run dev` | Run development mode |
| `npm start` | Run compiled code |
| `npm run test:agent` | Run test suite |
| `npm run check:ollama` | Verify Ollama setup |
| `npm run clean` | Remove build files |

---

## 🎯 Core Concepts

### The Orchestrator
Main controller that runs the workflow:
```typescript
const orchestrator = new JobApplicationOrchestrator();
await orchestrator.initialize();
await orchestrator.processJob(url, jobDescription);
await orchestrator.cleanup();
```

### The Agents
- **PlannerAgent**: Decides if job is relevant
- **ExecutorAgent**: Fills the form
- **ProfileReasoner**: Generates answers

### The Loop
```
SEARCH → ANALYZE → PLAN → ACT → VERIFY → LEARN
```

---

## 🔍 Key Features

### ✅ Local-Only
- No cloud APIs
- Ollama (Llama3.2) runs locally
- SQLite database locally
- All data stays on your machine

### ✅ Intelligent
- LLM analyzes job descriptions
- Scores job relevance
- Generates contextual answers
- Learns from history

### ✅ Safe
- Auto-submit is OFF by default
- Forms filled, not auto-submitted
- Validation gates
- Verification mode available

### ✅ Modular
- Each agent is independent
- Easy to extend
- Reusable components
- Composable workflow

---

## ⚙️ Configuration

| Setting | Purpose | Default |
|---------|---------|---------|
| `OLLAMA_MODEL` | Which LLM model | `llama2` |
| `ENABLE_AUTO_SUBMIT` | Auto-submit forms | `false` ⚠️ |
| `MAX_JOBS_TO_APPLY` | Jobs per session | `5` |
| `BROWSER_HEADLESS` | Show browser | `true` |
| `LOG_LEVEL` | Verbosity | `info` |

More options in `.env.example`

---

## 📊 Database

### SQLite Location
```
data/applications.db
```

### Check Application History
```bash
sqlite3 data/applications.db
SELECT * FROM applications LIMIT 10;
SELECT COUNT(*), status FROM applications GROUP BY status;
```

---

## 🐛 Debug

### Check Logs
```bash
# All logs
tail -f data/combined.log

# Errors only
tail -f data/error.log
```

### Enable Debug Logging
```env
LOG_LEVEL=debug
```

### Check Ollama
```bash
curl http://localhost:11434/api/tags
ollama list
```

---

## 🚨 Common Issues

| Issue | Fix |
|-------|-----|
| "Cannot connect to Ollama" | Run `ollama serve` first |
| "Model not found" | Run `ollama pull llama2` |
| "Port 11434 in use" | Ollama already running (OK) |
| "Forms not auto-filling" | Check field selectors in logs |
| "Database locked" | Restart the agent |

---

## 📈 Workflow Phases

### Phase 1: ANALYZE
- Check if already applied ✓
- Get job description ✓
- Score relevance (0-100%) ✓
- Extract criteria ✓

### Phase 2: PLAN
- Decide "should apply?" ✓
- Plan field strategy ✓
- Identify challenges ✓

### Phase 3: EXECUTE
- Navigate to URL ✓
- Find forms ✓
- Fill fields ✓
- Upload resume ✓

### Phase 4: VERIFY
- Check completion % ✓
- Validate required fields ✓
- Check for errors ✓

### Phase 5: LEARN
- Record in database ✓
- Update stats ✓
- Log insights ✓

---

## 🎓 Architecture Diagram

```
User Input (Job URL + Description)
           ↓
    ┌──────────────┐
    │ ORCHESTRATOR │
    └──────────────┘
           ↓
    ┌──────────────────────────┐
    │ ANALYZE with PlannnerAgent│──> Ollama (LLM)
    └──────────────────────────┘
           ↓
    ┌──────────────────────────┐
    │ PLAN with PlannerAgent   │──> Ollama (LLM)
    └──────────────────────────┘
           ↓
    ┌──────────────────────────┐
    │ EXECUTE with ExecutorAgent│──> Playwright (Browser)
    │ + ProfileReasoner        │──> Ollama (LLM)
    └──────────────────────────┘
           ↓
    ┌──────────────────────────┐
    │ VERIFY results           │
    └──────────────────────────┘
           ↓
    ┌──────────────────────────┐
    │ LEARN + Store in DB      │──> SQLite
    └──────────────────────────┘
           ↓
    Output:ApplicationRecord
```

---

## 💡 Pro Tips

1. **Safety First**: Keep `ENABLE_AUTO_SUBMIT=false` until confident
2. **Monitor Logs**: Watch `data/combined.log` during test runs
3. **Test First**: Run `npm run test:agent` before processing
4. **Check Database**: Verify applications were recorded
5. **Adjust Timing**: Increase `BROWSER_SLOW_MO` if forms lag
6. **View Screenshots**: Check `data/screenshots/` for debugging

---

## 🔗 Important Links

- **Ollama**: https://ollama.ai
- **Playwright**: https://playwright.dev
- **Llama Models**: https://huggingface.co/meta-llama
- **Node.js**: https://nodejs.org

---

## 📞 Support

1. **Check Logs**: `data/combined.log`
2. **Run Tests**: `npm run test:agent`
3. **Verify Setup**: `npm run check:ollama`
4. **Read Docs**: See README.md and ARCHITECTURE.md

---

## ✨ Next Steps

1. ✅ Complete setup (follow "Getting Started")
2. ✅ Configure candidate profile (.env)
3. ✅ Run tests (`npm run test:agent`)
4. ✅ Find a job URL
5. ✅ Create JobDescription object
6. ✅ Call `orchestrator.processJob(url, description)`
7. ✅ Review application in browser
8. ✅ Check database for results

---

**Ready to automate your job applications? Let's go! 🚀**
