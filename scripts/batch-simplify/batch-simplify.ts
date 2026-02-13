#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

/**
 * OpenAI Batch API Code Simplifier
 *
 * Uses OpenAI's Batch API for 50% cost reduction on large-scale code review.
 * Processes all TypeScript files in src/ and tests/ for simplification.
 *
 * Usage:
 *   deno task batch:prepare    # Create JSONL batch file
 *   deno task batch:submit     # Submit batch to OpenAI
 *   deno task batch:status     # Check batch status
 *   deno task batch:download   # Download results
 *   deno task batch:apply      # Apply fixes to files
 */

import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/ensure_dir.ts";
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

// Load .env file (don't validate against .env.example)
await load({ export: true, examplePath: null });

// Configuration
const CONFIG = {
  model: "gpt-5.2", // SOTA coding model (Jan 2025)
  dirs: ["src", "tests"],
  outputDir: "scripts/batch-simplify/output",
  batchFile: "scripts/batch-simplify/output/batch-requests.jsonl",
  resultsFile: "scripts/batch-simplify/output/batch-results.jsonl",
  stateFile: "scripts/batch-simplify/output/batch-state.json",
  maxTokens: 16384, // Increased for larger files
  extensions: [".ts", ".tsx"],
  excludePatterns: [] as string[], // Include all files
  minFileSize: 0, // No minimum
  maxFileSize: 100_000, // 100k chars (~25k tokens) - OpenAI limit safety
};

// Optimized system prompt - concise for token efficiency
const SYSTEM_PROMPT = `You are a code simplification expert. Analyze TypeScript/React code and return ONLY the simplified version.

RULES:
1. PRESERVE all functionality exactly - never change behavior
2. Apply these simplifications:
   - Remove dead code, unused imports, redundant type assertions
   - Flatten unnecessary nesting (early returns over nested if/else)
   - Consolidate duplicate logic
   - Simplify complex conditionals (NO nested ternaries - use if/else or switch)
   - Remove obvious comments, keep meaningful ones
   - Use modern TS patterns (optional chaining, nullish coalescing)
   - Prefer explicit over clever (clarity > brevity)

3. KEEP unchanged if code is already clean
4. Use ES modules, function keyword for top-level, explicit return types

CRITICAL - IMPORTS:
- ONLY relative imports (./ or ../) need file extensions
- Example: import { foo } from "./bar.ts"  ✓
- WRONG:  import { foo } from "./bar"      ✗
- npm packages and import map aliases do NOT need extensions
- NEVER remove or change existing file extensions

OUTPUT: Return ONLY the complete simplified code. No explanations, no markdown fences.
If no changes needed, return the exact input unchanged.`;

interface BatchRequest {
  custom_id: string;
  method: "POST";
  url: "/v1/chat/completions";
  body: {
    model: string;
    messages: Array<{ role: "system" | "user"; content: string }>;
    max_completion_tokens: number;
    temperature: number;
  };
}

interface BatchState {
  batchId?: string;
  fileCount: number;
  createdAt: string;
  status?: string;
}

async function getApiKey(): Promise<string> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) {
    console.error("Error: OPENAI_API_KEY environment variable not set");
    Deno.exit(1);
  }
  return key;
}

function shouldExclude(path: string): boolean {
  return CONFIG.excludePatterns.some((pattern) => {
    if (pattern.startsWith("*.")) {
      return path.endsWith(pattern.slice(1));
    }
    return path.includes(pattern);
  });
}

async function collectFiles(): Promise<string[]> {
  const files: string[] = [];

  for (const dir of CONFIG.dirs) {
    for await (const entry of walk(dir, {
      exts: CONFIG.extensions.map((e) => e.slice(1)),
      includeDirs: false,
    })) {
      if (!shouldExclude(entry.path)) {
        files.push(entry.path);
      }
    }
  }

  return files.sort();
}

function createBatchRequest(filePath: string, content: string): BatchRequest {
  const customId = encodeURIComponent(filePath);

  return {
    custom_id: customId,
    method: "POST",
    url: "/v1/chat/completions",
    body: {
      model: CONFIG.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `File: ${filePath}\n\n${content}`,
        },
      ],
      max_completion_tokens: CONFIG.maxTokens,
      temperature: 0,
    },
  };
}

