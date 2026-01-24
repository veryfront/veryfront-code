# RLM Codebase Optimizer

Uses [Recursive Language Models](https://arxiv.org/abs/2512.24601) to analyze and optimize the entire codebase with cross-file awareness.

## Why RLM vs Batch API?

| Feature | Batch API | RLM |
|---------|-----------|-----|
| Cross-file awareness | ❌ | ✅ |
| Pattern detection | ❌ | ✅ |
| Consistent refactoring | ❌ | ✅ |
| Token efficiency | ~2.6M tokens | ~50K tokens |
| Cost | ~$30 | ~$5-10 |
| Speed | Fast (parallel) | Slower (recursive) |

**Use RLM when you need:**
- Codebase-wide consistency
- Duplicate detection across files
- Architectural analysis
- Cross-file refactoring

**Use Batch API when you need:**
- Fast, parallel processing
- File-isolated changes
- Simple simplifications

## Prerequisites

1. Install [uv](https://github.com/astral-sh/uv):
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

2. Set OpenAI API key in `.env`:
   ```
   OPENAI_API_KEY=sk-...
   ```

## Installation

```bash
cd scripts/rlm-optimize
uv venv --python 3.12
uv pip install -e .
```

## Workflow

```bash
# 1. Estimate cost
uv run python rlm-optimize.py estimate

# 2. Analyze codebase (finds patterns, duplicates, issues)
uv run python rlm-optimize.py analyze

# 3. Review analysis
cat output/analysis.json | jq '.findings[] | select(.priority == "high")'

# 4. Generate consistent simplifications
uv run python rlm-optimize.py simplify

# 5. Review proposed changes
cat output/simplifications.json | jq '.summary'

# 6. Apply changes
uv run python rlm-optimize.py apply

# 7. Verify
git diff
deno task verify
```

## Commands

| Command | Description |
|---------|-------------|
| `estimate` | Estimate cost before running |
| `analyze` | Find patterns, duplicates, inconsistencies across codebase |
| `simplify` | Generate simplified code with cross-file consistency |
| `apply` | Write simplified code to source files |

## How RLM Works

Instead of sending the entire codebase in the prompt (2.6M tokens), RLM:

1. Stores codebase as a variable in a REPL environment
2. Model explores the codebase programmatically
3. Model recursively calls itself on subsets of code
4. Results in ~10-20x token efficiency

```
Traditional:
  prompt = system + entire_codebase + query  # 2.6M tokens

RLM:
  prompt = system + query  # ~2K tokens
  context = {"codebase": {...}}  # stored as variable
  model.exec("for f in codebase: analyze(f)")  # programmatic access
```

## Output Files

```
scripts/rlm-optimize/output/
├── analysis.json       # Findings: duplicates, patterns, issues
└── simplifications.json # Proposed code changes
```

## Example Analysis Output

```json
{
  "findings": [
    {
      "type": "duplicate_code",
      "files": ["src/utils/string.ts", "src/helpers/format.ts"],
      "description": "Both files have similar slugify implementations",
      "suggestion": "Consolidate into src/utils/string.ts",
      "priority": "high"
    },
    {
      "type": "inconsistent_pattern",
      "files": ["src/api/users.ts", "src/api/posts.ts", "src/api/comments.ts"],
      "description": "Different error handling approaches",
      "suggestion": "Standardize on Result<T, E> pattern",
      "priority": "medium"
    }
  ]
}
```

## Hybrid Workflow

For best results, combine both approaches:

```bash
# 1. RLM: Analyze and plan
uv run python scripts/rlm-optimize/rlm-optimize.py analyze

# 2. Review high-priority findings manually

# 3. Batch API: Apply file-level simplifications
deno task batch:prepare
deno task batch:submit
# ... wait ...
deno task batch:apply

# 4. RLM: Verify consistency
uv run python scripts/rlm-optimize/rlm-optimize.py analyze
```

## Troubleshooting

**RLM not installed**:
```bash
uv pip install rlm
```

**Model timeout**: RLM can take 5-10 minutes for large codebases. The model is exploring recursively.

**JSON parse error**: The model sometimes returns markdown. Check `output/analysis.json` for raw output.

**Want to exclude files**: Edit `CONFIG["exclude_patterns"]` in `rlm-optimize.py`.

## References

- [RLM Paper](https://arxiv.org/abs/2512.24601)
- [RLM GitHub](https://github.com/alexzhang13/rlm)
- [DSPy Integration](https://github.com/halfprice06/rlm_dspy)
