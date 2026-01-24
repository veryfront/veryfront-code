#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

/**
 * RLM Code Audit
 *
 * Uses RLM to discover inconsistencies in the codebase.
 * Outputs a report that can inform batch fixes.
 *
 * This is a good RLM use case because:
 * - You don't know upfront what inconsistencies exist
 * - Need to explore and compare patterns across files
 * - Discovery requires iterative sampling and analysis
 *
 * Usage:
 *   deno task rlm:audit              # Full audit
 *   deno task rlm:audit --focus naming   # Focus on naming
 *   deno task rlm:audit --focus imports  # Focus on imports
 */

import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/ensure_dir.ts";
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

await load({ export: true, examplePath: null });

// =============================================================================
// TYPES
// =============================================================================

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

interface Inconsistency {
  category: string;
  description: string;
  dominant: string;
  violations: Array<{ file: string; line?: number; found: string }>;
  suggestion: string;
}

interface AuditResult {
  success: boolean;
  inconsistencies: Inconsistency[];
  filesAnalyzed: number;
  totalTimeMs: number;
  tokensUsed: { input: number; output: number };
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  model: "gpt-4o",
  maxIterations: 12,
  srcDir: "src",
  outputDir: "scripts/rlm-ts/output",
  outputFile: "scripts/rlm-ts/output/audit-report.md",
  sampleSize: 20, // Files to sample per pattern search
};

// =============================================================================
// AUDIT-SPECIFIC TOOLS
// =============================================================================

const TOOLS: Tool[] = [
  {
    name: "sample_files",
    description: "Get a random sample of TypeScript files to analyze patterns.",
    parameters: {
      count: { type: "number", description: "Number of files to sample (default: 20)" },
      pattern: { type: "string", description: "Optional glob pattern to filter files" },
    },
  },
  {
    name: "search_pattern",
    description: "Search for a regex pattern and count occurrences by file.",
    parameters: {
      pattern: { type: "string", description: "Regex pattern to search for", required: true },
      description: { type: "string", description: "What this pattern represents", required: true },
    },
  },
  {
    name: "compare_patterns",
    description: "Compare two patterns to find which is dominant.",
    parameters: {
      pattern1: { type: "string", description: "First pattern (regex)", required: true },
      pattern1Name: { type: "string", description: "Name for first pattern", required: true },
      pattern2: { type: "string", description: "Second pattern (regex)", required: true },
      pattern2Name: { type: "string", description: "Name for second pattern", required: true },
    },
  },
  {
    name: "read_file",
    description: "Read a specific file to understand context.",
    parameters: {
      path: { type: "string", description: "Path to file", required: true },
    },
  },
  {
    name: "report_inconsistency",
    description: "Report a discovered inconsistency.",
    parameters: {
      category: { type: "string", description: "Category (naming, imports, errors, types, etc.)", required: true },
      description: { type: "string", description: "What the inconsistency is", required: true },
      dominant: { type: "string", description: "The dominant/preferred pattern", required: true },
      violationPattern: { type: "string", description: "Regex to find violations", required: true },
      suggestion: { type: "string", description: "How to fix it", required: true },
    },
  },
  {
    name: "finish_audit",
    description: "Complete the audit and generate the report.",
    parameters: {
      summary: { type: "string", description: "Brief summary of findings", required: true },
    },
  },
];

// =============================================================================
// TOOL IMPLEMENTATIONS
// =============================================================================

const discoveredInconsistencies: Inconsistency[] = [];

