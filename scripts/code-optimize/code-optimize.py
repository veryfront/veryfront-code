#!/usr/bin/env python3
"""
Hybrid Code Optimizer & Generator

Combines RLM (cross-file awareness) + Batch API (guaranteed coverage) for:
- Code optimization (simplify, refactor)
- Code generation (tests, docs, features)

Usage:
    # Optimization
    uv run python code-optimize.py analyze
    uv run python code-optimize.py prepare
    uv run python code-optimize.py submit
    uv run python code-optimize.py status
    uv run python code-optimize.py download
    uv run python code-optimize.py apply
    uv run python code-optimize.py verify

    # Generation
    uv run python code-optimize.py generate tests
    uv run python code-optimize.py generate docs
    uv run python code-optimize.py generate feature path/to/prd.md
"""

import json
import os
import sys
from pathlib import Path
from typing import Any
from datetime import datetime
from urllib.parse import quote, unquote

# Configuration
CONFIG = {
    "model_rlm": "gpt-5.2",
    "model_batch": "gpt-5.2",
    "src_dir": "src",
    "output_dir": "scripts/code-optimize/output",
    "extensions": [".ts", ".tsx"],
    "test_extensions": [".test.ts", ".test.tsx"],
    "max_file_size": 100_000,
    "batch_max_completion_tokens": 16384,
}

# ============== Prompts ==============

RLM_ANALYZE_PROMPT = """You have access to `codebase`, a dict of {filepath: content} containing the entire TypeScript/React codebase.

Analyze the codebase and generate a RULES document for consistent code optimization.

Explore programmatically to identify:
1. **Naming Conventions**: variables, functions, components, types
2. **Code Patterns**: error handling, data fetching, state management
3. **Import Style**: organization and sorting
4. **Component Structure**: React component patterns
5. **Type Patterns**: TypeScript types/interfaces usage
6. **Utility Functions**: shared utilities that should be reused
7. **Anti-patterns**: inconsistencies to fix

Output JSON:
{
    "rules": {
        "naming": {"description": "...", "examples": [...], "apply": "..."},
        "imports": {...},
        "components": {...},
        "types": {...},
        "error_handling": {...},
        "utilities": {...}
    },
    "shared_utilities": {"path": ["func", "description"]},
    "consolidation_opportunities": [{"files": [...], "pattern": "...", "target": "..."}],
    "anti_patterns": [{"pattern": "...", "fix": "...", "affected_files": [...]}]
}
"""

RLM_TEST_PATTERNS_PROMPT = """You have access to `codebase`, a dict of {filepath: content}.

Analyze existing test files to extract testing patterns and conventions.

Explore `codebase` to find all *.test.ts and *.test.tsx files and identify:
1. **Test Framework**: What testing tools are used?
2. **Structure**: How are tests organized (describe/it, test blocks)?
3. **Mocking**: How are dependencies mocked?
4. **Assertions**: What assertion patterns are used?
5. **Setup/Teardown**: beforeEach, afterEach patterns
6. **Naming**: Test description conventions
7. **Coverage**: What aspects are typically tested?

Also identify which source files DON'T have corresponding tests.

Output JSON:
{
    "test_patterns": {
        "framework": "deno test / vitest / jest",
        "imports": ["what to import for testing"],
        "structure": "describe/it pattern description",
        "mocking": "how mocking is done",
        "assertions": "assertion style",
        "setup": "setup/teardown patterns",
        "naming": "test naming convention"
    },
    "example_tests": [
        {"file": "path/to/example.test.ts", "why_good": "demonstrates pattern X"}
    ],
    "files_without_tests": [
        {"source": "path/to/file.ts", "exports": ["function1", "function2"], "priority": "high/medium/low"}
    ],
    "test_utilities": {
        "path/to/test-utils.ts": ["helper1", "description"]
    }
}
"""

