#!/usr/bin/env python3
"""
Hybrid Code Optimizer

Combines RLM (cross-file awareness) + Batch API (guaranteed coverage):

Phase 1: RLM extracts codebase patterns → generates rules
Phase 2: Batch API processes every file with those rules
Phase 3: RLM verifies consistency

Usage:
    uv run python scripts/code-optimize/code-optimize.py analyze     # Phase 1: RLM
    uv run python scripts/code-optimize/code-optimize.py prepare     # Phase 2a: Create batch
    uv run python scripts/code-optimize/code-optimize.py submit      # Phase 2b: Submit batch
    uv run python scripts/code-optimize/code-optimize.py status      # Phase 2c: Check status
    uv run python scripts/code-optimize/code-optimize.py download    # Phase 2d: Get results
    uv run python scripts/code-optimize/code-optimize.py apply       # Phase 2e: Apply changes
    uv run python scripts/code-optimize/code-optimize.py verify      # Phase 3: RLM verify
"""

import json
import os
import sys
from pathlib import Path
from typing import Any
from datetime import datetime

# Configuration
CONFIG = {
    "model_rlm": "gpt-5.2",           # For RLM analysis
    "model_batch": "gpt-5.2",          # For batch processing
    "src_dir": "src",
    "output_dir": "scripts/code-optimize/output",
    "extensions": [".ts", ".tsx"],
    "max_file_size": 100_000,
    "batch_max_tokens": 16384,
}

# Phase 1: RLM extracts patterns and generates rules
RLM_ANALYZE_PROMPT = """You have access to `codebase`, a dict of {filepath: content} containing the entire TypeScript/React codebase.

Your task: Analyze the codebase and generate a RULES document that will guide per-file simplification.

Explore the codebase programmatically to identify:

1. **Naming Conventions**: How are variables, functions, components, types named?
2. **Code Patterns**: Common patterns used (error handling, data fetching, state management)
3. **Import Style**: How are imports organized and sorted?
4. **Component Structure**: How are React components structured?
5. **Type Patterns**: How are TypeScript types/interfaces used?
6. **Utility Functions**: What shared utilities exist that should be used?
7. **Anti-patterns**: What inconsistencies or anti-patterns exist that should be fixed?

Output a JSON document:
{
    "rules": {
        "naming": {
            "description": "...",
            "examples": ["good: ...", "bad: ..."],
            "apply": "..."
        },
        "imports": { ... },
        "components": { ... },
        "types": { ... },
        "error_handling": { ... },
        "utilities": { ... }
    },
    "shared_utilities": {
        "path/to/util.ts": ["functionName", "description of when to use"]
    },
    "consolidation_opportunities": [
        {
            "files": ["file1.ts", "file2.ts"],
            "pattern": "duplicate logic description",
            "target": "where to consolidate"
        }
    ],
    "anti_patterns": [
        {
            "pattern": "description",
            "fix": "how to fix",
            "affected_files": ["..."]
        }
    ]
}
"""

# Phase 3: RLM verifies consistency
RLM_VERIFY_PROMPT = """You have access to:
- `codebase`: the updated codebase after batch processing
- `rules`: the rules that were applied
- `changes`: summary of what was changed

Verify the batch processing was consistent:

1. Check if rules were applied uniformly
2. Identify any files that may have been missed or incorrectly processed
3. Find any remaining cross-file inconsistencies
4. Suggest any final manual fixes needed

Output:
{
    "consistency_score": 0-100,
    "issues": [
        {
            "type": "inconsistency" | "missed" | "incorrect",
            "files": ["..."],
            "description": "...",
            "fix": "..."
        }
    ],
    "summary": "..."
}
"""


def load_codebase() -> dict[str, str]:
    """Load all TypeScript files from src/."""
    codebase = {}
    src_path = Path(CONFIG["src_dir"])

    for ext in CONFIG["extensions"]:
        for file_path in src_path.rglob(f"*{ext}"):
            rel_path = str(file_path)
            try:
                content = file_path.read_text()
                if len(content) <= CONFIG["max_file_size"]:
                    codebase[rel_path] = content
            except Exception as e:
                print(f"Warning: Could not read {rel_path}: {e}")

    return codebase


