#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net
/**
 * Hybrid Code Optimizer & Generator
 *
 * Combines RLM (cross-file awareness) + Batch API (guaranteed coverage) for:
 * - Code optimization (simplify, refactor)
 * - Code generation (tests, docs, features)
 *
 * Usage:
 *   # Optimization
 *   deno task code-optimize analyze
 *   deno task code-optimize prepare
 *   deno task code-optimize submit
 *   deno task code-optimize status
 *   deno task code-optimize download
 *   deno task code-optimize apply
 *   deno task code-optimize verify
 *
 *   # Generation
 *   deno task code-optimize generate tests
 *   deno task code-optimize generate docs
 *   deno task code-optimize generate feature path/to/prd.md
 */

import { createRLM } from "../src/index.ts";

// Configuration
const CONFIG = {
  modelRlm: "gpt-4o",
  modelBatch: "gpt-4o",
  srcDir: "src",
  outputDir: "scripts/rlm-ts/output/code-optimize",
  extensions: [".ts", ".tsx"],
  testExtensions: [".test.ts", ".test.tsx"],
  maxFileSize: 100_000,
  batchMaxCompletionTokens: 16384,
};

// ============== Prompts ==============

const RLM_ANALYZE_PROMPT = `You have access to \`codebase\`, a dict of {filepath: content} containing the entire TypeScript/React codebase.

Analyze the codebase and generate a RULES document for consistent code optimization.

IMPORTANT: All relative imports MUST include explicit file extensions (.ts, .tsx, .js, .jsx, .mdx, .md, .json, .css).

Explore programmatically to identify:
1. **Naming Conventions**: variables, functions, components, types
2. **Code Patterns**: error handling, data fetching, state management
3. **Import Style**: organization, sorting, and EXPLICIT FILE EXTENSIONS (always required)
4. **Component Structure**: React component patterns
5. **Type Patterns**: TypeScript types/interfaces usage
6. **Utility Functions**: shared utilities that should be reused
7. **Anti-patterns**: inconsistencies to fix (e.g., missing file extensions in imports)

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
`;

const RLM_TEST_PATTERNS_PROMPT = `You have access to \`codebase\`, a dict of {filepath: content}.

Analyze existing test files to extract testing patterns and conventions.

Explore \`codebase\` to find all *.test.ts and *.test.tsx files and identify:
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
`;

const RLM_DOC_PATTERNS_PROMPT = `You have access to \`codebase\`, a dict of {filepath: content}.

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
`;

const RLM_FEATURE_CONTEXT_PROMPT = `You have access to:
- \`codebase\`: dict of {filepath: content}
- \`prd\`: the PRD/specification for the feature to implement

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
`;

const RLM_VERIFY_PROMPT = `You have access to:
- \`codebase\`: the updated codebase
- \`rules\`: the rules that were applied
- \`changes\`: summary of changes

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
`;

// ============== Types ==============

interface State {
  task: string;
  phase: string;
  file_count?: number;
  batch_id?: string;
  output_file_id?: string;
  created_at?: string;
  prd_path?: string;
  files_to_create?: string[];
  files_to_modify?: string[];
}

interface BatchRequest {
  custom_id: string;
  method: "POST";
  url: string;
  body: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    max_completion_tokens: number;
    temperature: number;
  };
}

