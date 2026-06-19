/**
 * Smoke test: explicit local model.
 * Run: deno run --allow-all src/provider/local/_smoke-test.ts
 */

import { resolveModel } from "../model-registry.ts";
import { getModelRuntimeId, getModelRuntimeProvider } from "../runtime-inspection.ts";
import { generate } from "./local-engine.ts";

// Suppress provider adapter warnings for cleaner output.
Object.defineProperty(globalThis, "AI_SDK_LOG_WARNINGS", {
  value: false,
  configurable: true,
  writable: true,
});

const localModelId = Deno.env.get("VERYFRONT_LOCAL_AI_MODEL") || "qwen3.5-0.8b";
const modelName = `local/${localModelId}`;

console.log(`1. Resolving "${modelName}"...`);
const model = resolveModel(modelName);
console.log(`   -> Got model: ${getModelRuntimeId(model) ?? getModelRuntimeProvider(model)}`);
console.log(`   -> Device: ${Deno.env.get("VERYFRONT_LOCAL_AI_DEVICE") || "cpu"}`);
console.log(
  `   -> Thinking: ${Deno.env.get("VERYFRONT_LOCAL_AI_THINKING") === "1" ? "enabled" : "disabled"}`,
);

console.log("\n2. Generating response via the local engine...");
const output = await generate(localModelId, [
  { role: "user", content: "What is 2+2? Answer in one word." },
], { maxNewTokens: 30, temperature: 0 });
if (output.trim().length === 0) {
  throw new Error("Local model generated empty output.");
}
console.log(`   -> ${output}`);
console.log("\n3. Done! Local model inference works.");