async function prepare(): Promise<void> {
  // Check if there's an active batch
  try {
    const existingState: BatchState = JSON.parse(await Deno.readTextFile(CONFIG.stateFile));
    if (existingState.batchId && existingState.status !== "completed" && existingState.status !== "failed") {
      console.error(`❌ Active batch exists: ${existingState.batchId} (status: ${existingState.status})`);
      console.error(`   Run 'deno task batch:status' to check progress, or delete ${CONFIG.stateFile} to start fresh.`);
      Deno.exit(1);
    }
  } catch {
    // No state file exists, continue
  }

  console.log("📁 Collecting TypeScript files...");

  const files = await collectFiles();
  console.log(`Found ${files.length} files to process`);

  await ensureDir(CONFIG.outputDir);

  const batchLines: string[] = [];
  let skipped = 0;

  for (const filePath of files) {
    const content = await Deno.readTextFile(filePath);

    // Skip files outside size bounds
    if (content.length < CONFIG.minFileSize) {
      skipped++;
      continue;
    }

    if (content.length > CONFIG.maxFileSize) {
      console.log(`⚠️  Skipping large file: ${filePath} (${content.length} chars)`);
      skipped++;
      continue;
    }

    const request = createBatchRequest(filePath, content);
    batchLines.push(JSON.stringify(request));
  }

  await Deno.writeTextFile(CONFIG.batchFile, batchLines.join("\n"));

  const state: BatchState = {
    fileCount: batchLines.length,
    createdAt: new Date().toISOString(),
  };
  await Deno.writeTextFile(CONFIG.stateFile, JSON.stringify(state, null, 2));

  console.log(`\n✅ Created batch file: ${CONFIG.batchFile}`);
  console.log(`   Files to process: ${batchLines.length}`);
  console.log(`   Files skipped: ${skipped}`);
  console.log(`\nNext: Run 'deno task batch:submit' to submit the batch`);
}

async function submit(): Promise<void> {
  const apiKey = await getApiKey();

  console.log("📤 Uploading batch file...");

  // Upload the JSONL file
  const fileContent = await Deno.readFile(CONFIG.batchFile);
  const formData = new FormData();
  formData.append("file", new Blob([fileContent]), "batch-requests.jsonl");
  formData.append("purpose", "batch");

  const uploadResponse = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!uploadResponse.ok) {
    const error = await uploadResponse.text();
    console.error("Upload failed:", error);
    Deno.exit(1);
  }

  const uploadResult = await uploadResponse.json();
  console.log(`✅ File uploaded: ${uploadResult.id}`);

  // Create the batch
  console.log("🚀 Creating batch...");

  const batchResponse = await fetch("https://api.openai.com/v1/batches", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input_file_id: uploadResult.id,
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
      metadata: {
        project: "veryfront-server",
        task: "code-simplification",
      },
    }),
  });

  if (!batchResponse.ok) {
    const error = await batchResponse.text();
    console.error("Batch creation failed:", error);
    Deno.exit(1);
  }

  const batchResult = await batchResponse.json();
  console.log(`✅ Batch created: ${batchResult.id}`);

  // Save state
  const state: BatchState = {
    batchId: batchResult.id,
    fileCount: 0,
    createdAt: new Date().toISOString(),
    status: batchResult.status,
  };
  await Deno.writeTextFile(CONFIG.stateFile, JSON.stringify(state, null, 2));

  console.log(`\nBatch ID: ${batchResult.id}`);
  console.log(`Status: ${batchResult.status}`);
  console.log(`\nNext: Run 'deno task batch:status' to check progress`);
}

