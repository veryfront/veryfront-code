#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

/**
 * RLM Code Explorer
 *
 * Uses RLM to answer questions about the codebase by iteratively exploring.
 * This is the perfect RLM use case: exploration where next step depends on
 * what you found in the previous step.
 *
 * Unlike batch processing (same operation on many files), this does
 * DEEP INVESTIGATION of a single question.
 *
 * Usage:
 *   deno task explore "How does rate limiting work?"
 *   deno task explore "Where is the routing configured?"
 *   deno task explore "What would break if I change RenderContext?"
 */

import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";
import { globToRegExp } from "https://deno.land/std@0.224.0/path/glob_to_regexp.ts";
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

interface ExplorationStep {
  iteration: number;
  thought: string;
  toolCalls: Array<{ call: ToolCall; result: ToolResult }>;
  observation: string;
}

interface ExplorationResult {
  success: boolean;
  question: string;
  answer?: string;
  steps: ExplorationStep[];
  filesExplored: string[];
  totalIterations: number;
  totalTimeMs: number;
  tokensUsed: { input: number; output: number };
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  model: "gpt-4o",
  maxIterations: 8, // Enough for most explorations
  maxFileContent: 10000, // chars per file read
  srcDir: "src",
  timeout: 120000, // 2 minutes
};

// =============================================================================
// TOOLS - Deterministic operations the LLM can call
// =============================================================================

const TOOLS: Tool[] = [
  {
    name: "find_files",
    description: "Find files matching a glob pattern. Returns list of file paths.",
    parameters: {
      pattern: { type: "string", description: "Glob pattern like '**/*.ts' or 'src/**/route*.ts'", required: true },
    },
  },
  {
    name: "read_file",
    description: "Read contents of a file. Returns file content with line numbers.",
    parameters: {
      path: { type: "string", description: "Path to file relative to project root", required: true },
      startLine: { type: "number", description: "Start line (1-indexed, optional)" },
      endLine: { type: "number", description: "End line (1-indexed, optional)" },
    },
  },
  {
    name: "search",
    description: "Search for text/regex pattern in files. Returns matching lines with context.",
    parameters: {
      pattern: { type: "string", description: "Regex pattern to search for", required: true },
      path: { type: "string", description: "Directory or file to search in (default: src/)" },
      maxResults: { type: "number", description: "Max results to return (default: 20)" },
    },
  },
  {
    name: "get_imports",
    description: "Get all imports from a TypeScript/JavaScript file.",
    parameters: {
      path: { type: "string", description: "Path to the file", required: true },
    },
  },
  {
    name: "get_usages",
    description: "Find all files that import/use a given file or export.",
    parameters: {
      path: { type: "string", description: "Path to the file to find usages of", required: true },
    },
  },
  {
    name: "get_exports",
    description: "Get all exports from a TypeScript/JavaScript file.",
    parameters: {
      path: { type: "string", description: "Path to the file", required: true },
    },
  },
  {
    name: "final_answer",
    description: "Provide the final answer when you have enough information.",
    parameters: {
      answer: { type: "string", description: "Complete answer to the user's question", required: true },
    },
  },
];

// =============================================================================
// TOOL IMPLEMENTATIONS
// =============================================================================