def ensure_output_dir():
    Path(CONFIG["output_dir"]).mkdir(parents=True, exist_ok=True)


def get_api_key() -> str:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        # Try loading from .env
        env_path = Path(".env")
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("OPENAI_API_KEY="):
                    key = line.split("=", 1)[1].strip()
                    break
    if not key:
        print("Error: OPENAI_API_KEY not set")
        sys.exit(1)
    return key


def run_rlm(query: str, context: dict[str, Any]) -> str:
    """Execute RLM completion."""
    try:
        from rlm import RLM
    except ImportError:
        print("Error: RLM not installed. Run: uv pip install rlm")
        sys.exit(1)

    api_key = get_api_key()

    rlm = RLM(
        backend="openai",
        backend_kwargs={
            "model_name": CONFIG["model_rlm"],
            "api_key": api_key,
        },
        environment="local",
        verbose=True,
    )

    result = rlm.completion(query=query, context=context)
    return result.response


def load_rules() -> dict | None:
    """Load previously generated rules."""
    rules_path = Path(CONFIG["output_dir"]) / "rules.json"
    if rules_path.exists():
        try:
            return json.loads(rules_path.read_text())
        except:
            pass
    return None


def create_batch_prompt(rules: dict) -> str:
    """Create the system prompt for batch processing, including RLM-generated rules."""
    rules_text = json.dumps(rules, indent=2)

    return f"""You are a code simplification expert. Simplify the given TypeScript/React code while following these codebase-specific rules extracted from analysis:

{rules_text}

CRITICAL RULES:
1. PRESERVE all functionality exactly - never change behavior
2. Apply the codebase-specific patterns above for consistency
3. Remove dead code, unused imports, redundant abstractions
4. Flatten unnecessary nesting (early returns over nested if/else)
5. NO nested ternaries - use if/else or switch
6. Prefer clarity over brevity

OUTPUT: Return ONLY the simplified code. No explanations, no markdown fences.
If no changes needed, return the exact input unchanged."""


# ============== Phase 1: RLM Analysis ==============

def analyze():
    """Phase 1: Use RLM to analyze codebase and generate rules."""
    print("📊 Phase 1: RLM Codebase Analysis")
    print("=" * 50)

    print("\n📁 Loading codebase...")
    codebase = load_codebase()
    print(f"   Loaded {len(codebase)} files")

    print("\n🔍 Analyzing with RLM (this may take a few minutes)...")
    result = run_rlm(
        query=RLM_ANALYZE_PROMPT,
        context={"codebase": codebase}
    )

    ensure_output_dir()
    rules_path = Path(CONFIG["output_dir"]) / "rules.json"

    try:
        rules = json.loads(result)
        rules_path.write_text(json.dumps(rules, indent=2))
        print(f"\n✅ Rules generated: {rules_path}")

        # Summary
        if "rules" in rules:
            print(f"   Rule categories: {len(rules['rules'])}")
        if "consolidation_opportunities" in rules:
            print(f"   Consolidation opportunities: {len(rules['consolidation_opportunities'])}")
        if "anti_patterns" in rules:
            print(f"   Anti-patterns found: {len(rules['anti_patterns'])}")

    except json.JSONDecodeError:
        rules_path.write_text(result)
        print(f"\n⚠️  Raw output saved: {rules_path}")

    print(f"\nNext: Review rules.json, then run 'prepare' to create batch")


# ============== Phase 2: Batch Processing ==============