async function status(): Promise<void> {
  const apiKey = await getApiKey();
  const state: BatchState = JSON.parse(await Deno.readTextFile(CONFIG.stateFile));

  if (!state.batchId) {
    console.error("No batch ID found. Run 'deno task batch:submit' first.");
    Deno.exit(1);
  }

  const response = await fetch(`https://api.openai.com/v1/batches/${state.batchId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Status check failed:", error);
    Deno.exit(1);
  }

  const batch = await response.json();

  console.log(`\n📊 Batch Status: ${batch.status}`);
  console.log(`   Total requests: ${batch.request_counts?.total ?? "?"}`);
  console.log(`   Completed: ${batch.request_counts?.completed ?? 0}`);
  console.log(`   Failed: ${batch.request_counts?.failed ?? 0}`);

  if (batch.status === "completed") {
    if (batch.request_counts?.failed > 0 && batch.error_file_id) {
      console.log(`\n⚠️  Batch completed with ${batch.request_counts.failed} failures`);
      console.log(`   Error file: ${batch.error_file_id}`);
      console.log(`\nRun 'deno task batch:errors' to view error details`);

      state.status = "completed";
      await Deno.writeTextFile(CONFIG.stateFile, JSON.stringify({ ...state, errorFileId: batch.error_file_id }, null, 2));
    } else {
      console.log(`\n✅ Batch completed!`);
      console.log(`   Output file: ${batch.output_file_id}`);
      console.log(`\nNext: Run 'deno task batch:download' to get results`);

      state.status = "completed";
      await Deno.writeTextFile(CONFIG.stateFile, JSON.stringify({ ...state, outputFileId: batch.output_file_id }, null, 2));
    }
  } else if (batch.status === "failed") {
    console.log(`\n❌ Batch failed`);
    if (batch.errors) {
      console.log("Errors:", JSON.stringify(batch.errors, null, 2));
    }
    if (batch.error_file_id) {
      console.log(`Error file: ${batch.error_file_id}`);
      console.log(`\nRun 'deno task batch:errors' to view error details`);
      await Deno.writeTextFile(CONFIG.stateFile, JSON.stringify({ ...state, status: "failed", errorFileId: batch.error_file_id }, null, 2));
    }
  } else {
    const progress = batch.request_counts
      ? Math.round((batch.request_counts.completed / batch.request_counts.total) * 100)
      : 0;
    console.log(`\n⏳ Progress: ${progress}%`);
    console.log(`   Check again in a few minutes...`);
  }
}

async function download(): Promise<void> {
  const apiKey = await getApiKey();
  const state = JSON.parse(await Deno.readTextFile(CONFIG.stateFile));

  if (!state.outputFileId) {
    console.error("No output file ID. Run 'deno task batch:status' first.");
    Deno.exit(1);
  }

  console.log("📥 Downloading results...");

  const response = await fetch(`https://api.openai.com/v1/files/${state.outputFileId}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Download failed:", error);
    Deno.exit(1);
  }

  const content = await response.text();
  await Deno.writeTextFile(CONFIG.resultsFile, content);

  const lines = content.trim().split("\n");
  console.log(`✅ Downloaded ${lines.length} results to ${CONFIG.resultsFile}`);
  console.log(`\nNext: Run 'deno task batch:apply' to apply changes`);
}

interface BatchResult {
  id: string;
  custom_id: string;
  response: {
    status_code: number;
    body: {
      choices: Array<{
        message: { content: string };
      }>;
    };
  };
  error?: { message: string };
}