async function executeTool(call: ToolCall): Promise<ToolResult> {
  try {
    switch (call.name) {
      case "find_files":
        return await findFiles(call.args.pattern as string);
      case "read_file":
        return await readFile(
          call.args.path as string,
          call.args.startLine as number | undefined,
          call.args.endLine as number | undefined
        );
      case "search":
        return await searchFiles(
          call.args.pattern as string,
          call.args.path as string | undefined,
          call.args.maxResults as number | undefined
        );
      case "get_imports":
        return await getImports(call.args.path as string);
      case "get_usages":
        return await getUsages(call.args.path as string);
      case "get_exports":
        return await getExports(call.args.path as string);
      case "final_answer":
        return { success: true, data: { answer: call.args.answer } };
      default:
        return { success: false, error: `Unknown tool: ${call.name}` };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function findFiles(pattern: string): Promise<ToolResult> {
  const files: string[] = [];
  const regex = globToRegExp(pattern, { extended: true, globstar: true });

  for await (const entry of walk(CONFIG.srcDir, { includeDirs: false })) {
    if (regex.test(entry.path)) {
      files.push(entry.path);
    }
  }

  // Also check root-level files
  for await (const entry of Deno.readDir(".")) {
    if (entry.isFile && regex.test(entry.name)) {
      files.push(entry.name);
    }
  }

  return {
    success: true,
    data: {
      count: files.length,
      files: files.slice(0, 50), // Limit to 50 results
      truncated: files.length > 50,
    },
  };
}

async function readFile(
  path: string,
  startLine?: number,
  endLine?: number
): Promise<ToolResult> {
  try {
    const content = await Deno.readTextFile(path);
    const lines = content.split("\n");

    const start = (startLine ?? 1) - 1;
    const end = endLine ?? lines.length;
    const selectedLines = lines.slice(start, end);

    // Truncate if too large
    let output = selectedLines
      .map((line, i) => `${start + i + 1}: ${line}`)
      .join("\n");

    if (output.length > CONFIG.maxFileContent) {
      output = output.slice(0, CONFIG.maxFileContent) + "\n... (truncated)";
    }

    return {
      success: true,
      data: {
        path,
        totalLines: lines.length,
        readLines: { start: start + 1, end: Math.min(end, lines.length) },
        content: output,
      },
    };
  } catch (error) {
    return { success: false, error: `Failed to read ${path}: ${error}` };
  }
}

async function searchFiles(
  pattern: string,
  searchPath?: string,
  maxResults = 20
): Promise<ToolResult> {
  const results: Array<{ file: string; line: number; content: string }> = [];
  const regex = new RegExp(pattern, "gi");
  const dir = searchPath ?? CONFIG.srcDir;

  try {
    for await (const entry of walk(dir, {
      includeDirs: false,
      exts: ["ts", "tsx", "js", "jsx"],
    })) {
      if (results.length >= maxResults) break;

      const content = await Deno.readTextFile(entry.path);
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (results.length >= maxResults) break;
        if (regex.test(lines[i])) {
          results.push({
            file: entry.path,
            line: i + 1,
            content: lines[i].trim().slice(0, 200),
          });
        }
        regex.lastIndex = 0; // Reset regex
      }
    }

    return {
      success: true,
      data: {
        pattern,
        count: results.length,
        results,
        truncated: results.length >= maxResults,
      },
    };
  } catch (error) {
    return { success: false, error: `Search failed: ${error}` };
  }
}

async function getImports(path: string): Promise<ToolResult> {
  try {
    const content = await Deno.readTextFile(path);
    const imports: Array<{ module: string; imports: string[] }> = [];

    // Match import statements
    const importRegex = /import\s+(?:{([^}]+)}|(\w+))\s+from\s+["']([^"']+)["']/g;
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      const namedImports = match[1]
        ? match[1].split(",").map((s) => s.trim().split(" as ")[0].trim())
        : [];
      const defaultImport = match[2];
      const module = match[3];

      imports.push({
        module,
        imports: defaultImport ? [defaultImport, ...namedImports] : namedImports,
      });
    }

    return { success: true, data: { path, imports } };
  } catch (error) {
    return { success: false, error: `Failed to analyze imports: ${error}` };
  }
}

async function getUsages(targetPath: string): Promise<ToolResult> {
  const usages: Array<{ file: string; importLine: string }> = [];

  // Normalize path for matching
  const normalizedTarget = targetPath.replace(/^\.\//, "").replace(/\.(ts|tsx|js|jsx)$/, "");

  for await (const entry of walk(CONFIG.srcDir, {
    includeDirs: false,
    exts: ["ts", "tsx", "js", "jsx"],
  })) {
    if (entry.path === targetPath) continue;

    const content = await Deno.readTextFile(entry.path);
    const lines = content.split("\n");

    for (const line of lines) {
      if (line.includes("import") && line.includes(normalizedTarget)) {
        usages.push({ file: entry.path, importLine: line.trim() });
        break;
      }
    }
  }

  return {
    success: true,
    data: { targetPath, usageCount: usages.length, usages: usages.slice(0, 30) },
  };
}

async function getExports(path: string): Promise<ToolResult> {
  try {
    const content = await Deno.readTextFile(path);
    const exports: string[] = [];

    // Named exports
    const namedExportRegex = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
    let match;
    while ((match = namedExportRegex.exec(content)) !== null) {
      exports.push(match[1]);
    }

    // Export default
    if (/export\s+default/.test(content)) {
      exports.push("default");
    }

    // Re-exports
    const reExportRegex = /export\s+\{([^}]+)\}\s+from/g;
    while ((match = reExportRegex.exec(content)) !== null) {
      const reExports = match[1].split(",").map((s) => s.trim().split(" as ")[0].trim());
      exports.push(...reExports);
    }

    return { success: true, data: { path, exports } };
  } catch (error) {
    return { success: false, error: `Failed to analyze exports: ${error}` };
  }
}

// =============================================================================
// LLM INTERACTION
// =============================================================================

