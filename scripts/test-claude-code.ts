#!/usr/bin/env -S deno run --allow-all
/**
 * Test script for Claude Code workflow execution
 *
 * This script tests the Claude Code agent by running a simple task
 * against a real Veryfront project using the workflow execution infrastructure.
 *
 * Required environment variables:
 *   ANTHROPIC_API_KEY      - Anthropic API key for Claude access
 *   VERYFRONT_API_TOKEN    - Veryfront API token (use /generate-token skill)
 *   VERYFRONT_PROJECT_SLUG - Project slug to work with
 *   VERYFRONT_API_BASE_URL - API base URL (default: https://api.veryfront.com/api)
 *
 * Usage:
 *   # Set environment variables
 *   export ANTHROPIC_API_KEY="sk-ant-..."
 *   export VERYFRONT_API_TOKEN="vf_..."
 *   export VERYFRONT_PROJECT_SLUG="your-project"
 *   export VERYFRONT_API_BASE_URL="https://api.veryfront.com/api"
 *
 *   # Run the test
 *   deno run --allow-all scripts/test-claude-code.ts
 *
 * To generate a token, use the /generate-token skill:
 *   /generate-token your-project preview
 */

// Check required environment variables
const required = ["ANTHROPIC_API_KEY", "VERYFRONT_API_TOKEN", "VERYFRONT_PROJECT_SLUG"];
const missing = required.filter((k) => !Deno.env.get(k));

if (missing.length > 0) {
  console.error("❌ Missing required environment variables:");
  for (const key of missing) {
    console.error(`   - ${key}`);
  }
  console.error("\n📋 Requirements:");
  console.error("   ANTHROPIC_API_KEY      - Your Anthropic API key");
  console.error("   VERYFRONT_API_TOKEN    - Veryfront API token (use /generate-token skill)");
  console.error("   VERYFRONT_PROJECT_SLUG - Project slug to work with");
  console.error("\n💡 Example:");
  console.error("   export ANTHROPIC_API_KEY='sk-ant-...'");
  console.error("   export VERYFRONT_API_TOKEN='vf_...'");
  console.error("   export VERYFRONT_PROJECT_SLUG='my-project'");
  console.error("   deno run --allow-all scripts/test-claude-code.ts");
  Deno.exit(1);
}

// Import modules
import {
  workflow,
  step,
  createWorkflowClient,
  MemoryBackend,
  claudeCodeTool,
} from "../src/ai/workflow/index.ts";
import { runWithRequestContext } from "../src/platform/adapters/fs/veryfront/multi-project-adapter.ts";

async function main() {
  console.log("🚀 Claude Code Workflow Test\n");

  const projectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG")!;
  const token = Deno.env.get("VERYFRONT_API_TOKEN")!;
  const apiUrl = Deno.env.get("VERYFRONT_API_BASE_URL") || "https://api.veryfront.com/api";

  console.log(`📁 Project: ${projectSlug}`);
  console.log(`🌐 API URL: ${apiUrl}`);
  console.log(`🔑 API Token: ${token.slice(0, 10)}...`);
  console.log(`🤖 Model: claude-sonnet-4-20250514\n`);

  // Define a simple workflow that uses Claude Code
  const testWorkflow = workflow({
    id: "claude-code-test",
    description: "Test Claude Code agent execution",
    steps: [
      step("analyze", {
        tool: claudeCodeTool,
        input: {
          task: `
            You are analyzing a Veryfront project. Your task is:
            1. List the files available in the project
            2. Read the main entry file (likely index.tsx, page.tsx, or similar)
            3. Provide a brief summary of the project structure

            Keep your response concise - just describe what you found.
          `,
          mode: "analysis", // Read-only mode for safety
          maxIterations: 5,
        },
      }),
    ],
  });

  // Create backend and client
  const backend = new MemoryBackend({ debug: true });
  const client = createWorkflowClient({
    backend,
    debug: true,
  });

  // Register the workflow
  client.register(testWorkflow);

  console.log("📝 Starting workflow execution...");
  console.log("=".repeat(60) + "\n");

  // Set up tenant context for multi-tenant mode
  const tenantContext = {
    projectSlug,
    token,
    productionMode: false, // Use draft/preview mode
  };

  try {
    // Run within request context so tenant context is captured
    await runWithRequestContext(tenantContext, async () => {
      // Start the workflow
      const handle = await client.start("claude-code-test", {
        projectSlug,
      });

      console.log(`   Run ID: ${handle.runId}`);

      // Wait for result
      const result = await handle.result();

      console.log("\n" + "=".repeat(60));
      console.log("\n📊 Workflow Result:");

      // Get final run status
      const run = await client.getRun(handle.runId);
      console.log(`   Status: ${run?.status}`);

      if (run?.startedAt && run?.endedAt) {
        console.log(`   Duration: ${run.endedAt.getTime() - run.startedAt.getTime()}ms`);
      }

      if (result) {
        console.log("\n📄 Output:");
        const output = result as Record<string, unknown>;
        if (output.analyze) {
          const analyzeResult = output.analyze as {
            success?: boolean;
            response?: string;
            iterations?: number;
            filesModified?: string[];
            commandsExecuted?: string[];
          };
          console.log(`   Success: ${analyzeResult.success}`);
          console.log(`   Iterations: ${analyzeResult.iterations}`);
          if (analyzeResult.filesModified?.length) {
            console.log(`   Files modified: ${analyzeResult.filesModified.join(", ")}`);
          }
          if (analyzeResult.commandsExecuted?.length) {
            console.log(`   Commands executed: ${analyzeResult.commandsExecuted.length}`);
          }
          console.log("\n   Response:");
          console.log(analyzeResult.response || "(no response)");
        } else {
          console.log(JSON.stringify(output, null, 2));
        }
      }

      if (run?.status === "failed") {
        console.error("\n❌ Workflow failed:", run.error);
        throw new Error(run.error);
      }

      console.log("\n✅ Test completed successfully!");
    });

    // Cleanup
    await client.destroy();
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    try {
      await client.destroy();
    } catch {
      // Ignore cleanup errors
    }
    Deno.exit(1);
  }
}

main();