interface BatchResult {
  custom_id: string;
  error?: { message: string };
  response?: {
    status_code: number;
    body?: {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
  };
}

// ============== Utilities ==============

async function loadCodebase(includeTests = true): Promise<Record<string, string>> {
  const codebase: Record<string, string> = {};

  async function walkDir(dir: string): Promise<void> {
    try {
      for await (const entry of Deno.readDir(dir)) {
        const path = `${dir}/${entry.name}`;

        if (entry.isDirectory) {
          await walkDir(path);
        } else if (entry.isFile) {
          const hasValidExt = CONFIG.extensions.some((ext) =>
            entry.name.endsWith(ext)
          );
          if (!hasValidExt) continue;

          if (!includeTests) {
            const isTest = CONFIG.testExtensions.some((ext) =>
              entry.name.endsWith(ext)
            );
            if (isTest) continue;
          }

          try {
            const content = await Deno.readTextFile(path);
            if (content.length <= CONFIG.maxFileSize) {
              codebase[path] = content;
            }
          } catch (e) {
            console.error(`Warning: Could not read ${path}: ${e}`);
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  await walkDir(CONFIG.srcDir);
  return codebase;
}

async function ensureOutputDir(): Promise<void> {
  await Deno.mkdir(CONFIG.outputDir, { recursive: true });
}

function getApiKey(): string {
  let key = Deno.env.get("OPENAI_API_KEY");

  if (!key) {
    try {
      const envContent = Deno.readTextFileSync(".env");
      for (const line of envContent.split("\n")) {
        if (line.startsWith("OPENAI_API_KEY=")) {
          key = line.split("=")[1].trim();
          break;
        }
      }
    } catch {
      // .env doesn't exist
    }
  }

  if (!key) {
    console.error("Error: OPENAI_API_KEY not set");
    Deno.exit(1);
  }
  return key;
}

async function runRLM(
  query: string,
  context: Record<string, unknown>
): Promise<string> {
  const apiKey = getApiKey();

  const rlm = createRLM({
    backend: "openai",
    backendConfig: {
      apiKey,
      model: CONFIG.modelRlm,
    },
    verbose: true,
  });

  const result = await rlm.completion({ query, context });
  return result.response;
}

async function loadJsonFile<T>(name: string): Promise<T | null> {
  const path = `${CONFIG.outputDir}/${name}`;
  try {
    const content = await Deno.readTextFile(path);
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function saveJsonFile(name: string, data: unknown): Promise<void> {
  await ensureOutputDir();
  const path = `${CONFIG.outputDir}/${name}`;

  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      await Deno.writeTextFile(path, JSON.stringify(parsed, null, 2));
    } catch {
      await Deno.writeTextFile(path, data);
    }
    return;
  }

  await Deno.writeTextFile(path, JSON.stringify(data, null, 2));
}

async function submitBatch(batchPath: string, taskName: string): Promise<string> {
  const apiKey = getApiKey();

  console.log("Uploading batch file...");
  const fileContent = await Deno.readFile(batchPath);

  const formData = new FormData();
  formData.append("file", new Blob([fileContent], { type: "application/jsonl" }), "batch.jsonl");
  formData.append("purpose", "batch");

  const uploadResp = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!uploadResp.ok) {
    console.error(`Upload failed: ${await uploadResp.text()}`);
    Deno.exit(1);
  }

  const uploadResult = await uploadResp.json();
  const fileId = uploadResult.id;
  console.log(`Uploaded: ${fileId}`);

  console.log("Creating batch...");
  const batchResp = await fetch("https://api.openai.com/v1/batches", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input_file_id: fileId,
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
      metadata: { task: taskName },
    }),
  });

  if (!batchResp.ok) {
    console.error(`Batch creation failed: ${await batchResp.text()}`);
    Deno.exit(1);
  }

  const batchResult = await batchResp.json();
  const batchId = batchResult.id;
  console.log(`Batch created: ${batchId}`);
  return batchId;
}

async function checkBatchStatus(batchId: string): Promise<Record<string, unknown>> {
  const apiKey = getApiKey();

  const resp = await fetch(`https://api.openai.com/v1/batches/${batchId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  return await resp.json();
}

async function downloadBatchResults(outputFileId: string): Promise<string> {
  const apiKey = getApiKey();

  const resp = await fetch(
    `https://api.openai.com/v1/files/${outputFileId}/content`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );

  return await resp.text();
}

// ============== Optimization Commands ==============

async function analyze(): Promise<void> {
  console.log("Phase 1: RLM Codebase Analysis");
  console.log("=".repeat(50));

  console.log("\nLoading codebase...");
  const codebase = await loadCodebase();
  console.log(`   Loaded ${Object.keys(codebase).length} files`);

  console.log("\nAnalyzing with RLM...");
  const result = await runRLM(RLM_ANALYZE_PROMPT, { codebase });

  await saveJsonFile("rules.json", result);
  console.log(`\nRules generated: ${CONFIG.outputDir}/rules.json`);
  console.log(`\nNext: Run 'prepare' to create batch`);
}

async function prepare(): Promise<void> {
  console.log("Phase 2a: Prepare Batch");
  console.log("=".repeat(50));

  const rules = await loadJsonFile("rules.json");
  if (!rules) {
    console.error("Error: No rules. Run 'analyze' first.");
    Deno.exit(1);
  }

  const codebase = await loadCodebase();
  console.log(`Loaded ${Object.keys(codebase).length} files`);

  const systemPrompt = `You are a code simplification expert. Simplify TypeScript/React code following these codebase rules:

${JSON.stringify(rules, null, 2)}

RULES:
1. PRESERVE all functionality
2. Apply codebase patterns for consistency
3. Remove dead code, unused imports
4. No nested ternaries
5. Clarity over brevity

CRITICAL - IMPORTS:
- ALWAYS keep file extensions in relative imports
- Explicit extensions are REQUIRED (.ts, .tsx, .js, .jsx, .mdx, .md, .json, .css)
- Example: import { foo } from "./bar.ts"  ✓
- WRONG:  import { foo } from "./bar"      ✗
- NEVER remove or change file extensions in import paths

OUTPUT: Return ONLY simplified code. No markdown fences.
If no changes needed, return exact input.`;

  const batchLines: string[] = [];
  for (const [filePath, content] of Object.entries(codebase)) {
    if (content.length < 50) continue;

    const customId = encodeURIComponent(filePath);
    const request: BatchRequest = {
      custom_id: customId,
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model: CONFIG.modelBatch,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `File: ${filePath}\n\n${content}` },
        ],
        max_completion_tokens: CONFIG.batchMaxCompletionTokens,
        temperature: 0,
      },
    };
    batchLines.push(JSON.stringify(request));
  }

