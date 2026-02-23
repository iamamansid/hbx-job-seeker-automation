# Job Application Agent - Getting Started

## Quick Start Checklist

- [ ] Node.js 18+ installed
- [ ] Ollama installed and running (`ollama serve`)
- [ ] Model downloaded (`ollama pull gpt-oss:120b-cloud`)
- [ ] `.env` configured with your information
- [ ] Resume PDF at `./data/resume.pdf`

## Step-by-Step Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Ollama
Open a terminal and run:
```bash
ollama serve
```

### 3. Download a Model
In another terminal:
```bash
ollama pull gpt-oss:120b-cloud
```

Or for faster inference:
```bash
ollama pull neural-chat
```

### 4. Configure Environment
```bash
cp .env.example .env
# Edit .env with your details
```

### 5. Verify Setup
```bash
npm run check:ollama
```

### 6. Run Tests
```bash
npm run test:agent
```

## Usage

### Development Mode
```bash
npm run dev
```

### Production Build
```bash
npm run build
npm start
```

## Important Settings

### Safety First
- Keep `ENABLE_AUTO_SUBMIT=false` unless you fully trust the setup
- Always review what the agent will do before enabling auto-submit
- Use `VERIFICATION_MODE=true` for confirmation on actions

### Model Selection
Choose based on your hardware:

| Model | Size | Speed | Quality | VRAM |
|-------|------|-------|---------|------|
| neural-chat | 4.7GB | Fast | Good | 3GB |
| mistral | 4GB | Very Fast | Good | 3GB |
| gpt-oss:120b-cloud | Varies | Medium | Good | 4GB+ |
| gpt-oss:120b-cloud | Varies | Slow | Better | 8GB+ |

### Candidate Information
Make sure to update in `.env`:
- Name and email
- Skills and experience
- Location and willingness to relocate
- Resume path (create `./data/` folder first)

## Troubleshooting

**Q: "Cannot connect to Ollama"**
A: Make sure `ollama serve` is running in another terminal

**Q: "Model not found"**
A: Run `ollama pull gpt-oss:120b-cloud` to download

**Q: "Port 11434 already in use"**
A: Ollama is already running, or use a different port with `OLLAMA_BASE_URL`

**Q: Forms not filling**
A: Some websites have complex JavaScript. Check logs: `tail -f data/combined.log`

## Next Steps

1. Add job URLs to process
2. Configure search terms and job boards
3. Set candidate information accurately
4. Run test suite to verify setup
5. Process first job with detailed logging
6. Review application in browser
7. Enable auto-submit once confident

## Support

- Logs: `data/combined.log`
- Database: `data/applications.db` (SQLite)
- Screenshots: `data/screenshots/`

Need help? Check the main README.md for detailed documentation.