def prepare():
    """Phase 2a: Create batch file using RLM-generated rules."""
    print("📦 Phase 2a: Prepare Batch with RLM Rules")
    print("=" * 50)

    rules = load_rules()
    if not rules:
        print("Error: No rules found. Run 'analyze' first.")
        sys.exit(1)

    print("✅ Loaded rules from Phase 1")

    codebase = load_codebase()
    print(f"📁 Loaded {len(codebase)} files")

    system_prompt = create_batch_prompt(rules)
    print(f"📝 System prompt: {len(system_prompt)} chars")

    ensure_output_dir()
    batch_lines = []

    for file_path, content in codebase.items():
        if len(content) < 50:  # Skip tiny files
            continue

        custom_id = file_path.replace("/", "__").replace(".", "_")
        request = {
            "custom_id": custom_id,
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": CONFIG["model_batch"],
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"File: {file_path}\n\n{content}"}
                ],
                "max_tokens": CONFIG["batch_max_tokens"],
                "temperature": 0,
            }
        }
        batch_lines.append(json.dumps(request))

    batch_path = Path(CONFIG["output_dir"]) / "batch-requests.jsonl"
    batch_path.write_text("\n".join(batch_lines))

    state = {
        "phase": "prepared",
        "file_count": len(batch_lines),
        "created_at": datetime.now().isoformat(),
    }
    state_path = Path(CONFIG["output_dir"]) / "state.json"
    state_path.write_text(json.dumps(state, indent=2))

    print(f"\n✅ Batch file created: {batch_path}")
    print(f"   Files: {len(batch_lines)}")
    print(f"\nNext: Run 'submit' to upload batch to OpenAI")


def submit():
    """Phase 2b: Submit batch to OpenAI."""
    print("🚀 Phase 2b: Submit Batch")
    print("=" * 50)

    api_key = get_api_key()
    batch_path = Path(CONFIG["output_dir"]) / "batch-requests.jsonl"

    if not batch_path.exists():
        print("Error: No batch file. Run 'prepare' first.")
        sys.exit(1)

    import requests

    # Upload file
    print("📤 Uploading batch file...")
    with open(batch_path, "rb") as f:
        upload_resp = requests.post(
            "https://api.openai.com/v1/files",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": ("batch.jsonl", f, "application/jsonl")},
            data={"purpose": "batch"}
        )

    if not upload_resp.ok:
        print(f"Upload failed: {upload_resp.text}")
        sys.exit(1)

    file_id = upload_resp.json()["id"]
    print(f"✅ Uploaded: {file_id}")

    # Create batch
    print("📦 Creating batch...")
    batch_resp = requests.post(
        "https://api.openai.com/v1/batches",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        },
        json={
            "input_file_id": file_id,
            "endpoint": "/v1/chat/completions",
            "completion_window": "24h",
            "metadata": {"task": "code-optimize-hybrid"}
        }
    )

    if not batch_resp.ok:
        print(f"Batch creation failed: {batch_resp.text}")
        sys.exit(1)

    batch_id = batch_resp.json()["id"]
    print(f"✅ Batch created: {batch_id}")

    # Update state
    state_path = Path(CONFIG["output_dir"]) / "state.json"
    state = json.loads(state_path.read_text())
    state["batch_id"] = batch_id
    state["phase"] = "submitted"
    state_path.write_text(json.dumps(state, indent=2))

    print(f"\nNext: Run 'status' to check progress")


def status():
    """Phase 2c: Check batch status."""
    print("📊 Phase 2c: Batch Status")
    print("=" * 50)

    api_key = get_api_key()
    state_path = Path(CONFIG["output_dir"]) / "state.json"
    state = json.loads(state_path.read_text())

    if "batch_id" not in state:
        print("Error: No batch submitted. Run 'submit' first.")
        sys.exit(1)

    import requests
    resp = requests.get(
        f"https://api.openai.com/v1/batches/{state['batch_id']}",
        headers={"Authorization": f"Bearer {api_key}"}
    )

    batch = resp.json()
    counts = batch.get("request_counts", {})

    print(f"\nStatus: {batch['status']}")
    print(f"Total: {counts.get('total', '?')}")
    print(f"Completed: {counts.get('completed', 0)}")
    print(f"Failed: {counts.get('failed', 0)}")

    if batch["status"] == "completed":
        state["output_file_id"] = batch["output_file_id"]
        state["phase"] = "completed"
        state_path.write_text(json.dumps(state, indent=2))
        print(f"\n✅ Batch complete! Run 'download' to get results")
    elif batch["status"] == "failed":
        print(f"\n❌ Batch failed")
        if batch.get("errors"):
            print(json.dumps(batch["errors"], indent=2))
    else:
        progress = counts.get("completed", 0) / max(counts.get("total", 1), 1) * 100
        print(f"\n⏳ Progress: {progress:.1f}%")