  await ensureOutputDir();
  const batchPath = `${CONFIG.outputDir}/batch-requests.jsonl`;
  await Deno.writeTextFile(batchPath, batchLines.join("\n"));

  await saveJsonFile("state.json", {
    task: "optimize",
    phase: "prepared",
    file_count: batchLines.length,
    created_at: new Date().toISOString(),
  });

  console.log(`\nBatch created: ${batchPath}`);
  console.log(`   Files: ${batchLines.length}`);
  console.log(`\nNext: Run 'submit'`);
}

async function submit(): Promise<void> {
  console.log("Phase 2b: Submit Batch");
  console.log("=".repeat(50));

  const state = await loadJsonFile<State>("state.json");
  if (!state) {
    console.error("Error: No state. Run 'prepare' first.");
    Deno.exit(1);
  }

  const batchPath = `${CONFIG.outputDir}/batch-requests.jsonl`;
  const batchId = await submitBatch(batchPath, state.task || "optimize");

  state.batch_id = batchId;
  state.phase = "submitted";
  await saveJsonFile("state.json", state);

  console.log(`\nNext: Run 'status'`);
}

async function status(): Promise<void> {
  console.log("Phase 2c: Batch Status");
  console.log("=".repeat(50));

  const state = await loadJsonFile<State>("state.json");
  if (!state || !state.batch_id) {
    console.error("Error: No batch. Run 'submit' first.");
    Deno.exit(1);
  }

  const batch = await checkBatchStatus(state.batch_id);
  const counts = (batch.request_counts || {}) as Record<string, number>;

  console.log(`\nStatus: ${batch.status}`);
  console.log(`Total: ${counts.total ?? "?"}`);
  console.log(`Completed: ${counts.completed ?? 0}`);
  console.log(`Failed: ${counts.failed ?? 0}`);

  if (batch.status === "completed") {
    state.output_file_id = batch.output_file_id as string;
    state.phase = "completed";
    await saveJsonFile("state.json", state);
    console.log(`\nComplete! Run 'download'`);
  } else if (batch.status === "failed") {
    console.log(`\nFailed`);
  } else {
    const progress = ((counts.completed ?? 0) / Math.max(counts.total ?? 1, 1)) * 100;
    console.log(`\nProgress: ${progress.toFixed(1)}%`);
  }
}