RLM_DOC_PATTERNS_PROMPT = """You have access to `codebase`, a dict of {filepath: content}.

Analyze existing documentation patterns (JSDoc, TSDoc, comments).

Explore to identify:
1. **Doc Style**: JSDoc vs TSDoc, format used
2. **What's Documented**: functions, types, components, modules
3. **Doc Structure**: @param, @returns, @example usage
4. **Undocumented Exports**: public APIs without docs

Output JSON:
{
    "doc_patterns": {
        "style": "JSDoc/TSDoc",
        "format": "description of format",
        "required_tags": ["@param", "@returns", etc],
        "examples": ["good doc examples"]
    },
    "files_needing_docs": [
        {
            "file": "path/to/file.ts",
            "exports": [{"name": "funcName", "type": "function/type/component", "has_doc": false}],
            "priority": "high/medium/low"
        }
    ]
}
"""

RLM_FEATURE_CONTEXT_PROMPT = """You have access to:
- `codebase`: dict of {filepath: content}
- `prd`: the PRD/specification for the feature to implement

Analyze the codebase to understand:
1. **Architecture**: How is the codebase structured?
2. **Similar Features**: Existing code similar to what needs to be built
3. **Patterns to Follow**: Conventions the new code should match
4. **Integration Points**: Where new code should connect
5. **Dependencies**: What existing utilities/components to reuse

Output JSON:
{
    "architecture": {
        "structure": "description of codebase structure",
        "layers": ["routing", "components", "utils", etc],
        "key_directories": {"src/components": "React components", ...}
    },
    "similar_features": [
        {"file": "path", "relevance": "why it's similar", "patterns_to_copy": ["..."]}
    ],
    "patterns_to_follow": {
        "components": "how to structure components",
        "api_routes": "how to structure API routes",
        "state": "state management approach",
        "types": "type definition patterns"
    },
    "integration_points": [
        {"location": "path/to/file.ts", "how": "import and use X"}
    ],
    "reusable_code": [
        {"path": "path/to/util.ts", "exports": ["func1"], "use_for": "..."}
    ],
    "files_to_create": [
        {"path": "suggested/path.ts", "purpose": "...", "based_on": "similar/file.ts"}
    ],
    "files_to_modify": [
        {"path": "existing/file.ts", "changes": "what to add/change"}
    ]
}
"""

RLM_VERIFY_PROMPT = """You have access to:
- `codebase`: the updated codebase
- `rules`: the rules that were applied
- `changes`: summary of changes

Verify consistency:
1. Rules applied uniformly?
2. Any files missed or incorrectly processed?
3. Remaining cross-file inconsistencies?

Output JSON:
{
    "consistency_score": 0-100,
    "issues": [{"type": "...", "files": [...], "description": "...", "fix": "..."}],
    "summary": "..."
}
"""


# ============== Utilities ==============

def load_codebase(include_tests: bool = True) -> dict[str, str]:
    """Load all TypeScript files from src/."""
    codebase = {}
    src_path = Path(CONFIG["src_dir"])

    for ext in CONFIG["extensions"]:
        for file_path in src_path.rglob(f"*{ext}"):
            rel_path = str(file_path)

            # Optionally skip test files
            if not include_tests and any(rel_path.endswith(te) for te in CONFIG["test_extensions"]):
                continue

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
        backend_kwargs={"model_name": CONFIG["model_rlm"], "api_key": api_key},
        environment="local",
        verbose=True,
    )

    result = rlm.completion(query=query, context=context)
    return result.response


def load_json_file(name: str) -> dict | None:
    path = Path(CONFIG["output_dir"]) / name
    if path.exists():
        try:
            return json.loads(path.read_text())
        except:
            pass
    return None


def save_json_file(name: str, data: Any):
    ensure_output_dir()
    path = Path(CONFIG["output_dir"]) / name
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except:
            path.write_text(data)
            return
    path.write_text(json.dumps(data, indent=2))


