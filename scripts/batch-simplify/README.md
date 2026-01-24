# Batch Code Simplifier

Uses OpenAI's Batch API to review and simplify all TypeScript files in `src/` at 50% cost.

## Prerequisites

Add your OpenAI API key to `.env`:

```
OPENAI_API_KEY=sk-...
```

## Workflow

```bash
# 1. Estimate cost before committing
deno task batch:estimate

# 2. Create the batch request file
deno task batch:prepare

# 3. Submit to OpenAI (starts processing)
deno task batch:submit

# 4. Check progress (repeat until complete - typically 1-24 hours)
deno task batch:status

# 5. Download results when complete
deno task batch:download

# 6. Review and apply changes
deno task batch:apply
```

## Commands

| Command | Description |
|---------|-------------|
| `batch:estimate` | Show file count, token estimate, and cost |
| `batch:prepare` | Generate `output/batch-requests.jsonl` from src/ |
| `batch:submit` | Upload JSONL and create batch job |
| `batch:status` | Check batch progress (completed/failed counts) |
| `batch:download` | Download results to `output/batch-results.jsonl` |
| `batch:apply` | Apply simplified code to source files |

## What It Does

The simplifier applies these transformations while preserving functionality:

- Remove dead code and unused imports
- Flatten unnecessary nesting (early returns)
- Consolidate duplicate logic
- Simplify conditionals (no nested ternaries)
- Remove obvious comments
- Use modern TS patterns (optional chaining, nullish coalescing)
- Prefer explicit over clever code

## Output Files

```
scripts/batch-simplify/output/
├── batch-requests.jsonl   # Generated requests (one per file)
├── batch-results.jsonl    # OpenAI responses
└── batch-state.json       # Batch ID and status tracking
```

## Cost

Uses **GPT-5.2** (OpenAI's SOTA coding model) via Batch API:
- Input: $1.75 / 1M tokens
- Output: $14.00 / 1M tokens

Current estimate for this repo: ~$30 for ~2000 files.

To use a different model, edit `CONFIG.model` in `batch-simplify.ts`.

## Safety

- **Git first**: Commit or stash changes before running `batch:apply`
- **Review diffs**: Use `git diff` after applying to review changes
- **Run tests**: Run `deno task test` to verify functionality preserved
- **Incremental**: You can revert individual files with `git checkout`

## Recommended Flow

```bash
# Ensure clean working directory
git status

# Run the batch
deno task batch:estimate
deno task batch:prepare
deno task batch:submit

# Wait for completion (check periodically)
deno task batch:status

# When complete
deno task batch:download
deno task batch:apply

# Review and verify
git diff
deno task verify

# Commit if satisfied
git add -A
git commit -m "refactor: simplify code via batch review"
```

## Troubleshooting

**Batch stuck in "validating"**: Large batches take time. Wait 5-10 minutes.

**Batch failed**: Check `batch:status` output for error details. Common issues:
- Invalid API key
- Rate limits exceeded
- Malformed JSONL

**Apply shows many errors**: Files may have changed since batch was created. Re-run `batch:prepare` and `batch:submit`.

**Want to re-run on subset**: Edit `CONFIG.excludePatterns` in `batch-simplify.ts` to filter files.