async function executeTool(call: ToolCall): Promise<ToolResult> {
  try {
    switch (call.name) {
      case "sample_files":
        return await sampleFiles(
          call.args.count as number | undefined,
          call.args.pattern as string | undefined
        );
      case "search_pattern":
        return await searchPattern(
          call.args.pattern as string,
          call.args.description as string
        );
      case "compare_patterns":
        return await comparePatterns(
          call.args.pattern1 as string,
          call.args.pattern1Name as string,
          call.args.pattern2 as string,
          call.args.pattern2Name as string
        );
      case "read_file":
        return await readFile(call.args.path as string);
      case "report_inconsistency":
        return await reportInconsistency(
          call.args.category as string,
          call.args.description as string,
          call.args.dominant as string,
          call.args.violationPattern as string,
          call.args.suggestion as string
        );
      case "finish_audit":
        return { success: true, data: { finished: true, summary: call.args.summary } };
      default:
        return { success: false, error: `Unknown tool: ${call.name}` };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function sampleFiles(count = 20, pattern?: string): Promise<ToolResult> {
  const files: string[] = [];

  for await (const entry of walk(CONFIG.srcDir, {
    includeDirs: false,
    exts: ["ts", "tsx"],
  })) {
    // Skip test files for pattern analysis
    if (entry.path.includes(".test.") || entry.path.includes("__tests__")) continue;
    if (pattern && !entry.path.includes(pattern)) continue;
    files.push(entry.path);
  }

  // Random sample
  const shuffled = files.sort(() => Math.random() - 0.5);
  const sampled = shuffled.slice(0, count);

  return {
    success: true,
    data: {
      totalFiles: files.length,
      sampledCount: sampled.length,
      files: sampled,
    },
  };
}

async function searchPattern(pattern: string, description: string): Promise<ToolResult> {
  const results: Array<{ file: string; count: number; examples: string[] }> = [];
  const regex = new RegExp(pattern, "g");
  let totalMatches = 0;

  for await (const entry of walk(CONFIG.srcDir, {
    includeDirs: false,
    exts: ["ts", "tsx"],
  })) {
    if (entry.path.includes(".test.") || entry.path.includes("__tests__")) continue;

    const content = await Deno.readTextFile(entry.path);
    const matches = content.match(regex);

    if (matches && matches.length > 0) {
      totalMatches += matches.length;
      results.push({
        file: entry.path,
        count: matches.length,
        examples: [...new Set(matches)].slice(0, 3),
      });
    }
  }

  return {
    success: true,
    data: {
      pattern,
      description,
      totalMatches,
      filesWithMatches: results.length,
      topFiles: results.sort((a, b) => b.count - a.count).slice(0, 10),
    },
  };
}

async function comparePatterns(
  pattern1: string,
  pattern1Name: string,
  pattern2: string,
  pattern2Name: string
): Promise<ToolResult> {
  const regex1 = new RegExp(pattern1, "g");
  const regex2 = new RegExp(pattern2, "g");

  let count1 = 0;
  let count2 = 0;
  const files1: string[] = [];
  const files2: string[] = [];

  for await (const entry of walk(CONFIG.srcDir, {
    includeDirs: false,
    exts: ["ts", "tsx"],
  })) {
    if (entry.path.includes(".test.") || entry.path.includes("__tests__")) continue;

    const content = await Deno.readTextFile(entry.path);
    const matches1 = content.match(regex1);
    const matches2 = content.match(regex2);

    if (matches1) {
      count1 += matches1.length;
      files1.push(entry.path);
    }
    if (matches2) {
      count2 += matches2.length;
      files2.push(entry.path);
    }
  }

  const total = count1 + count2;
  const dominant = count1 >= count2 ? pattern1Name : pattern2Name;
  const minority = count1 < count2 ? pattern1Name : pattern2Name;

  return {
    success: true,
    data: {
      [pattern1Name]: { count: count1, percentage: total > 0 ? Math.round((count1 / total) * 100) : 0, fileCount: files1.length },
      [pattern2Name]: { count: count2, percentage: total > 0 ? Math.round((count2 / total) * 100) : 0, fileCount: files2.length },
      dominant,
      minority,
      minorityFiles: (count1 < count2 ? files1 : files2).slice(0, 15),
    },
  };
}

async function readFile(path: string): Promise<ToolResult> {
  try {
    const content = await Deno.readTextFile(path);
    const lines = content.split("\n");
    const preview = lines.slice(0, 50).map((l, i) => `${i + 1}: ${l}`).join("\n");

    return {
      success: true,
      data: {
        path,
        totalLines: lines.length,
        preview: preview.length > 3000 ? preview.slice(0, 3000) + "\n..." : preview,
      },
    };
  } catch (error) {
    return { success: false, error: `Failed to read ${path}: ${error}` };
  }
}

async function reportInconsistency(
  category: string,
  description: string,
  dominant: string,
  violationPattern: string,
  suggestion: string
): Promise<ToolResult> {
  // Find all violations
  const violations: Array<{ file: string; line?: number; found: string }> = [];
  const regex = new RegExp(violationPattern, "g");

  for await (const entry of walk(CONFIG.srcDir, {
    includeDirs: false,
    exts: ["ts", "tsx"],
  })) {
    if (entry.path.includes(".test.") || entry.path.includes("__tests__")) continue;

    const content = await Deno.readTextFile(entry.path);
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const matches = lines[i].match(regex);
      if (matches) {
        for (const match of matches) {
          violations.push({ file: entry.path, line: i + 1, found: match });
        }
      }
    }
  }

  const inconsistency: Inconsistency = {
    category,
    description,
    dominant,
    violations: violations.slice(0, 50), // Limit for report
    suggestion,
  };

  discoveredInconsistencies.push(inconsistency);

  return {
    success: true,
    data: {
      recorded: true,
      category,
      totalViolations: violations.length,
      filesAffected: new Set(violations.map((v) => v.file)).size,
    },
  };
}

// =============================================================================
// LLM INTERACTION
// =============================================================================

function buildSystemPrompt(focus?: string): string {
  const toolDescriptions = TOOLS.map((t) => {
    const params = Object.entries(t.parameters)
      .map(([name, info]) => `    ${name}: ${info.type}${info.required ? " (required)" : ""} - ${info.description}`)
      .join("\n");
    return `- ${t.name}: ${t.description}\n  Parameters:\n${params}`;
  }).join("\n\n");

  const focusInstruction = focus
    ? `\nFOCUS AREA: Only look for inconsistencies related to "${focus}".`
    : "";

  return `You are a code consistency auditor. Your job is to discover inconsistencies in a TypeScript codebase.

AVAILABLE TOOLS:
${toolDescriptions}

AUDIT AREAS TO CHECK:
1. **Naming**: Variable names (err vs error, req vs request, res vs response, ctx vs context)
2. **Imports**: Relative vs absolute, with/without extensions, ordering
3. **Error handling**: catch(err) vs catch(error), rethrow patterns
4. **Types**: explicit any vs unknown, type assertions
5. **Logging**: console.log vs logger, log levels
6. **Exports**: named vs default, barrel files
${focusInstruction}

PROCESS:
1. Use compare_patterns to check for competing patterns
2. When you find an inconsistency (minority pattern exists), use report_inconsistency
3. Check 3-5 different areas
4. Call finish_audit when done

RULES:
- Only report REAL inconsistencies (where multiple patterns exist)
- The dominant pattern is the "correct" one
- Violations are files using the minority pattern
- Be specific with regex patterns so batch can use them

OUTPUT FORMAT (strict JSON):
{
  "thought": "What I'm checking next",
  "tool_calls": [{ "name": "...", "args": {...} }]
}`;
}

async function callLLM(
  messages: Array<{ role: string; content: string }>,
  apiKey: string
): Promise<{ content: string; tokens: { input: number; output: number } }> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CONFIG.model,
      messages,
      temperature: 0,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LLM call failed: ${error}`);
  }

  const result = await response.json();
  return {
    content: result.choices[0].message.content,
    tokens: {
      input: result.usage.prompt_tokens,
      output: result.usage.completion_tokens,
    },
  };
}

// =============================================================================
// REPORT GENERATION
// =============================================================================

function generateReport(inconsistencies: Inconsistency[], summary: string): string {
  const lines: string[] = [
    "# Code Audit Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    summary,
    "",
    `**Total inconsistencies found: ${inconsistencies.length}**`,
    "",
  ];

  if (inconsistencies.length === 0) {
    lines.push("No significant inconsistencies found. The codebase is consistent.");
    return lines.join("\n");
  }

  // Group by category
  const byCategory = new Map<string, Inconsistency[]>();
  for (const inc of inconsistencies) {
    const list = byCategory.get(inc.category) || [];
    list.push(inc);
    byCategory.set(inc.category, list);
  }

  for (const [category, items] of byCategory) {
    lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    lines.push("");

    for (const item of items) {
      lines.push(`### ${item.description}`);
      lines.push("");
      lines.push(`- **Dominant pattern**: ${item.dominant}`);
      lines.push(`- **Violations**: ${item.violations.length} instances`);
      lines.push(`- **Fix**: ${item.suggestion}`);
      lines.push("");

      if (item.violations.length > 0) {
        lines.push("**Files to fix:**");
        lines.push("```");
        const uniqueFiles = [...new Set(item.violations.map((v) => v.file))];
        for (const file of uniqueFiles.slice(0, 20)) {
          lines.push(file);
        }
        if (uniqueFiles.length > 20) {
          lines.push(`... and ${uniqueFiles.length - 20} more files`);
        }
        lines.push("```");
        lines.push("");
      }
    }
  }

  lines.push("## Next Steps");
  lines.push("");
  lines.push("Use batch processing to fix these inconsistencies:");
  lines.push("```bash");
  lines.push("deno task batch:prepare  # Will use this report to generate fixes");
  lines.push("deno task batch:submit");
  lines.push("```");

  return lines.join("\n");
}