def download():
    """Phase 2d: Download batch results."""
    print("📥 Phase 2d: Download Results")
    print("=" * 50)

    api_key = get_api_key()
    state_path = Path(CONFIG["output_dir"]) / "state.json"
    state = json.loads(state_path.read_text())

    if "output_file_id" not in state:
        print("Error: Batch not complete. Run 'status' first.")
        sys.exit(1)

    import requests
    resp = requests.get(
        f"https://api.openai.com/v1/files/{state['output_file_id']}/content",
        headers={"Authorization": f"Bearer {api_key}"}
    )

    results_path = Path(CONFIG["output_dir"]) / "batch-results.jsonl"
    results_path.write_text(resp.text)

    lines = resp.text.strip().split("\n")
    print(f"✅ Downloaded {len(lines)} results: {results_path}")
    print(f"\nNext: Run 'apply' to write changes")


def apply():
    """Phase 2e: Apply batch results to files."""
    print("🔧 Phase 2e: Apply Changes")
    print("=" * 50)

    results_path = Path(CONFIG["output_dir"]) / "batch-results.jsonl"
    if not results_path.exists():
        print("Error: No results. Run 'download' first.")
        sys.exit(1)

    results = [json.loads(line) for line in results_path.read_text().strip().split("\n")]

    applied = 0
    unchanged = 0
    errors = 0

    for result in results:
        # Convert custom_id back to path
        file_path = result["custom_id"].replace("__", "/").replace("_ts", ".ts").replace("_tsx", ".tsx")

        if result.get("error"):
            print(f"❌ {file_path}: {result['error']}")
            errors += 1
            continue

        response = result.get("response", {})
        if response.get("status_code") != 200:
            errors += 1
            continue

        content = response.get("body", {}).get("choices", [{}])[0].get("message", {}).get("content")
        if not content:
            errors += 1
            continue

        try:
            original = Path(file_path).read_text().strip()
            simplified = content.strip()

            if original == simplified:
                unchanged += 1
                continue

            Path(file_path).write_text(simplified + "\n")
            print(f"✅ {file_path}")
            applied += 1
        except Exception as e:
            print(f"❌ {file_path}: {e}")
            errors += 1

    # Save summary for Phase 3
    summary = {"applied": applied, "unchanged": unchanged, "errors": errors}
    summary_path = Path(CONFIG["output_dir"]) / "changes-summary.json"
    summary_path.write_text(json.dumps(summary, indent=2))

    print(f"\n📊 Summary:")
    print(f"   Applied: {applied}")
    print(f"   Unchanged: {unchanged}")
    print(f"   Errors: {errors}")
    print(f"\nNext: Run 'verify' for Phase 3 consistency check")


# ============== Phase 3: RLM Verification ==============

