#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net
/**
 * RLM Codebase Optimizer
 *
 * Uses Recursive Language Models to analyze and optimize the entire codebase
 * with cross-file awareness. Unlike batch processing, RLM can:
 * - Identify patterns across files
 * - Ensure consistent refactoring
 * - Suggest architectural improvements
 *
 * Usage:
 *   deno task optimize estimate
 *   deno task optimize analyze
 *   deno task optimize simplify
 *   deno task optimize apply
 */

import { createRLM } from "../src/index.ts";

// Configuration
const CONFIG = {
  model: "gpt-4o",
  srcDir: "src",
  outputDir: "scripts/rlm-ts/output/optimize",
  extensions: [".ts", ".tsx"],
  maxFileSize: 100_000,
  excludePatterns: [] as string[],
};

const SYSTEM_PROMPT = `You are an expert code optimization assistant with access to an entire TypeScript/React codebase.
You can examine, search, and analyze the codebase programmatically using the provided REPL environment.

The codebase is available as \`codebase\`, a dict mapping file paths to file contents.

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
`;

const ANALYZE_PROMPT = `Analyze the codebase for optimization opportunities.

Use the REPL to explore \`codebase\` and identify:

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
`;

const SIMPLIFY_PROMPT = `Simplify the codebase while maintaining consistency across all files.

You have access to:
- \`codebase\`: dict of {filepath: content}
- \`analysis\`: previous analysis findings (if available)

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
`;

// Types
interface AnalysisFinding {
  type: string;
  files: string[];
  description: string;
  suggestion: string;
  priority: "high" | "medium" | "low";
}

interface AnalysisResult {
  findings: AnalysisFinding[];
  summary: {
    total_files: number;
    files_with_issues: number;
    high_priority: number;
    medium_priority: number;
    low_priority: number;
  };
}

interface SimplificationChange {
  original_lines: number;
  simplified_lines: number;
  changes_summary: string;
  content: string;
}

interface SimplificationResult {
  changes: Record<string, SimplificationChange>;
  unchanged: string[];
  summary: {
    files_changed: number;
    files_unchanged: number;
    lines_removed: number;
  };
}

// Utilities
async function loadCodebase(): Promise<Record<string, string>> {
  const codebase: Record<string, string> = {};

  async function walkDir(dir: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;

      if (entry.isDirectory) {
        await walkDir(path);
      } else if (entry.isFile) {
        const hasValidExt = CONFIG.extensions.some((ext) =>
          entry.name.endsWith(ext)
        );
        if (!hasValidExt) continue;

        const isExcluded = CONFIG.excludePatterns.some((pattern) =>
          path.includes(pattern)
        );
        if (isExcluded) continue;

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
  }

  await walkDir(CONFIG.srcDir);
  return codebase;
}

async function ensureOutputDir(): Promise<void> {
  await Deno.mkdir(CONFIG.outputDir, { recursive: true });
}

function getApiKey(): string {
  const key = Deno.env.get("OPENAI_API_KEY");
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
      model: CONFIG.model,
    },
    systemPrompt: SYSTEM_PROMPT,
    verbose: true,
  });

  const result = await rlm.completion({
    query,
    context,
  });

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

// Commands
async function estimate(): Promise<void> {
  console.log("Estimating RLM cost...\n");

  const codebase = await loadCodebase();
  const totalChars = Object.values(codebase).reduce(
    (sum, c) => sum + c.length,
    0
  );

  // RLM is more token-efficient due to context-as-variable
  const estimatedQueries = Math.max(1, Math.floor(Object.keys(codebase).length / 50));
  const tokensPerQuery = 3000;
  const totalTokens = estimatedQueries * tokensPerQuery;

  // GPT-4o pricing (approximate)
  const inputCost = (totalTokens / 1_000_000) * 2.5;
  const outputCost = (totalTokens / 1_000_000) * 10;

  console.log(`Files: ${Object.keys(codebase).length}`);
  console.log(`Total size: ${totalChars.toLocaleString()} chars`);
  console.log(`Estimated recursive queries: ${estimatedQueries}`);
  console.log(`Estimated tokens: ${totalTokens.toLocaleString()}`);
  console.log(`\nEstimated cost (GPT-4o):`);
  console.log(`   ~$${(inputCost + outputCost).toFixed(2)}`);
  console.log(`\nNote: RLM is ~10-20x more token-efficient than sending full context`);
}