async function download(): Promise<void> {
  console.log("Phase 2d: Download Results");
  console.log("=".repeat(50));

  const state = await loadJsonFile<State>("state.json");
  if (!state || !state.output_file_id) {
    console.error("Error: Not complete. Run 'status' first.");
    Deno.exit(1);
  }

  const content = await downloadBatchResults(state.output_file_id);
  const resultsPath = `${CONFIG.outputDir}/batch-results.jsonl`;
  await Deno.writeTextFile(resultsPath, content);

  console.log(`Downloaded: ${resultsPath}`);
  console.log(`\nNext: Run 'apply'`);
}

async function apply(): Promise<void> {
  console.log("Phase 2e: Apply Changes");
  console.log("=".repeat(50));

  const resultsPath = `${CONFIG.outputDir}/batch-results.jsonl`;
  let resultsContent: string;
  try {
    resultsContent = await Deno.readTextFile(resultsPath);
  } catch {
    console.error("Error: No results. Run 'download' first.");
    Deno.exit(1);
  }

  const state = await loadJsonFile<State>("state.json") || { task: "optimize", phase: "" };
  const task = state.task;

  const results: BatchResult[] = resultsContent
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  let applied = 0;
  let unchanged = 0;
  let errors = 0;
  let created = 0;

  for (const result of results) {
    const customId = result.custom_id;

    // Convert custom_id back to path
    let filePath: string;
    let testPath: string;

    if (task === "generate_tests") {
      filePath = decodeURIComponent(customId);
      testPath = filePath.endsWith(".tsx")
        ? filePath.replace(".tsx", ".test.tsx")
        : filePath.replace(".ts", ".test.ts");
    } else if (task === "generate_docs") {
      filePath = decodeURIComponent(customId);
      testPath = filePath;
    } else {
      filePath = decodeURIComponent(customId);
      testPath = filePath;
    }

    if (result.error) {
      console.log(`  ${filePath}: ${result.error.message}`);
      errors++;
      continue;
    }

    const response = result.response;
    if (response?.status_code !== 200) {
      errors++;
      continue;
    }

    const content = response.body?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      errors++;
      continue;
    }

    // Skip empty or "no test needed" responses
    if (["no test needed", "skip", "n/a"].includes(content.toLowerCase())) {
      unchanged++;
      continue;
    }

    try {
      if (task === "generate_tests" || task === "generate_docs") {
        let isNew = false;
        try {
          await Deno.stat(testPath);
        } catch {
          isNew = true;
        }

        // Ensure parent directory exists
        const parentDir = testPath.substring(0, testPath.lastIndexOf("/"));
        await Deno.mkdir(parentDir, { recursive: true });
        await Deno.writeTextFile(testPath, content + "\n");

        if (isNew) {
          console.log(`  ${testPath} (new)`);
          created++;
        } else {
          console.log(`  ${testPath} (updated)`);
          applied++;
        }
      } else {
        // For optimization, compare with original
        const original = (await Deno.readTextFile(testPath)).trim();
        if (original === content) {
          unchanged++;
          continue;
        }

        await Deno.writeTextFile(testPath, content + "\n");
        console.log(`  ${filePath}`);
        applied++;
      }
    } catch (e) {
      console.log(`  ${testPath}: ${e}`);
      errors++;
    }
  }

  await saveJsonFile("changes-summary.json", { applied, created, unchanged, errors });

  console.log(`\nSummary:`);
  if (created) console.log(`   Created: ${created}`);
  console.log(`   Applied: ${applied}`);
  console.log(`   Unchanged: ${unchanged}`);
  console.log(`   Errors: ${errors}`);
  console.log(`\nNext: Run 'verify' or 'git diff'`);
}

async function verify(): Promise<void> {
  console.log("Phase 3: RLM Verification");
  console.log("=".repeat(50));

  const rules = await loadJsonFile("rules.json") || {};
  const changes = await loadJsonFile("changes-summary.json") || {};

  console.log("\nLoading codebase...");
  const codebase = await loadCodebase();

  console.log("\nVerifying...");
  const result = await runRLM(RLM_VERIFY_PROMPT, { codebase, rules, changes });

  await saveJsonFile("verification.json", result);
  console.log(`\nVerification: ${CONFIG.outputDir}/verification.json`);
}