def submit_batch(batch_path: Path, task_name: str) -> str:
    """Submit a batch file to OpenAI and return batch_id."""
    import requests
    api_key = get_api_key()

    print("📤 Uploading batch file...")
    with open(batch_path, "rb") as f:
        resp = requests.post(
            "https://api.openai.com/v1/files",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": ("batch.jsonl", f, "application/jsonl")},
            data={"purpose": "batch"}
        )
    if not resp.ok:
        print(f"Upload failed: {resp.text}")
        sys.exit(1)

    file_id = resp.json()["id"]
    print(f"✅ Uploaded: {file_id}")

    print("📦 Creating batch...")
    resp = requests.post(
        "https://api.openai.com/v1/batches",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "input_file_id": file_id,
            "endpoint": "/v1/chat/completions",
            "completion_window": "24h",
            "metadata": {"task": task_name}
        }
    )
    if not resp.ok:
        print(f"Batch creation failed: {resp.text}")
        sys.exit(1)

    batch_id = resp.json()["id"]
    print(f"✅ Batch created: {batch_id}")
    return batch_id


def check_batch_status(batch_id: str) -> dict:
    """Check batch status and return batch info."""
    import requests
    api_key = get_api_key()

    resp = requests.get(
        f"https://api.openai.com/v1/batches/{batch_id}",
        headers={"Authorization": f"Bearer {api_key}"}
    )
    return resp.json()


def download_batch_results(output_file_id: str) -> str:
    """Download batch results."""
    import requests
    api_key = get_api_key()

    resp = requests.get(
        f"https://api.openai.com/v1/files/{output_file_id}/content",
        headers={"Authorization": f"Bearer {api_key}"}
    )
    return resp.text


# ============== Optimization Commands ==============

def analyze():
    """Phase 1: RLM codebase analysis."""
    print("📊 Phase 1: RLM Codebase Analysis")
    print("=" * 50)

    print("\n📁 Loading codebase...")
    codebase = load_codebase()
    print(f"   Loaded {len(codebase)} files")

    print("\n🔍 Analyzing with RLM...")
    result = run_rlm(query=RLM_ANALYZE_PROMPT, context={"codebase": codebase})

    save_json_file("rules.json", result)
    print(f"\n✅ Rules generated: {CONFIG['output_dir']}/rules.json")
    print(f"\nNext: Run 'prepare' to create batch")


def prepare():
    """Phase 2a: Create batch with RLM rules."""
    print("📦 Phase 2a: Prepare Batch")
    print("=" * 50)

    rules = load_json_file("rules.json")
    if not rules:
        print("Error: No rules. Run 'analyze' first.")
        sys.exit(1)

    codebase = load_codebase()
    print(f"📁 Loaded {len(codebase)} files")

    system_prompt = f"""You are a code simplification expert. Simplify TypeScript/React code following these codebase rules:

{json.dumps(rules, indent=2)}

RULES:
1. PRESERVE all functionality
2. Apply codebase patterns for consistency
3. Remove dead code, unused imports
4. No nested ternaries
5. Clarity over brevity

OUTPUT: Return ONLY simplified code. No markdown fences.
If no changes needed, return exact input."""

    batch_lines = []
    for file_path, content in codebase.items():
        if len(content) < 50:
            continue
        custom_id = quote(file_path, safe="")
        batch_lines.append(json.dumps({
            "custom_id": custom_id,
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": CONFIG["model_batch"],
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"File: {file_path}\n\n{content}"}
                ],
                "max_completion_tokens": CONFIG["batch_max_completion_tokens"],
                "temperature": 0,
            }
        }))

    batch_path = Path(CONFIG["output_dir"]) / "batch-requests.jsonl"
    batch_path.write_text("\n".join(batch_lines))

    save_json_file("state.json", {
        "task": "optimize",
        "phase": "prepared",
        "file_count": len(batch_lines),
        "created_at": datetime.now().isoformat(),
    })

    print(f"\n✅ Batch created: {batch_path}")
    print(f"   Files: {len(batch_lines)}")
    print(f"\nNext: Run 'submit'")