async function analyze(): Promise<void> {
  console.log("Phase 1: RLM Codebase Analysis");
  console.log("=".repeat(50));

  console.log("\nLoading codebase...");
  const codebase = await loadCodebase();
  console.log(`   Loaded ${Object.keys(codebase).length} files`);

  console.log("\nAnalyzing with RLM...");
  const result = await runRLM(ANALYZE_PROMPT, { codebase });

  await saveJsonFile("analysis.json", result);

  try {
    const analysis: AnalysisResult = JSON.parse(result);
    const summary = analysis.summary;

    console.log(`\nAnalysis complete: ${CONFIG.outputDir}/analysis.json`);
    console.log(`   Files analyzed: ${summary.total_files}`);
    console.log(`   Files with issues: ${summary.files_with_issues}`);
    console.log(`   High priority: ${summary.high_priority}`);
    console.log(`   Medium priority: ${summary.medium_priority}`);
    console.log(`   Low priority: ${summary.low_priority}`);
  } catch {
    console.log(`\nAnalysis complete (raw output): ${CONFIG.outputDir}/analysis.json`);
  }

  console.log(`\nNext: Run 'deno task optimize simplify'`);
}

async function simplify(): Promise<void> {
  console.log("Phase 2: RLM Simplification");
  console.log("=".repeat(50));

  console.log("\nLoading codebase...");
  const codebase = await loadCodebase();
  console.log(`   Loaded ${Object.keys(codebase).length} files`);

  const analysis = await loadJsonFile<AnalysisResult>("analysis.json");
  if (analysis) {
    console.log("   Loaded previous analysis");
  }

  console.log("\nSimplifying with RLM...");
  const context: Record<string, unknown> = { codebase };
  if (analysis) {
    context.analysis = analysis;
  }

  const result = await runRLM(SIMPLIFY_PROMPT, context);

  await saveJsonFile("simplifications.json", result);

  try {
    const simplifications: SimplificationResult = JSON.parse(result);
    const summary = simplifications.summary;

    console.log(`\nSimplification complete: ${CONFIG.outputDir}/simplifications.json`);
    console.log(`   Files changed: ${summary.files_changed}`);
    console.log(`   Files unchanged: ${summary.files_unchanged}`);
    console.log(`   Lines removed: ${summary.lines_removed}`);
  } catch {
    console.log(`\nSimplification complete (raw output): ${CONFIG.outputDir}/simplifications.json`);
  }

  console.log(`\nNext: Run 'deno task optimize apply'`);
}

async function apply(): Promise<void> {
  console.log("Phase 3: Apply Changes");
  console.log("=".repeat(50));

  const simplifications = await loadJsonFile<SimplificationResult>("simplifications.json");

  if (!simplifications) {
    console.error("Error: No simplifications found. Run 'simplify' first.");
    Deno.exit(1);
  }

  const changes = simplifications.changes;
  if (!changes || Object.keys(changes).length === 0) {
    console.log("No changes to apply.");
    return;
  }

  console.log(`\nApplying ${Object.keys(changes).length} changes...\n`);

  let applied = 0;
  let errors = 0;

  for (const [filePath, change] of Object.entries(changes)) {
    const content = change.content;
    if (!content) {
      console.log(`  ${filePath}: No content`);
      errors++;
      continue;
    }

    try {
      await Deno.writeTextFile(filePath, content);
      console.log(`  ${filePath}: ${change.changes_summary}`);
      applied++;
    } catch (e) {
      console.error(`  ${filePath}: ${e}`);
      errors++;
    }
  }

  console.log(`\nSummary:`);
  console.log(`   Applied: ${applied}`);
  console.log(`   Errors: ${errors}`);
  console.log(`\nRun 'git diff' to review changes`);
  console.log("Run 'deno task verify' to validate");
}

// Main
function printHelp(): void {
  console.log(`
RLM Codebase Optimizer

Commands:
    estimate   Estimate cost
    analyze    Analyze codebase for optimization opportunities
    simplify   Generate simplified versions with cross-file consistency
    apply      Apply changes to source files

Workflow:
    1. deno task optimize estimate
    2. deno task optimize analyze
    3. deno task optimize simplify
    4. deno task optimize apply
    5. git diff && deno task verify

Environment:
    OPENAI_API_KEY - Required
`);
}

async function main(): Promise<void> {
  const command = Deno.args[0];

  if (!command) {
    printHelp();
    return;
  }

  switch (command) {
    case "estimate":
      await estimate();
      break;
    case "analyze":
      await analyze();
      break;
    case "simplify":
      await simplify();
      break;
    case "apply":
      await apply();
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
