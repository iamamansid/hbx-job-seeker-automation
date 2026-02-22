# Security & PII/SPI Quick Audit

Date: 2026-02-22

## Findings

### 1) Hardcoded personal data in runtime defaults (**High**)
`src/config/index.ts` contains real-looking default candidate values (name, personal email, phone, LinkedIn URL, location, and portfolio URL). These values are loaded whenever environment variables are not set, which can leak personal data via logs, screenshots, demos, and automated runs.

## Evidence

- `name` default: `Aman Siddiqui`
- `email` default: `aman.siddiqui114@gmail.com`
- `phone` default: `+919415584405`
- `linkedInUrl` default profile URL
- `currentLocation` default: `New Delhi, India`

## Additional observations

- Documentation examples use placeholder values (`your@email.com`) in README/architecture/quick-reference docs, which is good.
- No committed `.env`, private key, or common cloud access-key patterns were detected in this quick scan.

## Recommended remediation

1. Replace all personal defaults in `src/config/index.ts` with neutral placeholders or empty strings.
2. Fail fast when required candidate fields are missing (e.g., throw at startup if name/email/phone are unset).
3. Keep real profile data only in local `.env` (gitignored) or secret manager.
4. Consider adding a pre-commit secret scanner (e.g., gitleaks) in CI.