async function apply(): Promise<void> {
  console.log("🔧 Applying simplifications...\n");

  const resultsContent = await Deno.readTextFile(CONFIG.resultsFile);
  const results = resultsContent.trim().split("\n").map((line) => JSON.parse(line) as BatchResult);

  let applied = 0;
  let unchanged = 0;
  let errors = 0;

  for (const result of results) {
    // Convert custom_id back to file path (URL encoded)
    const filePath = decodeURIComponent(result.custom_id);

    if (result.error) {
      console.log(`❌ ${filePath}: ${result.error.message}`);
      errors++;
      continue;
    }

    if (result.response.status_code !== 200) {
      console.log(`❌ ${filePath}: HTTP ${result.response.status_code}`);
      errors++;
      continue;
    }

    const simplifiedCode = result.response.body.choices[0]?.message?.content;
    if (!simplifiedCode) {
      console.log(`⚠️  ${filePath}: Empty response`);
      errors++;
      continue;
    }

    // Read original to compare
    let originalCode: string;
    try {
      originalCode = await Deno.readTextFile(filePath);
    } catch {
      console.log(`⚠️  ${filePath}: File not found`);
      errors++;
      continue;
    }

    // Check if code actually changed
    const cleanedOriginal = originalCode.trim();
    const cleanedSimplified = simplifiedCode.trim();

    if (cleanedOriginal === cleanedSimplified) {
      unchanged++;
      continue;
    }

    // Write the simplified code
    await Deno.writeTextFile(filePath, cleanedSimplified + "\n");
    console.log(`✅ ${filePath}`);
    applied++;
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Applied: ${applied}`);
  console.log(`   Unchanged: ${unchanged}`);
  console.log(`   Errors: ${errors}`);
}

async function errors(): Promise<void> {
  const apiKey = await getApiKey();
  const state = JSON.parse(await Deno.readTextFile(CONFIG.stateFile));

  if (!state.errorFileId) {
    console.error("No error file ID. Run 'deno task batch:status' first.");
    Deno.exit(1);
  }

  console.log("📥 Downloading error details...\n");

  const response = await fetch(`https://api.openai.com/v1/files/${state.errorFileId}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Download failed:", error);
    Deno.exit(1);
  }

  const content = await response.text();
  const lines = content.trim().split("\n");

  // Group errors by message
  const errorCounts = new Map<string, number>();
  for (const line of lines) {
    const parsed = JSON.parse(line);
    const msg = parsed.response?.body?.error?.message || parsed.error?.message || "Unknown error";
    errorCounts.set(msg, (errorCounts.get(msg) || 0) + 1);
  }

  console.log(`Found ${lines.length} errors:\n`);
  for (const [msg, count] of errorCounts) {
    console.log(`  ${count}x: ${msg}`);
  }
}

async function estimate(): Promise<void> {
  console.log("💰 Estimating batch cost...\n");

  const files = await collectFiles();
  let totalChars = 0;
  let fileCount = 0;

  for (const filePath of files) {
    const content = await Deno.readTextFile(filePath);
    if (content.length >= CONFIG.minFileSize && content.length <= CONFIG.maxFileSize) {
      totalChars += content.length + SYSTEM_PROMPT.length;
      fileCount++;
    }
  }

  // Rough token estimate (1 token ≈ 4 chars)
  const inputTokens = Math.ceil(totalChars / 4);
  const outputTokens = Math.ceil(inputTokens * 0.8); // Assume output is ~80% of input

  // GPT-5.2 batch pricing
  const inputCostPer1M = 1.75; // $1.75 per 1M input tokens (batch)
  const outputCostPer1M = 14; // $14 per 1M output tokens (batch)

  const inputCost = (inputTokens / 1_000_000) * inputCostPer1M;
  const outputCost = (outputTokens / 1_000_000) * outputCostPer1M;
  const totalCost = inputCost + outputCost;

  console.log(`Files to process: ${fileCount}`);
  console.log(`Estimated input tokens: ${inputTokens.toLocaleString()}`);
  console.log(`Estimated output tokens: ${outputTokens.toLocaleString()}`);
  console.log(`\nEstimated cost (${CONFIG.model} batch pricing):`);
  console.log(`   Input:  $${inputCost.toFixed(2)}`);
  console.log(`   Output: $${outputCost.toFixed(2)}`);
  console.log(`   Total:  $${totalCost.toFixed(2)}`);
}

// CLI
const command = Deno.args[0];

switch (command) {
  case "prepare":
    await prepare();
    break;
  case "submit":
    await submit();
    break;
  case "status":
    await status();
    break;
  case "download":
    await download();
    break;
  case "apply":
    await apply();
    break;
  case "errors":
    await errors();
    break;
  case "estimate":
    await estimate();
    break;
  default:
    console.log(`
OpenAI Batch Code Simplifier

Commands:
  estimate   Estimate cost before running
  prepare    Create JSONL batch file from src/ and tests/
  submit     Upload and submit batch to OpenAI
  status     Check batch processing status
  errors     View error details (if batch failed)
  download   Download completed results
  apply      Apply simplifications to files

Workflow:
  1. deno task batch:estimate
  2. deno task batch:prepare
  3. deno task batch:submit
  4. deno task batch:status  (repeat until done)
  5. deno task batch:download
  6. deno task batch:apply

Environment:
  OPENAI_API_KEY - Required for submit/status/download/errors
`);
}