// ============== Generation Commands ==============

async function generateTests(): Promise<void> {
  console.log("Generate Tests");
  console.log("=".repeat(50));

  // Phase 1: Extract test patterns
  console.log("\nPhase 1: Analyzing test patterns...");
  const codebase = await loadCodebase(true);
  console.log(`   Loaded ${Object.keys(codebase).length} files`);

  const result = await runRLM(RLM_TEST_PATTERNS_PROMPT, { codebase });
  await saveJsonFile("test-patterns.json", result);

  let patterns: Record<string, unknown>;
  try {
    patterns = typeof result === "string" ? JSON.parse(result) : result;
  } catch {
    console.log("Could not parse patterns, using raw output");
    patterns = { test_patterns: {}, files_without_tests: [] };
  }

  const filesToTest = (patterns.files_without_tests || []) as Array<{ source?: string } | string>;
  if (filesToTest.length === 0) {
    console.log("\nAll files have tests!");
    return;
  }

  console.log(`\nFound ${filesToTest.length} files without tests`);

  // Phase 2: Create batch for test generation
  const testPatterns = patterns.test_patterns || {};
  const exampleTests = patterns.example_tests || [];

  const systemPrompt = `You are a test generation expert. Generate comprehensive tests for TypeScript/React code.

TEST PATTERNS FROM THIS CODEBASE:
${JSON.stringify(testPatterns, null, 2)}

EXAMPLE TESTS TO FOLLOW:
${JSON.stringify(exampleTests, null, 2)}

RULES:
1. Follow the exact testing patterns shown above
2. Test all exported functions, components, types
3. Include edge cases and error conditions
4. Use proper mocking patterns from the codebase
5. Match the naming and structure conventions

CRITICAL - IMPORTS:
- ALWAYS include file extensions in relative imports
- Explicit extensions are REQUIRED (.ts, .tsx, .js, .jsx, .mdx, .md, .json, .css)
- Example: import { foo } from "./bar.ts"  ✓
- WRONG:  import { foo } from "./bar"      ✗

OUTPUT: Return ONLY the complete test file content. No explanations.
If the file doesn't need tests (e.g., just type exports), return "SKIP".`;

  const batchLines: string[] = [];
  const sourceCodebase = await loadCodebase(false);

  for (const item of filesToTest) {
    const filePath = typeof item === "string" ? item : item.source;
    if (!filePath || !sourceCodebase[filePath]) continue;

    const content = sourceCodebase[filePath];
    const customId = encodeURIComponent(filePath);

    const request: BatchRequest = {
      custom_id: customId,
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model: CONFIG.modelBatch,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Generate tests for:\n\nFile: ${filePath}\n\n${content}` },
        ],
        max_completion_tokens: CONFIG.batchMaxCompletionTokens,
        temperature: 0,
      },
    };
    batchLines.push(JSON.stringify(request));
  }

  if (batchLines.length === 0) {
    console.log("No files to generate tests for.");
    return;
  }

  await ensureOutputDir();
  const batchPath = `${CONFIG.outputDir}/batch-requests.jsonl`;
  await Deno.writeTextFile(batchPath, batchLines.join("\n"));

  await saveJsonFile("state.json", {
    task: "generate_tests",
    phase: "prepared",
    file_count: batchLines.length,
    created_at: new Date().toISOString(),
  });

  console.log(`\nBatch created for ${batchLines.length} files`);
  console.log(`\nNext: Run 'submit' then 'status' then 'download' then 'apply'`);
}

async function generateDocs(): Promise<void> {
  console.log("Generate Documentation");
  console.log("=".repeat(50));

  // Phase 1: Extract doc patterns
  console.log("\nPhase 1: Analyzing documentation patterns...");
  const codebase = await loadCodebase(false);
  console.log(`   Loaded ${Object.keys(codebase).length} files`);

  const result = await runRLM(RLM_DOC_PATTERNS_PROMPT, { codebase });
  await saveJsonFile("doc-patterns.json", result);

  let patterns: Record<string, unknown>;
  try {
    patterns = typeof result === "string" ? JSON.parse(result) : result;
  } catch {
    patterns = { doc_patterns: {}, files_needing_docs: [] };
  }

  const filesToDoc = (patterns.files_needing_docs || []) as Array<{ file?: string } | string>;
  if (filesToDoc.length === 0) {
    console.log("\nAll exports are documented!");
    return;
  }

  console.log(`\nFound ${filesToDoc.length} files needing documentation`);

  // Phase 2: Create batch for doc generation
  const docPatterns = patterns.doc_patterns || {};

  const systemPrompt = `You are a documentation expert. Add JSDoc/TSDoc to TypeScript/React code.

DOCUMENTATION PATTERNS FROM THIS CODEBASE:
${JSON.stringify(docPatterns, null, 2)}

RULES:
1. Add docs to ALL exported functions, types, components
2. Follow the exact doc style shown above
3. Include @param, @returns, @example where appropriate
4. Keep existing code unchanged, only add documentation
5. Don't document internal/private functions

CRITICAL - IMPORTS:
- NEVER modify import statements
- Keep all file extensions exactly as they are
- Explicit extensions are REQUIRED (.ts, .tsx, .js, .jsx, .mdx, .md, .json, .css)

OUTPUT: Return the complete file with documentation added. No explanations.`;

  const batchLines: string[] = [];
  for (const item of filesToDoc) {
    const filePath = typeof item === "string" ? item : item.file;
    if (!filePath || !codebase[filePath]) continue;

    const content = codebase[filePath];
    const customId = encodeURIComponent(filePath);

    const request: BatchRequest = {
      custom_id: customId,
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model: CONFIG.modelBatch,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Add documentation to:\n\nFile: ${filePath}\n\n${content}` },
        ],
        max_completion_tokens: CONFIG.batchMaxCompletionTokens,
        temperature: 0,
      },
    };
    batchLines.push(JSON.stringify(request));
  }

  await ensureOutputDir();
  const batchPath = `${CONFIG.outputDir}/batch-requests.jsonl`;
  await Deno.writeTextFile(batchPath, batchLines.join("\n"));

  await saveJsonFile("state.json", {
    task: "generate_docs",
    phase: "prepared",
    file_count: batchLines.length,
    created_at: new Date().toISOString(),
  });

  console.log(`\nBatch created for ${batchLines.length} files`);
  console.log(`\nNext: Run 'submit' then 'status' then 'download' then 'apply'`);
}

