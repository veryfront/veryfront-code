# Contract Review Agent

An AI-powered contract review assistant that analyzes contracts clause-by-clause, flags deviations by severity, and generates redline suggestions.

## What's included

- Contract review agent powered by the [contract-review skill](https://github.com/anthropics/knowledge-work-plugins/blob/main/legal/skills/contract-review/SKILL.md) from Anthropic's knowledge-work-plugins
- Document upload supporting PDF, DOCX, TXT, MD, RTF, and HTML contracts
- Embedding-based retrieval for clause-level analysis
- Deviation classification: GREEN (acceptable), YELLOW (negotiate), RED (escalate)
- Prioritized redline generation with fallback positions
- Sample negotiation playbook in `content/`

## Getting started

1. Set your API keys:

   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   export OPENAI_API_KEY=sk-...        # for embeddings
   ```

2. Start the dev server:

   ```bash
   npx veryfront dev
   ```

3. Upload a contract (PDF, DOCX, etc.) and ask for a review.

## Quick actions

| Action | What it does |
|--------|-------------|
| **Full Review** | Clause-by-clause analysis with GREEN/YELLOW/RED classification |
| **Liability Analysis** | Deep dive into liability caps, indemnification, and carveouts |
| **IP & Data Review** | Intellectual property and data protection assessment |
| **Term & Termination** | Exit options, renewal terms, and notice periods |
| **Generate Redlines** | Prioritized redline suggestions for all flagged issues |

## Customizing the playbook

Edit `content/sample-playbook.md` with your organization's standard positions, acceptable ranges, and escalation triggers. The agent uses this as its baseline for reviews.

## Structure

```
store.ts                                  Upload store config (embedding model, storage)
agents/reviewer.ts                        Contract review agent with skill binding
skills/contract-review/SKILL.md           Contract review skill instructions
content/
  sample-playbook.md                      Sample negotiation playbook
app/
  api/chat/route.ts                       Chat API with contract retrieval
  api/uploads/route.ts                    Upload (POST) and list (GET)
  api/uploads/[id]/route.ts              Delete upload
  page.tsx                                Chat UI with contract upload
  layout.tsx                              Root layout
```

## How it works

1. **Upload** a contract via the attachment panel
2. The contract is chunked, embedded, and stored in the local vector index
3. When you ask a question, relevant contract sections are retrieved and prepended to the prompt
4. The agent uses the **contract-review skill** to analyze clauses against playbook positions
5. Issues are classified by severity and redline suggestions are generated

## Important disclaimer

This tool assists with legal workflows but does **not** provide legal advice. All analysis should be reviewed by qualified legal professionals before being relied upon.