def submit():
    """Phase 2b: Submit batch."""
    print("🚀 Phase 2b: Submit Batch")
    print("=" * 50)

    state = load_json_file("state.json")
    if not state:
        print("Error: No state. Run 'prepare' first.")
        sys.exit(1)

    batch_path = Path(CONFIG["output_dir"]) / "batch-requests.jsonl"
    batch_id = submit_batch(batch_path, state.get("task", "optimize"))

    state["batch_id"] = batch_id
    state["phase"] = "submitted"
    save_json_file("state.json", state)

    print(f"\nNext: Run 'status'")


def status():
    """Phase 2c: Check status."""
    print("📊 Phase 2c: Batch Status")
    print("=" * 50)

    state = load_json_file("state.json")
    if not state or "batch_id" not in state:
        print("Error: No batch. Run 'submit' first.")
        sys.exit(1)

    batch = check_batch_status(state["batch_id"])
    counts = batch.get("request_counts", {})

    print(f"\nStatus: {batch['status']}")
    print(f"Total: {counts.get('total', '?')}")
    print(f"Completed: {counts.get('completed', 0)}")
    print(f"Failed: {counts.get('failed', 0)}")

    if batch["status"] == "completed":
        state["output_file_id"] = batch["output_file_id"]
        state["phase"] = "completed"
        save_json_file("state.json", state)
        print(f"\n✅ Complete! Run 'download'")
    elif batch["status"] == "failed":
        print(f"\n❌ Failed")
    else:
        progress = counts.get("completed", 0) / max(counts.get("total", 1), 1) * 100
        print(f"\n⏳ Progress: {progress:.1f}%")


def download():
    """Phase 2d: Download results."""
    print("📥 Phase 2d: Download Results")
    print("=" * 50)

    state = load_json_file("state.json")
    if not state or "output_file_id" not in state:
        print("Error: Not complete. Run 'status' first.")
        sys.exit(1)

    content = download_batch_results(state["output_file_id"])
    results_path = Path(CONFIG["output_dir"]) / "batch-results.jsonl"
    results_path.write_text(content)

    print(f"✅ Downloaded: {results_path}")
    print(f"\nNext: Run 'apply'")


def apply():
    """Phase 2e: Apply changes."""
    print("🔧 Phase 2e: Apply Changes")
    print("=" * 50)

    results_path = Path(CONFIG["output_dir"]) / "batch-results.jsonl"
    if not results_path.exists():
        print("Error: No results. Run 'download' first.")
        sys.exit(1)

    state = load_json_file("state.json") or {}
    task = state.get("task", "optimize")

    results = [json.loads(line) for line in results_path.read_text().strip().split("\n")]

    applied = 0
    unchanged = 0
    errors = 0
    created = 0

    for result in results:
        custom_id = result["custom_id"]

        # Convert custom_id back to path
        if task == "generate_tests":
            # Test files: custom_id is source file, output goes to .test.ts
            file_path = unquote(custom_id)
            # Convert source path to test path
            if file_path.endswith(".tsx"):
                test_path = file_path.replace(".tsx", ".test.tsx")
            else:
                test_path = file_path.replace(".ts", ".test.ts")
        elif task == "generate_docs":
            file_path = unquote(custom_id)
            test_path = file_path  # Docs go back to same file
        else:
            file_path = unquote(custom_id)
            test_path = file_path

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

        content = content.strip()

        # Skip empty or "no test needed" responses
        if not content or content.lower() in ["no test needed", "skip", "n/a"]:
            unchanged += 1
            continue

        try:
            target_path = Path(test_path)

            if task in ["generate_tests", "generate_docs"]:
                # For generation, check if file is new
                is_new = not target_path.exists()
                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_text(content + "\n")

                if is_new:
                    print(f"✨ {test_path} (new)")
                    created += 1
                else:
                    print(f"✅ {test_path} (updated)")
                    applied += 1
            else:
                # For optimization, compare with original
                original = target_path.read_text().strip()
                if original == content:
                    unchanged += 1
                    continue

                target_path.write_text(content + "\n")
                print(f"✅ {file_path}")
                applied += 1

        except Exception as e:
            print(f"❌ {test_path}: {e}")
            errors += 1

    summary = {"applied": applied, "created": created, "unchanged": unchanged, "errors": errors}
    save_json_file("changes-summary.json", summary)

    print(f"\n📊 Summary:")
    if created:
        print(f"   Created: {created}")
    print(f"   Applied: {applied}")
    print(f"   Unchanged: {unchanged}")
    print(f"   Errors: {errors}")
    print(f"\nNext: Run 'verify' or 'git diff'")


