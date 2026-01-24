#!/usr/bin/env python3
"""
RLM Codebase Optimizer

Uses Recursive Language Models to analyze and optimize the entire codebase
with cross-file awareness. Unlike batch processing, RLM can:
- Identify patterns across files
- Ensure consistent refactoring
- Suggest architectural improvements

Usage:
    uv run python scripts/rlm-optimize/rlm-optimize.py analyze
    uv run python scripts/rlm-optimize/rlm-optimize.py simplify
    uv run python scripts/rlm-optimize/rlm-optimize.py apply
"""

import json
import os
import sys
from pathlib import Path
from typing import Any

# Configuration
CONFIG = {
    "model": "gpt-5.2",
    "src_dir": "src",
    "output_dir": "scripts/rlm-optimize/output",
    "extensions": [".ts", ".tsx"],
    "max_file_size": 100_000,
    "exclude_patterns": [],  # Include all files
}

SYSTEM_PROMPT = """You are an expert code optimization assistant with access to an entire TypeScript/React codebase.
You can examine, search, and analyze the codebase programmatically using the provided REPL environment.

The codebase is available as `codebase`, a dict mapping file paths to file contents.

Your capabilities:
- Search for patterns across all files
- Identify code duplication and inconsistencies
- Analyze import/export relationships
- Suggest and implement cross-file refactoring

Code style rules:
- Use ES modules with proper import sorting
- Prefer function keyword over arrow functions for top-level
- Use explicit return type annotations
- No nested ternaries - use if/else or switch
- Prefer clarity over brevity
- Remove dead code, unused imports, redundant abstractions
"""

ANALYZE_PROMPT = """Analyze the codebase for optimization opportunities.

Use the REPL to explore `codebase` and identify:

1. **Duplicate Code**: Similar logic repeated across files
2. **Inconsistent Patterns**: Different approaches to the same problem
3. **Dead Code**: Unused exports, unreachable code paths
4. **Naming Inconsistencies**: Variables/functions with inconsistent naming
5. **Over-Engineering**: Unnecessary abstractions or complexity
6. **Missing Consolidation**: Related code that should be in shared utilities

For each finding, provide:
- File paths involved
- Description of the issue
- Suggested fix
- Priority (high/medium/low)

Output as JSON:
{
    "findings": [
        {
            "type": "duplicate_code" | "inconsistent_pattern" | "dead_code" | "naming" | "over_engineering" | "consolidation",
            "files": ["path1", "path2"],
            "description": "...",
            "suggestion": "...",
            "priority": "high" | "medium" | "low"
        }
    ],
    "summary": {
        "total_files": N,
        "files_with_issues": N,
        "high_priority": N,
        "medium_priority": N,
        "low_priority": N
    }
}
"""

SIMPLIFY_PROMPT = """Simplify the codebase while maintaining consistency across all files.

You have access to:
- `codebase`: dict of {filepath: content}
- `analysis`: previous analysis findings (if available)

Tasks:
1. Review each file for simplification opportunities
2. Ensure changes are consistent across the codebase
3. Preserve all functionality exactly
4. Apply project coding standards

For each file that needs changes, output the simplified version.
Skip files that are already clean.

Output as JSON:
{
    "changes": {
        "path/to/file.ts": {
            "original_lines": N,
            "simplified_lines": N,
            "changes_summary": "brief description",
            "content": "full simplified file content"
        }
    },
    "unchanged": ["path/to/clean/file.ts", ...],
    "summary": {
        "files_changed": N,
        "files_unchanged": N,
        "lines_removed": N
    }
}
"""


def load_codebase() -> dict[str, str]:
    """Load all TypeScript files from src/."""
    codebase = {}
    src_path = Path(CONFIG["src_dir"])

    for ext in CONFIG["extensions"]:
        for file_path in src_path.rglob(f"*{ext}"):
            rel_path = str(file_path)

            # Skip excluded patterns
            if any(pattern in rel_path for pattern in CONFIG["exclude_patterns"]):
                continue

            try:
                content = file_path.read_text()
                if len(content) <= CONFIG["max_file_size"]:
                    codebase[rel_path] = content
            except Exception as e:
                print(f"Warning: Could not read {rel_path}: {e}")

    return codebase


def ensure_output_dir():
    """Create output directory if it doesn't exist."""
    Path(CONFIG["output_dir"]).mkdir(parents=True, exist_ok=True)


def run_rlm(query: str, context: dict[str, Any]) -> str:
    """Execute RLM completion with the given query and context."""
    try:
        from rlm import RLM
    except ImportError:
        print("Error: RLM not installed. Run: uv pip install rlm")
        sys.exit(1)

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY not set")
        sys.exit(1)

    rlm = RLM(
        backend="openai",
        backend_kwargs={
            "model_name": CONFIG["model"],
            "api_key": api_key,
        },
        system_prompt=SYSTEM_PROMPT,
        environment="local",
        verbose=True,
    )

    # Inject context variables into the REPL environment
    result = rlm.completion(
        query=query,
        context=context,
    )

    return result.response


