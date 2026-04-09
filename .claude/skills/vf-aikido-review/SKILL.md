---
name: vf-aikido-review
description: Pull Aikido Security issues via API, triage real vs false positives, and take action (close false positives, fix real issues, review open PRs)
---

# Aikido Security Issue Review

Pull issues from Aikido Security, review them for false positives, and take action.

## Prerequisites

Credentials are stored in `.env` at the repo root (gitignored). Copy from the example:

```bash
cp .env.example .env
# Then edit .env and fill in your Aikido credentials
```

Get credentials from: `app.aikido.dev` → Integrations → Public REST API → Add Client

## Step 1: Load Credentials and Authenticate

```bash
# Source .env from repo root
set -a
source "$(git rev-parse --show-toplevel)/.env"
set +a

if [ -z "$AIKIDO_CLIENT_ID" ] || [ -z "$AIKIDO_CLIENT_SECRET" ]; then
  echo "ERROR: AIKIDO_CLIENT_ID and AIKIDO_CLIENT_SECRET not found in .env"
  echo "Run: cp .env.example .env  — then fill in your credentials"
  exit 1
fi

AIKIDO_TOKEN=$(curl -sf -X POST https://app.aikido.dev/api/oauth/token \
  -H "Authorization: Basic $(echo -n "${AIKIDO_CLIENT_ID}:${AIKIDO_CLIENT_SECRET}" | base64)" \
  -H "Content-Type: application/json" \
  -d '{"grant_type": "client_credentials"}' | jq -r '.access_token')

if [ -z "$AIKIDO_TOKEN" ] || [ "$AIKIDO_TOKEN" = "null" ]; then
  echo "ERROR: Failed to authenticate. Check credentials in .env"
  exit 1
fi
echo "Authenticated successfully."
```

If authentication fails, tell the user to:
1. Verify `AIKIDO_CLIENT_ID` and `AIKIDO_CLIENT_SECRET` are set in their shell profile (`~/.zshrc`)
2. Get credentials from `app.aikido.dev` → Integrations → Public REST API → Add Client

## Step 2: Pull Issues

Determine the repo name from the current git remote:

```bash
REPO_NAME=$(basename -s .git "$(git remote get-url origin)" 2>/dev/null)
```

### Pull open issues for this repo

```bash
curl -sf -H "Authorization: Bearer $AIKIDO_TOKEN" \
  "https://app.aikido.dev/api/public/v1/issues/export?filter_status=open&filter_code_repo_name=${REPO_NAME}&format=json" \
  | jq '.'
```

### Pull open issue groups (paginated, sorted by priority)

```bash
curl -sf -H "Authorization: Bearer $AIKIDO_TOKEN" \
  "https://app.aikido.dev/api/public/v1/open-issue-groups?filter_code_repo_name=${REPO_NAME}&page=0&per_page=20" \
  | jq '.'
```

### Filter by severity if needed

Add `&filter_severities=critical,high` for critical/high only.

### Filter by issue type

Common types: `sast`, `open_source`, `leaked_secret`, `iac`, `docker_container`, `malware`, `eol`

```bash
# Example: SAST findings only
curl -sf -H "Authorization: Bearer $AIKIDO_TOKEN" \
  "https://app.aikido.dev/api/public/v1/issues/export?filter_status=open&filter_code_repo_name=${REPO_NAME}&filter_issue_type=sast&format=json" \
  | jq '.'
```

## Step 3: Triage Each Issue

For each issue returned, perform a structured review:

### 3a. Read the affected code

Read the file and line range referenced in the issue. Understand the full context — callers, data flow, type signatures.

### 3b. Classify the finding

Apply these criteria:

**Real vulnerability** if ALL of these are true:
- The input is attacker-controlled (comes from HTTP request, user input, external API)
- The sink is dangerous (SQL query, command execution, file path, HTML output, redirect)
- No sanitization/validation exists between source and sink
- The attack is reachable in production (not just tests, dev-only code, or CLI tools)

**False positive** if ANY of these are true:
- Input is hardcoded, type-constrained (number/boolean), or operator-controlled (config files, env vars)
- The code path has no remote attack surface (local CLI commands, build tools)
- Existing validation/escaping already mitigates the issue
- The "vulnerable" comparison involves non-secret, non-attacker-controlled values (e.g., internal cache hashes)
- The fix would be dead code that can never trigger

**Needs context** if:
- The data flow is unclear from static analysis alone
- The input source depends on deployment configuration

### 3c. Assess Aikido's fix (if an autofix PR exists)

Check for open PRs from `aikido-autofix[bot]`:

```bash
gh pr list --state open --author "app/aikido-autofix" --json number,title,url
```

For each autofix PR, review:
- Does the fix actually address the vulnerability?
- Does it introduce new bugs? (e.g., import shadowing, breaking type contracts)
- Does it add dead code? (validating constants, type-guaranteed values)
- Is the fix complete or partial?

## Step 4: Take Action

### For false positives
- Close the Aikido autofix PR with a comment explaining why it's a false positive
- Note the false positive classification for the team

### For real vulnerabilities with good autofix
- Review the PR diff carefully
- Fix any issues (bad error messages, overly restrictive validation, dead code mixed in)
- Commit fixes and push to the PR branch
- Leave a review comment with merge readiness score

### For real vulnerabilities with bad/no autofix
- Create a fix on a new branch
- Open a PR with the fix
- Reference the Aikido issue in the PR description

### For partial fixes (mix of real + false positive)
- Keep the real fix, remove the false positive parts
- Commit with a clear message explaining what was kept and why
- Push to the existing PR branch

## Step 5: Summary Report

After processing all issues, output a summary table:

```
| Issue | Type | Severity | File | Verdict | Action |
|-------|------|----------|------|---------|--------|
| ...   | ...  | ...      | ...  | Real/FP | Closed/Fixed/PR# |
```

Include:
- Total issues reviewed
- Real vulnerabilities found vs false positives
- Aikido false positive rate for this batch
- Any issues that need human review (marked "Needs context")

## Arguments

The skill accepts optional arguments to control scope:

- No args: Pull and review all open issues for this repo
- `critical` or `high`: Filter by severity
- `sast` or `open_source` or other type: Filter by issue type
- `prs`: Review open Aikido autofix PRs only (no API pull needed)
- `--dry-run`: Analyze and report only, don't close PRs or push fixes

## Rate Limits

Aikido API allows 20 calls/minute per workspace. The `/issues/export` endpoint returns all matching issues in one call, so typically only 1-2 API calls are needed.

## Examples

```
/vf-aikido-review                    # Review all open issues
/vf-aikido-review critical           # Critical issues only
/vf-aikido-review sast               # SAST findings only
/vf-aikido-review prs                # Review open autofix PRs
/vf-aikido-review --dry-run          # Report only, no actions
/vf-aikido-review critical --dry-run # Critical issues, report only
```