def verify():
    """Phase 3: RLM verification."""
    print("🔍 Phase 3: RLM Verification")
    print("=" * 50)

    rules = load_json_file("rules.json") or {}
    changes = load_json_file("changes-summary.json") or {}

    print("\n📁 Loading codebase...")
    codebase = load_codebase()

    print("\n🔍 Verifying...")
    result = run_rlm(
        query=RLM_VERIFY_PROMPT,
        context={"codebase": codebase, "rules": rules, "changes": changes}
    )

    save_json_file("verification.json", result)
    print(f"\n✅ Verification: {CONFIG['output_dir']}/verification.json")


# ============== Generation Commands ==============

def generate_tests():
    """Generate tests for files without them."""
    print("🧪 Generate Tests")
    print("=" * 50)

    # Phase 1: Extract test patterns
    print("\n📊 Phase 1: Analyzing test patterns...")
    codebase = load_codebase(include_tests=True)
    print(f"   Loaded {len(codebase)} files")

    result = run_rlm(query=RLM_TEST_PATTERNS_PROMPT, context={"codebase": codebase})
    save_json_file("test-patterns.json", result)

    try:
        patterns = json.loads(result) if isinstance(result, str) else result
    except:
        print("⚠️  Could not parse patterns, using raw output")
        patterns = {"test_patterns": {}, "files_without_tests": []}

    files_to_test = patterns.get("files_without_tests", [])
    if not files_to_test:
        print("\n✅ All files have tests!")
        return

    print(f"\n📝 Found {len(files_to_test)} files without tests")

    # Phase 2: Create batch for test generation
    test_patterns = patterns.get("test_patterns", {})
    example_tests = patterns.get("example_tests", [])

    system_prompt = f"""You are a test generation expert. Generate comprehensive tests for TypeScript/React code.

TEST PATTERNS FROM THIS CODEBASE:
{json.dumps(test_patterns, indent=2)}

EXAMPLE TESTS TO FOLLOW:
{json.dumps(example_tests, indent=2)}

RULES:
1. Follow the exact testing patterns shown above
2. Test all exported functions, components, types
3. Include edge cases and error conditions
4. Use proper mocking patterns from the codebase
5. Match the naming and structure conventions

OUTPUT: Return ONLY the complete test file content. No explanations.
If the file doesn't need tests (e.g., just type exports), return "SKIP"."""

    batch_lines = []
    source_codebase = load_codebase(include_tests=False)

    for item in files_to_test:
        file_path = item.get("source") or item if isinstance(item, str) else None
        if not file_path or file_path not in source_codebase:
            continue

        content = source_codebase[file_path]
        custom_id = quote(file_path, safe="")

        batch_lines.append(json.dumps({
            "custom_id": custom_id,
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": CONFIG["model_batch"],
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Generate tests for:\n\nFile: {file_path}\n\n{content}"}
                ],
                "max_completion_tokens": CONFIG["batch_max_completion_tokens"],
                "temperature": 0,
            }
        }))

    if not batch_lines:
        print("No files to generate tests for.")
        return

    batch_path = Path(CONFIG["output_dir"]) / "batch-requests.jsonl"
    batch_path.write_text("\n".join(batch_lines))

    save_json_file("state.json", {
        "task": "generate_tests",
        "phase": "prepared",
        "file_count": len(batch_lines),
        "created_at": datetime.now().isoformat(),
    })

    print(f"\n✅ Batch created for {len(batch_lines)} files")
    print(f"\nNext: Run 'submit' then 'status' then 'download' then 'apply'")


