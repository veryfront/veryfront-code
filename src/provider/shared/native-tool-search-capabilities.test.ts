import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  supportsAnthropicNativeToolSearchModel,
  supportsOpenAINativeToolSearchModel,
} from "./native-tool-search-capabilities.ts";

Deno.test("native tool-search model capabilities are explicit and fail closed", () => {
  for (
    const modelId of [
      "claude-opus-4-5",
      "claude-opus-4-6",
      "claude-opus-4-7",
      "claude-opus-4-8",
      "claude-sonnet-4-5",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]
  ) {
    assertEquals(supportsAnthropicNativeToolSearchModel(modelId), true);
    assertEquals(supportsAnthropicNativeToolSearchModel(`${modelId}-20260730`), true);
  }
  for (const modelId of ["claude-opus-4-1", "claude-sonnet-4", "claude-arbitrary"]) {
    assertEquals(supportsAnthropicNativeToolSearchModel(modelId), false);
  }

  for (
    const modelId of [
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-pro",
      "gpt-5.5",
      "gpt-5.6",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]
  ) {
    assertEquals(supportsOpenAINativeToolSearchModel(modelId), true);
    assertEquals(supportsOpenAINativeToolSearchModel(`${modelId}-2026-07-30`), true);
  }
  for (
    const modelId of [
      "gpt-5.3",
      "gpt-5.4-nano",
      "gpt-5.5-pro",
      "gpt-5.6-codex",
      "gpt-5.6-arbitrary",
      "gpt-5.6-sol-codex",
      "gpt-5.6-sol-2026-07",
      "gpt-5.6-sol-2026-07-30-extra",
    ]
  ) {
    assertEquals(supportsOpenAINativeToolSearchModel(modelId), false);
  }
});