def verify():
    """Phase 3: Use RLM to verify consistency."""
    print("🔍 Phase 3: RLM Consistency Verification")
    print("=" * 50)

    rules = load_rules()
    if not rules:
        print("Warning: No rules found")
        rules = {}

    changes_path = Path(CONFIG["output_dir"]) / "changes-summary.json"
    changes = {}
    if changes_path.exists():
        changes = json.loads(changes_path.read_text())

    print("\n📁 Loading updated codebase...")
    codebase = load_codebase()
    print(f"   Loaded {len(codebase)} files")

    print("\n🔍 Verifying with RLM...")
    result = run_rlm(
        query=RLM_VERIFY_PROMPT,
        context={
            "codebase": codebase,
            "rules": rules,
            "changes": changes
        }
    )

    verify_path = Path(CONFIG["output_dir"]) / "verification.json"

    try:
        verification = json.loads(result)
        verify_path.write_text(json.dumps(verification, indent=2))

        score = verification.get("consistency_score", "?")
        issues = verification.get("issues", [])

        print(f"\n✅ Verification complete: {verify_path}")
        print(f"   Consistency score: {score}/100")
        print(f"   Issues found: {len(issues)}")

        if issues:
            print("\n   Top issues:")
            for issue in issues[:5]:
                print(f"   - {issue.get('type')}: {issue.get('description', '')[:60]}...")

    except json.JSONDecodeError:
        verify_path.write_text(result)
        print(f"\n⚠️  Raw output saved: {verify_path}")

    print(f"\n🎉 Pipeline complete!")
    print(f"   Run 'git diff' to review all changes")
    print(f"   Run 'deno task verify' to validate")


def estimate():
    """Estimate cost for full pipeline."""
    print("💰 Cost Estimate for Hybrid Pipeline")
    print("=" * 50)

    codebase = load_codebase()
    total_chars = sum(len(c) for c in codebase.values())
    total_tokens = total_chars // 4

    # Phase 1: RLM Analysis
    rlm_tokens = 50_000  # RLM is efficient
    rlm_cost = (rlm_tokens / 1_000_000) * (3.50 + 28.00)

    # Phase 2: Batch (with rules context ~2k tokens per file)
    rules_tokens = 2000
    batch_input = total_tokens + (len(codebase) * rules_tokens)
    batch_output = total_tokens * 0.8
    batch_cost = (batch_input / 1_000_000) * 1.75 + (batch_output / 1_000_000) * 14.00

    # Phase 3: RLM Verification
    verify_cost = rlm_cost

    total = rlm_cost + batch_cost + verify_cost

    print(f"\nFiles: {len(codebase)}")
    print(f"Total codebase: {total_chars:,} chars (~{total_tokens:,} tokens)")
    print(f"\nPhase 1 - RLM Analysis:    ~${rlm_cost:.2f}")
    print(f"Phase 2 - Batch Processing: ~${batch_cost:.2f}")
    print(f"Phase 3 - RLM Verification: ~${verify_cost:.2f}")
    print(f"{'─' * 35}")
    print(f"Total:                      ~${total:.2f}")


def main():
    if len(sys.argv) < 2:
        print("""
Hybrid Code Optimizer (RLM + Batch API)

Pipeline:
  Phase 1: RLM analyzes codebase → generates rules
  Phase 2: Batch API processes every file with rules
  Phase 3: RLM verifies consistency

Commands:
  estimate   Show cost estimate
  analyze    Phase 1: RLM codebase analysis
  prepare    Phase 2a: Create batch with RLM rules
  submit     Phase 2b: Submit batch to OpenAI
  status     Phase 2c: Check batch status
  download   Phase 2d: Download results
  apply      Phase 2e: Apply changes to files
  verify     Phase 3: RLM consistency check

Full workflow:
  uv run python scripts/code-optimize/code-optimize.py estimate
  uv run python scripts/code-optimize/code-optimize.py analyze
  uv run python scripts/code-optimize/code-optimize.py prepare
  uv run python scripts/code-optimize/code-optimize.py submit
  uv run python scripts/code-optimize/code-optimize.py status   # repeat until done
  uv run python scripts/code-optimize/code-optimize.py download
  uv run python scripts/code-optimize/code-optimize.py apply
  uv run python scripts/code-optimize/code-optimize.py verify
  git diff && deno task verify
""")
        return

    commands = {
        "estimate": estimate,
        "analyze": analyze,
        "prepare": prepare,
        "submit": submit,
        "status": status,
        "download": download,
        "apply": apply,
        "verify": verify,
    }

    cmd = sys.argv[1]
    if cmd in commands:
        commands[cmd]()
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