def generate_docs():
    """Generate documentation for exports."""
    print("📚 Generate Documentation")
    print("=" * 50)

    # Phase 1: Extract doc patterns
    print("\n📊 Phase 1: Analyzing documentation patterns...")
    codebase = load_codebase(include_tests=False)
    print(f"   Loaded {len(codebase)} files")

    result = run_rlm(query=RLM_DOC_PATTERNS_PROMPT, context={"codebase": codebase})
    save_json_file("doc-patterns.json", result)

    try:
        patterns = json.loads(result) if isinstance(result, str) else result
    except:
        patterns = {"doc_patterns": {}, "files_needing_docs": []}

    files_to_doc = patterns.get("files_needing_docs", [])
    if not files_to_doc:
        print("\n✅ All exports are documented!")
        return

    print(f"\n📝 Found {len(files_to_doc)} files needing documentation")

    # Phase 2: Create batch for doc generation
    doc_patterns = patterns.get("doc_patterns", {})

    system_prompt = f"""You are a documentation expert. Add JSDoc/TSDoc to TypeScript/React code.

DOCUMENTATION PATTERNS FROM THIS CODEBASE:
{json.dumps(doc_patterns, indent=2)}

RULES:
1. Add docs to ALL exported functions, types, components
2. Follow the exact doc style shown above
3. Include @param, @returns, @example where appropriate
4. Keep existing code unchanged, only add documentation
5. Don't document internal/private functions

OUTPUT: Return the complete file with documentation added. No explanations."""

    batch_lines = []
    for item in files_to_doc:
        file_path = item.get("file") if isinstance(item, dict) else item
        if not file_path or file_path not in codebase:
            continue

        content = codebase[file_path]
        custom_id = quote(file_path, safe="")

        batch_lines.append(json.dumps({
            "custom_id": custom_id,
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": CONFIG["model_batch"],
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Add documentation to:\n\nFile: {file_path}\n\n{content}"}
                ],
                "max_completion_tokens": CONFIG["batch_max_completion_tokens"],
                "temperature": 0,
            }
        }))

    batch_path = Path(CONFIG["output_dir"]) / "batch-requests.jsonl"
    batch_path.write_text("\n".join(batch_lines))

    save_json_file("state.json", {
        "task": "generate_docs",
        "phase": "prepared",
        "file_count": len(batch_lines),
        "created_at": datetime.now().isoformat(),
    })

    print(f"\n✅ Batch created for {len(batch_lines)} files")
    print(f"\nNext: Run 'submit' then 'status' then 'download' then 'apply'")