async function generateFeature(prdPath: string): Promise<void> {
  console.log("Generate Feature from PRD");
  console.log("=".repeat(50));

  let prdContent: string;
  try {
    prdContent = await Deno.readTextFile(prdPath);
  } catch {
    console.error(`Error: PRD not found: ${prdPath}`);
    Deno.exit(1);
  }

  console.log(`Loaded PRD: ${prdPath} (${prdContent.length} chars)`);

  // Phase 1: Analyze codebase for context
  console.log("\nPhase 1: Analyzing codebase for feature context...");
  const codebase = await loadCodebase(false);
  console.log(`   Loaded ${Object.keys(codebase).length} files`);

  const result = await runRLM(RLM_FEATURE_CONTEXT_PROMPT, { codebase, prd: prdContent });
  await saveJsonFile("feature-context.json", result);

  let context: Record<string, unknown>;
  try {
    context = typeof result === "string" ? JSON.parse(result) : result;
  } catch {
    console.log("Could not parse context");
    context = {};
  }

  const filesToCreate = (context.files_to_create || []) as Array<{ path: string; purpose?: string; based_on?: string }>;
  const filesToModify = (context.files_to_modify || []) as Array<{ path: string; changes?: string }>;
  const patterns = context.patterns_to_follow || {};
  const similar = context.similar_features || [];

  console.log(`\nFeature Plan:`);
  console.log(`   Files to create: ${filesToCreate.length}`);
  console.log(`   Files to modify: ${filesToModify.length}`);

  if (filesToCreate.length === 0 && filesToModify.length === 0) {
    console.log(`\nNo files identified. Review feature-context.json`);
    return;
  }

  // Phase 2: Generate code for each file
  const systemPrompt = `You are a senior developer implementing a feature. Follow these codebase patterns:

PATTERNS:
${JSON.stringify(patterns, null, 2)}

SIMILAR EXISTING CODE:
${JSON.stringify(similar, null, 2)}

PRD:
${prdContent}

RULES:
1. Follow existing codebase patterns exactly
2. Use existing utilities and components where possible
3. Match naming conventions
4. Include proper TypeScript types
5. Add appropriate error handling

CRITICAL - IMPORTS:
- ALWAYS include file extensions in relative imports
- Explicit extensions are REQUIRED (.ts, .tsx, .js, .jsx, .mdx, .md, .json, .css)
- Example: import { foo } from "./bar.ts"  ✓
- WRONG:  import { foo } from "./bar"      ✗

OUTPUT: Return ONLY the complete file content. No explanations.`;

  const batchLines: string[] = [];

  // Files to create
  for (const item of filesToCreate) {
    const filePath = item.path;
    const purpose = item.purpose || "";
    const basedOn = item.based_on || "";

    let referenceContent = "";
    if (basedOn && codebase[basedOn]) {
      referenceContent = `\n\nREFERENCE (base your code on this):\n${codebase[basedOn]}`;
    }

    const customId = `CREATE__${encodeURIComponent(filePath)}`;

    const request: BatchRequest = {
      custom_id: customId,
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model: CONFIG.modelBatch,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Create new file:\n\nPath: ${filePath}\nPurpose: ${purpose}${referenceContent}` },
        ],
        max_completion_tokens: CONFIG.batchMaxCompletionTokens,
        temperature: 0,
      },
    };
    batchLines.push(JSON.stringify(request));
  }

  // Files to modify
  for (const item of filesToModify) {
    const filePath = item.path;
    const changes = item.changes || "";

    if (!codebase[filePath]) continue;

    const customId = `MODIFY__${encodeURIComponent(filePath)}`;

    const request: BatchRequest = {
      custom_id: customId,
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model: CONFIG.modelBatch,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Modify file:\n\nPath: ${filePath}\nChanges needed: ${changes}\n\nCurrent content:\n${codebase[filePath]}` },
        ],
        max_completion_tokens: CONFIG.batchMaxCompletionTokens,
        temperature: 0,
      },
    };
    batchLines.push(JSON.stringify(request));
  }

  await ensureOutputDir();
  const batchPath = `${CONFIG.outputDir}/batch-requests.jsonl`;
  await Deno.writeTextFile(batchPath, batchLines.join("\n"));

  await saveJsonFile("state.json", {
    task: "generate_feature",
    phase: "prepared",
    file_count: batchLines.length,
    prd_path: prdPath,
    files_to_create: filesToCreate.map((f) => f.path),
    files_to_modify: filesToModify.map((f) => f.path),
    created_at: new Date().toISOString(),
  });

  console.log(`\nBatch created for ${batchLines.length} files`);
  console.log(`\nNext: Run 'submit' then 'status' then 'download' then 'apply-feature'`);
}