def analyze():
    """Analyze codebase for optimization opportunities."""
    print("📊 Loading codebase...")
    codebase = load_codebase()
    print(f"   Loaded {len(codebase)} files")

    print("\n🔍 Analyzing with RLM...")
    result = run_rlm(
        query=ANALYZE_PROMPT,
        context={"codebase": codebase}
    )

    ensure_output_dir()
    output_path = Path(CONFIG["output_dir"]) / "analysis.json"

    try:
        # Try to parse as JSON
        analysis = json.loads(result)
        output_path.write_text(json.dumps(analysis, indent=2))

        # Print summary
        summary = analysis.get("summary", {})
        print(f"\n✅ Analysis complete: {output_path}")
        print(f"   Files analyzed: {summary.get('total_files', '?')}")
        print(f"   Files with issues: {summary.get('files_with_issues', '?')}")
        print(f"   High priority: {summary.get('high_priority', '?')}")
        print(f"   Medium priority: {summary.get('medium_priority', '?')}")
        print(f"   Low priority: {summary.get('low_priority', '?')}")
    except json.JSONDecodeError:
        # Save raw output if not valid JSON
        output_path.write_text(result)
        print(f"\n⚠️  Analysis complete (raw output): {output_path}")

    print(f"\nNext: Run 'uv run python {sys.argv[0]} simplify' to generate fixes")


def simplify():
    """Generate simplified versions of files."""
    print("📊 Loading codebase...")
    codebase = load_codebase()
    print(f"   Loaded {len(codebase)} files")

    # Load previous analysis if available
    analysis_path = Path(CONFIG["output_dir"]) / "analysis.json"
    analysis = None
    if analysis_path.exists():
        try:
            analysis = json.loads(analysis_path.read_text())
            print(f"   Loaded previous analysis")
        except:
            pass

    print("\n🔧 Simplifying with RLM...")
    context = {"codebase": codebase}
    if analysis:
        context["analysis"] = analysis

    result = run_rlm(
        query=SIMPLIFY_PROMPT,
        context=context
    )

    ensure_output_dir()
    output_path = Path(CONFIG["output_dir"]) / "simplifications.json"

    try:
        simplifications = json.loads(result)
        output_path.write_text(json.dumps(simplifications, indent=2))

        summary = simplifications.get("summary", {})
        print(f"\n✅ Simplification complete: {output_path}")
        print(f"   Files changed: {summary.get('files_changed', '?')}")
        print(f"   Files unchanged: {summary.get('files_unchanged', '?')}")
        print(f"   Lines removed: {summary.get('lines_removed', '?')}")
    except json.JSONDecodeError:
        output_path.write_text(result)
        print(f"\n⚠️  Simplification complete (raw output): {output_path}")

    print(f"\nNext: Run 'uv run python {sys.argv[0]} apply' to apply changes")


def apply():
    """Apply simplified code to source files."""
    simplifications_path = Path(CONFIG["output_dir"]) / "simplifications.json"

    if not simplifications_path.exists():
        print("Error: No simplifications found. Run 'simplify' first.")
        sys.exit(1)

    try:
        data = json.loads(simplifications_path.read_text())
    except json.JSONDecodeError:
        print("Error: Could not parse simplifications.json")
        sys.exit(1)

    changes = data.get("changes", {})
    if not changes:
        print("No changes to apply.")
        return

    print(f"🔧 Applying {len(changes)} changes...\n")

    applied = 0
    errors = 0

    for file_path, change in changes.items():
        content = change.get("content")
        if not content:
            print(f"⚠️  {file_path}: No content")
            errors += 1
            continue

        try:
            Path(file_path).write_text(content)
            summary = change.get("changes_summary", "simplified")
            print(f"✅ {file_path}: {summary}")
            applied += 1
        except Exception as e:
            print(f"❌ {file_path}: {e}")
            errors += 1

    print(f"\n📊 Summary:")
    print(f"   Applied: {applied}")
    print(f"   Errors: {errors}")
    print(f"\nRun 'git diff' to review changes")
    print("Run 'deno task verify' to validate")


def estimate():
    """Estimate cost for RLM analysis."""
    print("💰 Estimating RLM cost...\n")

    codebase = load_codebase()
    total_chars = sum(len(content) for content in codebase.values())

    # RLM is more token-efficient due to context-as-variable
    # Estimate ~2-3k tokens per query vs full context
    estimated_queries = max(1, len(codebase) // 50)  # ~50 files per recursive call
    tokens_per_query = 3000
    total_tokens = estimated_queries * tokens_per_query

    # GPT-5.2 pricing
    input_cost = (total_tokens / 1_000_000) * 3.50  # Standard, not batch
    output_cost = (total_tokens / 1_000_000) * 28.00

    print(f"Files: {len(codebase)}")
    print(f"Total size: {total_chars:,} chars")
    print(f"Estimated recursive queries: {estimated_queries}")
    print(f"Estimated tokens: {total_tokens:,}")
    print(f"\nEstimated cost (GPT-5.2):")
    print(f"   ~${input_cost + output_cost:.2f}")
    print(f"\nNote: RLM is ~10-20x more token-efficient than sending full context")


def main():
    if len(sys.argv) < 2:
        print("""
RLM Codebase Optimizer

Commands:
    estimate   Estimate cost
    analyze    Analyze codebase for optimization opportunities
    simplify   Generate simplified versions with cross-file consistency
    apply      Apply changes to source files

Workflow:
    1. uv run python scripts/rlm-optimize/rlm-optimize.py estimate
    2. uv run python scripts/rlm-optimize/rlm-optimize.py analyze
    3. uv run python scripts/rlm-optimize/rlm-optimize.py simplify
    4. uv run python scripts/rlm-optimize/rlm-optimize.py apply
    5. git diff && deno task verify

Environment:
    OPENAI_API_KEY - Required
""")
        return

    command = sys.argv[1]

    match command:
        case "estimate":
            estimate()
        case "analyze":
            analyze()
        case "simplify":
            simplify()
        case "apply":
            apply()
        case _:
            print(f"Unknown command: {command}")
            sys.exit(1)


if __name__ == "__main__":
    main()