def generate_feature(prd_path: str):
    """Generate feature implementation from PRD."""
    print("🚀 Generate Feature from PRD")
    print("=" * 50)

    prd_file = Path(prd_path)
    if not prd_file.exists():
        print(f"Error: PRD not found: {prd_path}")
        sys.exit(1)

    prd_content = prd_file.read_text()
    print(f"📄 Loaded PRD: {prd_path} ({len(prd_content)} chars)")

    # Phase 1: Analyze codebase for context
    print("\n📊 Phase 1: Analyzing codebase for feature context...")
    codebase = load_codebase(include_tests=False)
    print(f"   Loaded {len(codebase)} files")

    result = run_rlm(
        query=RLM_FEATURE_CONTEXT_PROMPT,
        context={"codebase": codebase, "prd": prd_content}
    )
    save_json_file("feature-context.json", result)

    try:
        context = json.loads(result) if isinstance(result, str) else result
    except:
        print("⚠️  Could not parse context")
        context = {}

    files_to_create = context.get("files_to_create", [])
    files_to_modify = context.get("files_to_modify", [])
    patterns = context.get("patterns_to_follow", {})
    similar = context.get("similar_features", [])

    print(f"\n📋 Feature Plan:")
    print(f"   Files to create: {len(files_to_create)}")
    print(f"   Files to modify: {len(files_to_modify)}")

    if not files_to_create and not files_to_modify:
        print("\n⚠️  No files identified. Review feature-context.json")
        return

    # Phase 2: Generate code for each file
    system_prompt = f"""You are a senior developer implementing a feature. Follow these codebase patterns:

PATTERNS:
{json.dumps(patterns, indent=2)}

SIMILAR EXISTING CODE:
{json.dumps(similar, indent=2)}

PRD:
{prd_content}

RULES:
1. Follow existing codebase patterns exactly
2. Use existing utilities and components where possible
3. Match naming conventions
4. Include proper TypeScript types
5. Add appropriate error handling

OUTPUT: Return ONLY the complete file content. No explanations."""

    batch_lines = []

    # Files to create
    for item in files_to_create:
        file_path = item.get("path", "")
        purpose = item.get("purpose", "")
        based_on = item.get("based_on", "")

        reference_content = ""
        if based_on and based_on in codebase:
            reference_content = f"\n\nREFERENCE (base your code on this):\n{codebase[based_on]}"

        custom_id = f"CREATE__{quote(file_path, safe='')}"

        batch_lines.append(json.dumps({
            "custom_id": custom_id,
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": CONFIG["model_batch"],
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Create new file:\n\nPath: {file_path}\nPurpose: {purpose}{reference_content}"}
                ],
                "max_completion_tokens": CONFIG["batch_max_completion_tokens"],
                "temperature": 0,
            }
        }))

    # Files to modify
    for item in files_to_modify:
        file_path = item.get("path", "")
        changes = item.get("changes", "")

        if file_path not in codebase:
            continue

        custom_id = f"MODIFY__{quote(file_path, safe='')}"

        batch_lines.append(json.dumps({
            "custom_id": custom_id,
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": CONFIG["model_batch"],
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Modify file:\n\nPath: {file_path}\nChanges needed: {changes}\n\nCurrent content:\n{codebase[file_path]}"}
                ],
                "max_completion_tokens": CONFIG["batch_max_completion_tokens"],
                "temperature": 0,
            }
        }))

    batch_path = Path(CONFIG["output_dir"]) / "batch-requests.jsonl"
    batch_path.write_text("\n".join(batch_lines))

    save_json_file("state.json", {
        "task": "generate_feature",
        "phase": "prepared",
        "file_count": len(batch_lines),
        "prd_path": prd_path,
        "files_to_create": [f.get("path") for f in files_to_create],
        "files_to_modify": [f.get("path") for f in files_to_modify],
        "created_at": datetime.now().isoformat(),
    })

    print(f"\n✅ Batch created for {len(batch_lines)} files")
    print(f"\nNext: Run 'submit' then 'status' then 'download' then 'apply-feature'")