// =============================================================================
// MAIN AUDIT LOOP
// =============================================================================

async function audit(focus?: string): Promise<AuditResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.error("Error: OPENAI_API_KEY not set");
    Deno.exit(1);
  }

  const startTime = performance.now();
  let totalTokens = { input: 0, output: 0 };

  // Clear previous discoveries
  discoveredInconsistencies.length = 0;

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: buildSystemPrompt(focus) },
    { role: "user", content: "Start the audit. Check for inconsistencies in naming, imports, error handling, and types." },
  ];

  console.log("\n🔍 Starting code audit...\n");
  console.log("─".repeat(60));

  for (let i = 0; i < CONFIG.maxIterations; i++) {
    console.log(`\n📍 Step ${i + 1}`);

    const llmResponse = await callLLM(messages, apiKey);
    totalTokens.input += llmResponse.tokens.input;
    totalTokens.output += llmResponse.tokens.output;

    let parsed: { thought: string; tool_calls: ToolCall[] };
    try {
      parsed = JSON.parse(llmResponse.content);
    } catch {
      console.error("   ❌ Failed to parse response");
      messages.push(
        { role: "assistant", content: llmResponse.content },
        { role: "user", content: "Respond with valid JSON: {\"thought\": \"...\", \"tool_calls\": [...]}" }
      );
      continue;
    }

    console.log(`   💭 ${parsed.thought ?? "(no thought)"}`);

    if (!parsed.tool_calls || parsed.tool_calls.length === 0) {
      messages.push(
        { role: "assistant", content: llmResponse.content },
        { role: "user", content: "Call a tool. Use compare_patterns to check for inconsistencies, or finish_audit if done." }
      );
      continue;
    }

    const toolResults: Array<{ call: ToolCall; result: ToolResult }> = [];

    for (const call of parsed.tool_calls) {
      console.log(`   🔧 ${call.name}(${JSON.stringify(call.args).slice(0, 80)}...)`);

      const result = await executeTool(call);
      toolResults.push({ call, result });

      if (call.name === "report_inconsistency" && result.success) {
        const data = result.data as { totalViolations: number; filesAffected: number };
        console.log(`   📋 Found ${data.totalViolations} violations in ${data.filesAffected} files`);
      }

      if (call.name === "finish_audit" && result.success) {
        const data = result.data as { summary: string };

        // Generate report
        await ensureDir(CONFIG.outputDir);
        const report = generateReport(discoveredInconsistencies, data.summary);
        await Deno.writeTextFile(CONFIG.outputFile, report);

        console.log("\n" + "─".repeat(60));
        console.log("\n✅ Audit complete!");
        console.log(`\n📄 Report saved to: ${CONFIG.outputFile}`);

        // Count files
        let fileCount = 0;
        for await (const _ of walk(CONFIG.srcDir, { includeDirs: false, exts: ["ts", "tsx"] })) {
          fileCount++;
        }

        return {
          success: true,
          inconsistencies: discoveredInconsistencies,
          filesAnalyzed: fileCount,
          totalTimeMs: performance.now() - startTime,
          tokensUsed: totalTokens,
        };
      }
    }

    const observation = toolResults
      .map((tr) =>
        tr.result.success
          ? `${tr.call.name}: ${JSON.stringify(tr.result.data, null, 2).slice(0, 1500)}`
          : `${tr.call.name} error: ${tr.result.error}`
      )
      .join("\n\n");

    messages.push(
      { role: "assistant", content: llmResponse.content },
      { role: "user", content: `Results:\n${observation}\n\nContinue checking other areas, or call finish_audit if you've checked enough.` }
    );
  }

  console.log("\n⚠️  Max iterations reached");
  return {
    success: false,
    inconsistencies: discoveredInconsistencies,
    filesAnalyzed: 0,
    totalTimeMs: performance.now() - startTime,
    tokensUsed: totalTokens,
  };
}

