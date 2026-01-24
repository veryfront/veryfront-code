# Hybrid Code Optimizer & Generator

Combines **RLM** (cross-file awareness) + **Batch API** (guaranteed coverage) for:
- **Optimization**: Simplify, refactor with consistent patterns
- **Generation**: Tests, docs, features from PRD

## How It Works

```
┌──────────────────────────────────────────────────────────────────┐
│  Phase 1: RLM Analysis                                           │
│  • Loads entire codebase as variable                             │
│  • Explores programmatically to extract patterns                 │
│  • Generates rules/context for batch processing                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Phase 2: Batch API Processing                                   │
│  • Every file processed with RLM-extracted context               │
│  • Guaranteed coverage - no file missed                          │
│  • 50% cost discount, parallel processing                        │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Phase 3: RLM Verification (optional)                            │
│  • Checks consistency across codebase                            │
│  • Identifies remaining issues                                   │
└──────────────────────────────────────────────────────────────────┘
```

## Setup

```bash
cd scripts/code-optimize
uv venv --python 3.12
uv pip install -e .
```

Add to `.env`:
```
OPENAI_API_KEY=sk-...
```

## Commands

### Optimization

| Command | Description |
|---------|-------------|
| `estimate` | Show cost estimate |
| `analyze` | Phase 1: RLM extracts codebase patterns → `rules.json` |
| `prepare` | Phase 2a: Create batch with RLM rules |
| `submit` | Phase 2b: Submit batch to OpenAI |
| `status` | Phase 2c: Check batch progress |
| `download` | Phase 2d: Download results |
| `apply` | Phase 2e: Apply changes to files |
| `verify` | Phase 3: RLM consistency verification |

### Generation

| Command | Description |
|---------|-------------|
| `generate tests` | Generate tests for files without them |
| `generate docs` | Generate JSDoc/TSDoc for exports |
| `generate feature <prd.md>` | Implement feature from PRD |
| `apply-feature` | Apply generated feature files |

## Workflows

### Optimize Codebase

```bash
uv run python code-optimize.py estimate
uv run python code-optimize.py analyze      # RLM extracts patterns
uv run python code-optimize.py prepare      # Create batch with rules
uv run python code-optimize.py submit
uv run python code-optimize.py status       # Wait for completion
uv run python code-optimize.py download
uv run python code-optimize.py apply
uv run python code-optimize.py verify       # Optional consistency check

git diff && deno task verify
```

### Generate Tests

```bash
uv run python code-optimize.py generate tests   # RLM finds untested files
uv run python code-optimize.py submit
uv run python code-optimize.py status
uv run python code-optimize.py download
uv run python code-optimize.py apply            # Creates .test.ts files

deno task test
```

### Generate Documentation

```bash
uv run python code-optimize.py generate docs    # RLM finds undocumented exports
uv run python code-optimize.py submit
uv run python code-optimize.py status
uv run python code-optimize.py download
uv run python code-optimize.py apply            # Adds JSDoc to files

git diff
```

### Generate Feature from PRD

```bash
# Create PRD file first
cat > feature.md << 'EOF'
# Feature: User Notifications

## Requirements
- Real-time notifications via WebSocket
- Toast component for display
- Notification preferences in settings
- Mark as read/unread functionality

## API
- GET /api/notifications
- POST /api/notifications/:id/read
- WebSocket /ws/notifications
EOF

uv run python code-optimize.py generate feature feature.md
# Review feature-context.json to see planned files
uv run python code-optimize.py submit
uv run python code-optimize.py status
uv run python code-optimize.py download
uv run python code-optimize.py apply-feature

git diff && deno task verify
```

## Output Files

```
scripts/code-optimize/output/
├── rules.json              # Optimization: extracted patterns
├── test-patterns.json      # Tests: testing conventions
├── doc-patterns.json       # Docs: documentation style
├── feature-context.json    # Feature: architecture analysis
├── batch-requests.jsonl    # Batch input
├── batch-results.jsonl     # Batch output
├── state.json              # Pipeline state
├── changes-summary.json    # Applied changes
└── verification.json       # Consistency report
```

## Cost Estimates

For ~2000 files:

| Task | RLM | Batch | Total |
|------|-----|-------|-------|
| Optimization | $4 | $30 | ~$34 |
| Tests (50% untested) | $2 | $15 | ~$17 |
| Docs (30% undocumented) | $2 | $9 | ~$11 |
| Feature | $2 | ~$5 | ~$7 |

## How Generation Works

### Tests

1. **RLM Phase**: Analyzes existing `*.test.ts` files to extract:
   - Test framework (Deno test, Vitest, etc.)
   - Structure (describe/it patterns)
   - Mocking conventions
   - Assertion styles
   - Which files lack tests

2. **Batch Phase**: For each untested file:
   - Includes test patterns as context
   - Generates comprehensive tests
   - Follows exact codebase conventions

### Docs

1. **RLM Phase**: Analyzes existing JSDoc/TSDoc to extract:
   - Documentation style
   - Required tags (@param, @returns, etc.)
   - Which exports lack documentation

2. **Batch Phase**: For each undocumented file:
   - Adds docs matching codebase style
   - Documents all exports
   - Preserves existing code

### Features

1. **RLM Phase**: Analyzes codebase + PRD to determine:
   - Architecture and patterns
   - Similar existing features to reference
   - Files to create and modify
   - Integration points

2. **Batch Phase**: For each planned file:
   - Creates new files following patterns
   - Modifies existing files as needed
   - Uses reference code as templates

## Tips

- **Review before apply**: Always check `git diff` after applying
- **Verify after**: Run `deno task verify` to catch issues
- **Incremental**: You can revert individual files with `git checkout`
- **Re-run safe**: Pipeline is idempotent, safe to re-run
- **Custom scope**: Edit `CONFIG` in script to change directories/extensions