function buildSystemPrompt(): string {
  const toolDescriptions = TOOLS.map((t) => {
    const params = Object.entries(t.parameters)
      .map(([name, info]) => `    ${name}: ${info.type}${info.required ? " (required)" : ""} - ${info.description}`)
      .join("\n");
    return `- ${t.name}: ${t.description}\n  Parameters:\n${params}`;
  }).join("\n\n");

  return `You are a code exploration expert. Answer questions about a codebase by systematically exploring it.

AVAILABLE TOOLS:
${toolDescriptions}

CRITICAL: You MUST call final_answer once you have enough information to answer the question.
Do not continue exploring indefinitely - 3-5 steps should usually be enough.

PROCESS:
1. Search for relevant files
2. Read key files to understand the implementation
3. Call final_answer with a complete answer

OUTPUT FORMAT (strict JSON):
{
  "thought": "Brief reasoning about what to do next",
  "tool_calls": [
    { "name": "tool_name", "args": { "param": "value" } }
  ]
}

ALWAYS include at least one tool_call. If you have the answer, call final_answer.`;
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
// MAIN EXPLORATION LOOP
// =============================================================================

async function explore(question: string): Promise<ExplorationResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.error("Error: OPENAI_API_KEY not set");
    Deno.exit(1);
  }

  const startTime = performance.now();
  const steps: ExplorationStep[] = [];
  const filesExplored = new Set<string>();
  let totalTokens = { input: 0, output: 0 };

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: `Question: ${question}` },
  ];

  console.log(`\n🔍 Exploring: "${question}"\n`);
  console.log("─".repeat(60));

  for (let i = 0; i < CONFIG.maxIterations; i++) {
    console.log(`\n📍 Step ${i + 1}`);

    // Call LLM
    const llmResponse = await callLLM(messages, apiKey);
    totalTokens.input += llmResponse.tokens.input;
    totalTokens.output += llmResponse.tokens.output;

    // Parse response
    let parsed: { thought: string; tool_calls: ToolCall[] };
    try {
      parsed = JSON.parse(llmResponse.content);
    } catch {
      console.error("   ❌ Failed to parse LLM response");
      messages.push(
        { role: "assistant", content: llmResponse.content },
        { role: "user", content: "Your response was not valid JSON. Respond with: {\"thought\": \"...\", \"tool_calls\": [{\"name\": \"...\", \"args\": {...}}]}" }
      );
      continue;
    }

    console.log(`   💭 ${parsed.thought ?? "(no thought)"}`);

    // If no tool calls, prompt to call final_answer
    if (!parsed.tool_calls || parsed.tool_calls.length === 0) {
      console.log("   ⚠️  No tool calls - prompting for final_answer");
      messages.push(
        { role: "assistant", content: llmResponse.content },
        { role: "user", content: "You must call at least one tool. If you have the answer, call final_answer with your complete answer." }
      );
      continue;
    }

    // Execute tools
    const toolResults: Array<{ call: ToolCall; result: ToolResult }> = [];

    for (const call of parsed.tool_calls ?? []) {
      console.log(`   🔧 ${call.name}(${JSON.stringify(call.args)})`);

      const result = await executeTool(call);
      toolResults.push({ call, result });

      // Track files explored
      if (call.name === "read_file" && result.success) {
        filesExplored.add(call.args.path as string);
      }

      // Check for final answer
      if (call.name === "final_answer" && result.success) {
        const answer = (result.data as { answer: string }).answer;

        steps.push({
          iteration: i + 1,
          thought: parsed.thought,
          toolCalls: toolResults,
          observation: "Final answer provided",
        });

        console.log("\n" + "─".repeat(60));
        console.log("\n✅ ANSWER:\n");
        console.log(answer);

        return {
          success: true,
          question,
          answer,
          steps,
          filesExplored: Array.from(filesExplored),
          totalIterations: i + 1,
          totalTimeMs: performance.now() - startTime,
          tokensUsed: totalTokens,
        };
      }
    }

    // Build observation from tool results
    const observation = toolResults
      .map((tr) =>
        tr.result.success
          ? `${tr.call.name} result: ${JSON.stringify(tr.result.data, null, 2).slice(0, 2000)}`
          : `${tr.call.name} error: ${tr.result.error}`
      )
      .join("\n\n");

    steps.push({
      iteration: i + 1,
      thought: parsed.thought,
      toolCalls: toolResults,
      observation,
    });

    // Add to conversation
    messages.push(
      { role: "assistant", content: llmResponse.content },
      { role: "user", content: `Tool results:\n\n${observation}\n\nIf you now have enough information to answer the question, call final_answer immediately. Otherwise, continue exploring.` }
    );
  }

  // Max iterations reached
  console.log("\n⚠️  Max iterations reached");

  return {
    success: false,
    question,
    steps,
    filesExplored: Array.from(filesExplored),
    totalIterations: CONFIG.maxIterations,
    totalTimeMs: performance.now() - startTime,
    tokensUsed: totalTokens,
  };
}

// =============================================================================
// CLI
// =============================================================================

async function main(): Promise<void> {
  const question = Deno.args.join(" ");

  if (!question) {
    console.log(`
RLM Code Explorer - Answer questions about the codebase

Usage:
  deno task explore "Your question here"

Examples:
  deno task explore "How does rate limiting work?"
  deno task explore "Where is routing configured?"
  deno task explore "What files use RenderContext?"
  deno task explore "How does authentication flow work?"
  deno task explore "What would break if I change the Config type?"

The explorer will iteratively search, read files, and trace imports
until it can answer your question.
`);
    return;
  }

  const result = await explore(question);

  console.log("\n" + "═".repeat(60));
  console.log("\n📊 Exploration Summary:");
  console.log(`   Iterations: ${result.totalIterations}`);
  console.log(`   Files explored: ${result.filesExplored.length}`);
  console.log(`   Time: ${(result.totalTimeMs / 1000).toFixed(1)}s`);
  console.log(`   Tokens: ${result.tokensUsed.input + result.tokensUsed.output}`);

  if (!result.success) {
    console.log("\n⚠️  Exploration incomplete - consider asking a more specific question");
  }
}

main();
