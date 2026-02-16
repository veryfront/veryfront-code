/**
 * Local Provider Tests
 *
 * Tests for the model catalog, AI SDK adapter, and model registry integration.
 * Engine tests require @huggingface/transformers and are marked with `ignore`
 * for fast CI — run manually with `--filter "local-engine"`.
 */

import { assertEquals, assertExists } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { DEFAULT_LOCAL_MODEL, getLocalModelIds, resolveLocalModel } from "./model-catalog.ts";
import { createLocalModel } from "./ai-sdk-adapter.ts";

describe("model-catalog", () => {
  it("resolves known model IDs to HuggingFace IDs", () => {
    const info = resolveLocalModel("smollm2-135m");
    assertEquals(info.hfId, "HuggingFaceTB/SmolLM2-135M-Instruct");
    assertEquals(info.dtype, "q4");
  });

  it("falls back to raw HuggingFace ID for unknown models", () => {
    const info = resolveLocalModel("custom-org/custom-model");
    assertEquals(info.hfId, "custom-org/custom-model");
    assertEquals(info.dtype, "q4");
  });

  it("has a default model set", () => {
    assertEquals(DEFAULT_LOCAL_MODEL, "smollm2-135m");
  });

  it("lists available model IDs", () => {
    const ids = getLocalModelIds();
    assertEquals(ids.includes("smollm2-135m"), true);
    assertEquals(ids.includes("smollm2-360m"), true);
    assertEquals(ids.includes("smollm2-1.7b"), true);
  });
});

describe("ai-sdk-adapter", () => {
  it("creates a LanguageModelV2-compatible object", () => {
    const model = createLocalModel("smollm2-135m");
    // deno-lint-ignore no-explicit-any
    const m = model as any;
    assertEquals(m.specificationVersion, "v2");
    assertEquals(m.provider, "local");
    assertEquals(m.modelId, "local/smollm2-135m");
    assertExists(m.doGenerate);
    assertExists(m.doStream);
  });

  it("uses default model when no ID provided", () => {
    const model = createLocalModel();
    // deno-lint-ignore no-explicit-any
    assertEquals((model as any).modelId, "local/smollm2-135m");
  });
});

describe("local-engine (requires model download)", {
  // ONNX Runtime keeps file handles open — disable Deno's leak detection
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
  // These tests actually download and run the model — skip in CI
  it("generateStream produces tokens", {
    ignore: Deno.env.get("CI") === "true",
  }, async () => {
    const { generateStream } = await import("./local-engine.ts");
    const tokens: string[] = [];

    for await (
      const token of generateStream("smollm2-135m", [
        { role: "user", content: "Say hello in one word." },
      ], { maxNewTokens: 20 })
    ) {
      tokens.push(token);
    }

    assertEquals(tokens.length > 0, true, "Should produce at least one token");
    const text = tokens.join("");
    assertEquals(text.length > 0, true, "Combined text should be non-empty");
  });
});