async function applyFeature(): Promise<void> {
  console.log("Apply Feature");
  console.log("=".repeat(50));

  const resultsPath = `${CONFIG.outputDir}/batch-results.jsonl`;
  let resultsContent: string;
  try {
    resultsContent = await Deno.readTextFile(resultsPath);
  } catch {
    console.error("Error: No results. Run 'download' first.");
    Deno.exit(1);
  }

  const results: BatchResult[] = resultsContent
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  let created = 0;
  let modified = 0;
  let errors = 0;

  for (const result of results) {
    const customId = result.custom_id;

    // Parse custom_id to get action and path
    let action: "create" | "modify";
    let filePath: string;

    if (customId.startsWith("CREATE__")) {
      action = "create";
      filePath = decodeURIComponent(customId.substring(8));
    } else if (customId.startsWith("MODIFY__")) {
      action = "modify";
      filePath = decodeURIComponent(customId.substring(8));
    } else {
      continue;
    }

    if (result.error) {
      console.log(`  ${filePath}: ${result.error.message}`);
      errors++;
      continue;
    }

    const content = result.response?.body?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      errors++;
      continue;
    }

    try {
      // Ensure parent directory exists
      const parentDir = filePath.substring(0, filePath.lastIndexOf("/"));
      await Deno.mkdir(parentDir, { recursive: true });
      await Deno.writeTextFile(filePath, content + "\n");

      if (action === "create") {
        console.log(`  ${filePath} (created)`);
        created++;
      } else {
        console.log(`  ${filePath} (modified)`);
        modified++;
      }
    } catch (e) {
      console.log(`  ${filePath}: ${e}`);
      errors++;
    }
  }

  console.log(`\nSummary:`);
  console.log(`   Created: ${created}`);
  console.log(`   Modified: ${modified}`);
  console.log(`   Errors: ${errors}`);
}

