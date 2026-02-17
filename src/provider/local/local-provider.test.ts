/**
 * Local Provider Tests
 *
 * Tests for the model catalog, AI SDK adapter, and model registry integration.
 * Engine tests require @huggingface/transformers and are marked with `ignore`
 * for fast CI — run manually with `--filter "local-engine"`.
 */

import { assertEquals, assertExists, assertRejects } from "#std/assert";
import { afterEach, describe, it } from "#std/testing/bdd";
import { DEFAULT_LOCAL_MODEL, getLocalModelIds, resolveLocalModel } from "./model-catalog.ts";
import { createLocalModel } from "./ai-sdk-adapter.ts";
import { clearModelProviders, ensureModelReady } from "../model-registry.ts";
import { fromError } from "#veryfront/errors/veryfront-error.ts";

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

  it("sets _isVfLocalModel marker for ensureModelReady detection", () => {
    const model = createLocalModel("smollm2-135m");
    const m = model as Record<string, unknown>;
    assertEquals(m._isVfLocalModel, true);
  });
});

describe("ensureModelReady", () => {
  afterEach(() => {
    clearModelProviders();
  });

  it("is a no-op for non-local models (no _isVfLocalModel marker)", async () => {
    // A mock model without _isVfLocalModel should pass through immediately
    const mockModel = {
      specificationVersion: "v2" as const,
      provider: "openai",
      modelId: "openai/gpt-4o",
      supportedUrls: {},
      doGenerate: async () => ({}),
      doStream: async () => ({ stream: new ReadableStream() }),
    };
    // Should not throw — just returns without verifying runtime
    // deno-lint-ignore no-explicit-any
    await ensureModelReady(mockModel as any);
  });

  it("throws no_ai_available for local models when runtime unavailable", async () => {
    const prev = Deno.env.get("VERYFRONT_DISABLE_LOCAL_AI");
    Deno.env.set("VERYFRONT_DISABLE_LOCAL_AI", "1");
    try {
      const localModel = createLocalModel("smollm2-135m");
      const error = await assertRejects(
        () => ensureModelReady(localModel),
      );
      const vfError = fromError(error);
      assertEquals(vfError?.type, "no_ai_available");
    } finally {
      if (prev === undefined) Deno.env.delete("VERYFRONT_DISABLE_LOCAL_AI");
      else Deno.env.set("VERYFRONT_DISABLE_LOCAL_AI", prev);
    }
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