def apply_feature():
    """Apply generated feature files."""
    print("🔧 Apply Feature")
    print("=" * 50)

    results_path = Path(CONFIG["output_dir"]) / "batch-results.jsonl"
    if not results_path.exists():
        print("Error: No results. Run 'download' first.")
        sys.exit(1)

    state = load_json_file("state.json") or {}
    results = [json.loads(line) for line in results_path.read_text().strip().split("\n")]

    created = 0
    modified = 0
    errors = 0

    for result in results:
        custom_id = result["custom_id"]

        # Parse custom_id to get action and path
        if custom_id.startswith("CREATE__"):
            action = "create"
            file_path = unquote(custom_id[8:])
        elif custom_id.startswith("MODIFY__"):
            action = "modify"
            file_path = unquote(custom_id[8:])
        else:
            continue

        if result.get("error"):
            print(f"❌ {file_path}: {result['error']}")
            errors += 1
            continue

        response = result.get("response", {})
        content = response.get("body", {}).get("choices", [{}])[0].get("message", {}).get("content")

        if not content:
            errors += 1
            continue

        try:
            target = Path(file_path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content.strip() + "\n")

            if action == "create":
                print(f"✨ {file_path} (created)")
                created += 1
            else:
                print(f"✅ {file_path} (modified)")
                modified += 1

        except Exception as e:
            print(f"❌ {file_path}: {e}")
            errors += 1

    print(f"\n📊 Summary:")
    print(f"   Created: {created}")
    print(f"   Modified: {modified}")
    print(f"   Errors: {errors}")


def estimate():
    """Estimate costs."""
    print("💰 Cost Estimate")
    print("=" * 50)

    codebase = load_codebase()
    total_chars = sum(len(c) for c in codebase.values())
    total_tokens = total_chars // 4

    # Estimates
    rlm_cost = (50_000 / 1_000_000) * (3.50 + 28.00)
    batch_input = total_tokens + (len(codebase) * 2000)
    batch_output = total_tokens * 0.8
    batch_cost = (batch_input / 1_000_000) * 1.75 + (batch_output / 1_000_000) * 14.00

    print(f"\nFiles: {len(codebase)}")
    print(f"Codebase: {total_chars:,} chars (~{total_tokens:,} tokens)")

    print(f"\n== Optimization ==")
    print(f"Phase 1 (RLM analyze):  ~${rlm_cost:.2f}")
    print(f"Phase 2 (Batch):        ~${batch_cost:.2f}")
    print(f"Phase 3 (RLM verify):   ~${rlm_cost:.2f}")
    print(f"Total:                  ~${rlm_cost * 2 + batch_cost:.2f}")

    print(f"\n== Generation ==")
    print(f"Tests (~50% of files):  ~${(rlm_cost + batch_cost * 0.5):.2f}")
    print(f"Docs (~30% of files):   ~${(rlm_cost + batch_cost * 0.3):.2f}")
    print(f"Feature (varies):       ~${rlm_cost + 5:.2f}")


def main():
    if len(sys.argv) < 2:
        print("""
Hybrid Code Optimizer & Generator

OPTIMIZATION:
  estimate     Show cost estimate
  analyze      Phase 1: RLM extracts patterns → rules.json
  prepare      Phase 2a: Create batch with rules
  submit       Phase 2b: Submit to OpenAI
  status       Phase 2c: Check progress
  download     Phase 2d: Get results
  apply        Phase 2e: Apply changes
  verify       Phase 3: RLM consistency check

GENERATION:
  generate tests              Generate tests for untested files
  generate docs               Generate documentation
  generate feature <prd.md>   Implement feature from PRD

After 'generate', run: submit → status → download → apply
""")
        return

    cmd = sys.argv[1]

    if cmd == "generate":
        if len(sys.argv) < 3:
            print("Usage: generate [tests|docs|feature <prd.md>]")
            sys.exit(1)

        gen_type = sys.argv[2]
        if gen_type == "tests":
            generate_tests()
        elif gen_type == "docs":
            generate_docs()
        elif gen_type == "feature":
            if len(sys.argv) < 4:
                print("Usage: generate feature <path/to/prd.md>")
                sys.exit(1)
            generate_feature(sys.argv[3])
        else:
            print(f"Unknown generate type: {gen_type}")
            sys.exit(1)
    elif cmd == "apply-feature":
        apply_feature()
    else:
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
        if cmd in commands:
            commands[cmd]()
        else:
            print(f"Unknown command: {cmd}")
            sys.exit(1)


if __name__ == "__main__":
    main()