// =============================================================================
// CLI
// =============================================================================

async function main(): Promise<void> {
  const args = Deno.args;
  let focus: string | undefined;

  const focusIndex = args.indexOf("--focus");
  if (focusIndex !== -1 && args[focusIndex + 1]) {
    focus = args[focusIndex + 1];
  }

  if (args.includes("--help")) {
    console.log(`
RLM Code Audit - Discover inconsistencies in your codebase

Usage:
  deno task rlm:audit              # Full audit
  deno task rlm:audit --focus naming   # Focus on naming conventions
  deno task rlm:audit --focus imports  # Focus on import patterns
  deno task rlm:audit --focus errors   # Focus on error handling

The audit will:
1. Explore the codebase to find competing patterns
2. Identify which pattern is dominant
3. Report violations (files using minority patterns)
4. Output a report to ${CONFIG.outputFile}

Then use batch processing to fix the inconsistencies.
`);
    return;
  }

  const result = await audit(focus);

  console.log("\n" + "═".repeat(60));
  console.log("\n📊 Audit Summary:");
  console.log(`   Inconsistencies found: ${result.inconsistencies.length}`);
  console.log(`   Time: ${(result.totalTimeMs / 1000).toFixed(1)}s`);
  console.log(`   Tokens: ${result.tokensUsed.input + result.tokensUsed.output}`);

  if (result.inconsistencies.length > 0) {
    console.log("\n📋 Categories:");
    const categories = new Set(result.inconsistencies.map((i) => i.category));
    for (const cat of categories) {
      const count = result.inconsistencies.filter((i) => i.category === cat).length;
      console.log(`   - ${cat}: ${count} issue(s)`);
    }
  }
}

main();
