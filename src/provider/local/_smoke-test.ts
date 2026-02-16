/**
 * Smoke test: auto-fallback from openai/gpt-4o → local model.
 * Run: deno run --allow-all src/provider/local/_smoke-test.ts
 */

import { resolveModel } from "../model-registry.ts";
import { streamText } from "ai";

// Suppress AI SDK warnings for cleaner output
globalThis.AI_SDK_LOG_WARNINGS = false;

console.log('1. Resolving "openai/gpt-4o" (no API key set)...');
const model = resolveModel("openai/gpt-4o");
// deno-lint-ignore no-explicit-any
console.log(`   → Got model: ${(model as any).modelId ?? (model as any).provider}`);

console.log("\n2. Streaming response via AI SDK...");
const result = streamText({
  model,
  messages: [{ role: "user", content: "What is 2+2? Answer in one word." }],
  maxOutputTokens: 30,
});

let output = "   → ";
for await (const chunk of result.textStream) {
  output += chunk;
}
console.log(output);
console.log("\n3. Done! Chat works with zero configuration.");

Deno.exit(0);