async function estimate(): Promise<void> {
  console.log("Cost Estimate");
  console.log("=".repeat(50));

  const codebase = await loadCodebase();
  const totalChars = Object.values(codebase).reduce((sum, c) => sum + c.length, 0);
  const totalTokens = Math.floor(totalChars / 4);

  // Estimates (GPT-4o pricing)
  const rlmCost = (50_000 / 1_000_000) * (2.5 + 10);
  const batchInput = totalTokens + Object.keys(codebase).length * 2000;
  const batchOutput = totalTokens * 0.8;
  const batchCost = (batchInput / 1_000_000) * 1.25 + (batchOutput / 1_000_000) * 5;

  console.log(`\nFiles: ${Object.keys(codebase).length}`);
  console.log(`Codebase: ${totalChars.toLocaleString()} chars (~${totalTokens.toLocaleString()} tokens)`);

  console.log(`\n== Optimization ==`);
  console.log(`Phase 1 (RLM analyze):  ~$${rlmCost.toFixed(2)}`);
  console.log(`Phase 2 (Batch):        ~$${batchCost.toFixed(2)}`);
  console.log(`Phase 3 (RLM verify):   ~$${rlmCost.toFixed(2)}`);
  console.log(`Total:                  ~$${(rlmCost * 2 + batchCost).toFixed(2)}`);

  console.log(`\n== Generation ==`);
  console.log(`Tests (~50% of files):  ~$${(rlmCost + batchCost * 0.5).toFixed(2)}`);
  console.log(`Docs (~30% of files):   ~$${(rlmCost + batchCost * 0.3).toFixed(2)}`);
  console.log(`Feature (varies):       ~$${(rlmCost + 5).toFixed(2)}`);
}

// ============== Main ==============

function printHelp(): void {
  console.log(`
Hybrid Code Optimizer & Generator

OPTIMIZATION:
  estimate     Show cost estimate
  analyze      Phase 1: RLM extracts patterns -> rules.json
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

After 'generate', run: submit -> status -> download -> apply
`);
}

async function main(): Promise<void> {
  const cmd = Deno.args[0];

  if (!cmd) {
    printHelp();
    return;
  }

  if (cmd === "generate") {
    const genType = Deno.args[1];
    if (!genType) {
      console.log("Usage: generate [tests|docs|feature <prd.md>]");
      Deno.exit(1);
    }

    switch (genType) {
      case "tests":
        await generateTests();
        break;
      case "docs":
        await generateDocs();
        break;
      case "feature": {
        const prdPath = Deno.args[2];
        if (!prdPath) {
          console.log("Usage: generate feature <path/to/prd.md>");
          Deno.exit(1);
        }
        await generateFeature(prdPath);
        break;
      }
      default:
        console.error(`Unknown generate type: ${genType}`);
        Deno.exit(1);
    }
    return;
  }

  if (cmd === "apply-feature") {
    await applyFeature();
    return;
  }

  const commands: Record<string, () => Promise<void>> = {
    estimate,
    analyze,
    prepare,
    submit,
    status,
    download,
    apply,
    verify,
  };

  if (cmd in commands) {
    await commands[cmd]();
  } else if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
  } else {
    console.error(`Unknown command: ${cmd}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
