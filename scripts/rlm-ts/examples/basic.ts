/**
 * Basic RLM Example
 *
 * Demonstrates core functionality of the RLM library
 */

import { createRLM, createLogger } from "../src/index.ts";

// Load environment variables
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

async function basicExample() {
  console.log("=== Basic RLM Example ===\n");

  if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set");
    return;
  }

  const rlm = createRLM({
    backend: "openai",
    backendConfig: {
      apiKey: OPENAI_API_KEY,
      model: "gpt-4o-mini",
    },
    maxIterations: 5,
    verbose: true,
  });

  const result = await rlm.completion({
    query: "What is the sum of the first 10 prime numbers? Show your work.",
  });

  console.log("\n--- Result ---");
  console.log("Success:", result.success);
  console.log("Iterations:", result.iterationCount);
  console.log("Final Answer:", result.finalAnswer);
  console.log("Total Tokens:", result.usage.totalTokens.totalTokens);
  console.log("Time:", result.totalTimeMs.toFixed(0), "ms");
}

async function contextExample() {
  console.log("\n=== Context Example ===\n");

  if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set");
    return;
  }

  const rlm = createRLM({
    backend: "openai",
    backendConfig: {
      apiKey: OPENAI_API_KEY,
      model: "gpt-4o-mini",
    },
  });

  // Provide data as context
  const users = [
    { name: "Alice", age: 28, score: 95 },
    { name: "Bob", age: 34, score: 87 },
    { name: "Charlie", age: 22, score: 92 },
    { name: "Diana", age: 31, score: 88 },
    { name: "Eve", age: 25, score: 91 },
  ];

  const result = await rlm.completion({
    query: "Find the user with the highest score and calculate the average age of all users.",
    context: { users },
  });

  console.log("\n--- Result ---");
  console.log("Success:", result.success);
  console.log("Final Answer:", result.finalAnswer);
}

async function streamingExample() {
  console.log("\n=== Streaming Example ===\n");

  if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set");
    return;
  }

  const rlm = createRLM({
    backend: "openai",
    backendConfig: {
      apiKey: OPENAI_API_KEY,
      model: "gpt-4o-mini",
    },
  });

  console.log("Streaming response:\n");

  for await (const chunk of rlm.stream({
    query: "Write a haiku about programming, then use code to count its syllables.",
  })) {
    switch (chunk.type) {
      case "text":
        Deno.stdout.writeSync(new TextEncoder().encode(chunk.content));
        break;
      case "code_start":
        console.log("\n\n[Executing code...]");
        break;
      case "execution":
        if (chunk.executionResult?.output.stdout) {
          console.log("Output:", chunk.executionResult.output.stdout);
        }
        break;
      case "final_answer":
        console.log("\n\n--- Final Answer ---");
        console.log(chunk.content);
        break;
      case "done":
        console.log("\n[Done in", chunk.metadata?.totalTimeMs?.toFixed(0), "ms]");
        break;
    }
  }
}

async function callbackExample() {
  console.log("\n=== Callback Example ===\n");

  if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set");
    return;
  }

  const rlm = createRLM({
    backend: "openai",
    backendConfig: {
      apiKey: OPENAI_API_KEY,
      model: "gpt-4o-mini",
    },
    onIteration: async (iteration) => {
      console.log(`[Iteration ${iteration.index}]`);
      console.log(`  Tokens: ${iteration.tokens?.totalTokens ?? 0}`);
      console.log(`  Code blocks: ${iteration.parsedResponse.codeBlocks.length}`);
      console.log(`  Has final answer: ${iteration.parsedResponse.hasFinalAnswer}`);
    },
    onCodeExecution: async (code, result) => {
      console.log(`[Code Execution]`);
      console.log(`  Success: ${result.success}`);
      if (result.output.stdout) {
        console.log(`  Output: ${result.output.stdout.substring(0, 100)}`);
      }
    },
  });

  await rlm.completion({
    query: "Calculate 2^10 using code and explain what the result means.",
  });
}

async function anthropicExample() {
  console.log("\n=== Anthropic Claude Example ===\n");

  if (!ANTHROPIC_API_KEY) {
    console.log("ANTHROPIC_API_KEY not set, skipping...");
    return;
  }

  const rlm = createRLM({
    backend: "anthropic",
    backendConfig: {
      apiKey: ANTHROPIC_API_KEY,
      model: "claude-sonnet-4-20250514",
    },
  });

  const result = await rlm.completion({
    query: "What is 7 factorial? Calculate it step by step.",
  });

  console.log("Success:", result.success);
  console.log("Final Answer:", result.finalAnswer);
}

// Run examples
async function main() {
  const args = Deno.args;

  if (args.includes("--basic") || args.length === 0) {
    await basicExample();
  }
  if (args.includes("--context")) {
    await contextExample();
  }
  if (args.includes("--streaming")) {
    await streamingExample();
  }
  if (args.includes("--callbacks")) {
    await callbackExample();
  }
  if (args.includes("--anthropic")) {
    await anthropicExample();
  }
  if (args.includes("--all")) {
    await basicExample();
    await contextExample();
    await streamingExample();
    await callbackExample();
    await anthropicExample();
  }
}

main().catch(console.error);
