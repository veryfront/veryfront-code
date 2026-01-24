# Hybrid Code Optimizer

Combines **RLM** (cross-file awareness) + **Batch API** (guaranteed coverage) for optimal codebase optimization.

## Why Hybrid?

| Approach | Pros | Cons |
|----------|------|------|
| Batch API only | ✅ Every file processed, 50% cheaper | ❌ No cross-file awareness |
| RLM only | ✅ Cross-file patterns, consistency | ❌ May miss files, slower |
| **Hybrid** | ✅ Both benefits | ✅ Best of both worlds |

## Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: RLM Analysis (~$2)                                │
│  • Scans entire codebase                                    │
│  • Extracts patterns, conventions, anti-patterns            │
│  • Generates rules.json for batch processing                │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 2: Batch API (~$30)                                  │
│  • Processes EVERY file with RLM-generated rules            │
│  • Guaranteed coverage - no file missed                     │
│  • 50% cost discount, parallel processing                   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 3: RLM Verification (~$2)                            │
│  • Spot-checks consistency across codebase                  │
│  • Identifies any remaining issues                          │
│  • Provides consistency score                               │
└─────────────────────────────────────────────────────────────┘
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

## Full Workflow

```bash
# Estimate cost
uv run python code-optimize.py estimate

# Phase 1: RLM extracts codebase patterns
uv run python code-optimize.py analyze
cat output/rules.json | jq '.rules | keys'  # Review rules

# Phase 2: Batch processes every file with rules
uv run python code-optimize.py prepare
uv run python code-optimize.py submit
uv run python code-optimize.py status      # Repeat until complete
uv run python code-optimize.py download
uv run python code-optimize.py apply

# Phase 3: RLM verifies consistency
uv run python code-optimize.py verify

# Review and validate
git diff
deno task verify
```

## Commands

| Command | Phase | Description |
|---------|-------|-------------|
| `estimate` | - | Show cost estimate |
| `analyze` | 1 | RLM extracts patterns → `rules.json` |
| `prepare` | 2a | Create batch with RLM rules |
| `submit` | 2b | Upload batch to OpenAI |
| `status` | 2c | Check batch progress |
| `download` | 2d | Get batch results |
| `apply` | 2e | Write changes to files |
| `verify` | 3 | RLM consistency check |

## Output Files

```
scripts/code-optimize/output/
├── rules.json           # Phase 1: Extracted codebase rules
├── batch-requests.jsonl # Phase 2: Batch input
├── batch-results.jsonl  # Phase 2: Batch output
├── state.json           # Pipeline state tracking
├── changes-summary.json # Applied changes summary
└── verification.json    # Phase 3: Consistency report
```

## Example Rules Output (Phase 1)

```json
{
  "rules": {
    "naming": {
      "description": "camelCase for functions, PascalCase for components",
      "examples": ["good: getUserData", "bad: get_user_data"],
      "apply": "Rename any snake_case to camelCase"
    },
    "imports": {
      "description": "Sort: react, external, internal, relative",
      "apply": "Reorder imports to match convention"
    }
  },
  "shared_utilities": {
    "src/utils/string.ts": ["slugify", "Use instead of inline implementations"]
  },
  "anti_patterns": [
    {
      "pattern": "Nested ternaries for conditionals",
      "fix": "Replace with if/else or switch",
      "affected_files": ["src/components/Nav.tsx"]
    }
  ]
}
```

## How It Works

1. **Phase 1**: RLM loads entire codebase as a variable, explores it programmatically, extracts patterns that should be followed

2. **Phase 2**: Each batch request includes:
   - System prompt with RLM-generated rules
   - Single file to simplify
   - Guaranteed every file is processed

3. **Phase 3**: RLM loads updated codebase, compares against rules, reports any inconsistencies

## Cost Breakdown

For ~2000 files:
- Phase 1 (RLM): ~$2 (50K tokens, efficient exploration)
- Phase 2 (Batch): ~$30 (2.6M tokens, 50% discount)
- Phase 3 (RLM): ~$2 (50K tokens)
- **Total: ~$34**

## Troubleshooting

**RLM not installed**: `uv pip install rlm`

**Phase 1 takes long**: RLM explores recursively, can take 5-10 minutes

**Batch stuck**: Check `status` - large batches take 1-24 hours

**Inconsistent results**: Review `rules.json`, may need manual tuning
