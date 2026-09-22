import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VERYFRONT_CLOUD_CHAT_MODELS } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import {
  __resetLoggerConfigForTests,
  __subscribeLogRecordEmitter,
  type LogEntry,
  LogLevel,
  setLogLevel,
} from "#veryfront/utils/logger/logger.ts";
import {
  __resetUnknownModelWarningsForTests,
  FALLBACK_MODEL_MAX_OUTPUT_TOKENS,
  getModelMaxOutputTokens,
  UNKNOWN_MODEL_MAX_OUTPUT_TOKENS_WARNING,
} from "./constants.ts";

/** Capture the unknown-model warning emitted while `run` executes. */
function captureUnknownModelWarnings(run: () => void): LogEntry[] {
  const records: LogEntry[] = [];
  // The warning is emitted once per distinct id, and an ambient LOG_LEVEL above
  // warn would suppress it -- pin both so the assertion means the same thing in
  // any shell and in CI.
  __resetUnknownModelWarningsForTests();
  setLogLevel(LogLevel.WARN);
  const unsubscribe = __subscribeLogRecordEmitter((entry) => {
    if (entry.message === UNKNOWN_MODEL_MAX_OUTPUT_TOKENS_WARNING) records.push(entry);
  });
  try {
    run();
  } finally {
    unsubscribe();
    __resetLoggerConfigForTests();
  }
  return records;
}

describe("getModelMaxOutputTokens", () => {
  it("returns known limit for Anthropic Opus", () => {
    assertEquals(getModelMaxOutputTokens("anthropic/claude-opus-4-8"), 128_000);
  });

  it("returns known limit for Anthropic Sonnet", () => {
    assertEquals(getModelMaxOutputTokens("anthropic/claude-sonnet-4-6"), 64_000);
  });

  it("strips veryfront-cloud/ prefix before matching", () => {
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/anthropic/claude-opus-4-8"), 128_000);
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/openai/gpt-5.5"), 128_000);
  });

  it("uses Gemini limits for direct Google runtime model ids", () => {
    assertEquals(getModelMaxOutputTokens("google/gemini-3.1-pro-preview"), 65_536);
    assertEquals(getModelMaxOutputTokens("google/gemini-3.5-flash"), 65_536);
  });

  it("returns known limits for Mistral models", () => {
    assertEquals(getModelMaxOutputTokens("mistral/mistral-large-2512"), 1_024);
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/mistral/mistral-large-2512"), 1_024);
    assertEquals(getModelMaxOutputTokens("mistral/mistral-small-2503"), 16_384);
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/mistral/mistral-small-2503"), 16_384);
  });

  it("returns a large limit for Kimi thinking models so reasoning_content does not exhaust the budget", () => {
    assertEquals(getModelMaxOutputTokens("moonshotai/kimi-k2"), 32_000);
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/moonshotai/kimi-k2"), 32_000);
    assertEquals(getModelMaxOutputTokens("moonshotai/kimi-k2.6"), 32_000);
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/moonshotai/kimi-k2.6"), 32_000);
    assertEquals(getModelMaxOutputTokens("moonshotai/kimi-k2.5"), 32_000);
  });

  it("returns a large limit for the OpenAI GPT-5.4 thinking family (incl. the default agent model gpt-5.4-nano)", () => {
    assertEquals(getModelMaxOutputTokens("openai/gpt-5.4"), 128_000);
    assertEquals(getModelMaxOutputTokens("openai/gpt-5.4-mini"), 128_000);
    assertEquals(getModelMaxOutputTokens("openai/gpt-5.4-nano"), 128_000);
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/openai/gpt-5.4-nano"), 128_000);
  });

  it("returns the safe fallback limit for unknown models", () => {
    assertEquals(getModelMaxOutputTokens("unknown/model"), FALLBACK_MODEL_MAX_OUTPUT_TOKENS);
  });

  // veryfront-issue-inbox#1480: the table is keyed by exact model id, so the
  // undated spelling of a dated model missed it and silently collapsed to the
  // 4_096 fallback while its dated sibling got 64_000.
  it("resolves an undated model id to the same limit as its dated sibling", () => {
    assertEquals(getModelMaxOutputTokens("anthropic/claude-haiku-4-5-20251001"), 64_000);
    assertEquals(getModelMaxOutputTokens("anthropic/claude-haiku-4-5"), 64_000);
    assertEquals(getModelMaxOutputTokens("veryfront-cloud/anthropic/claude-haiku-4-5"), 64_000);
  });

  it("resolves an unlisted snapshot date to the model's limit", () => {
    assertEquals(getModelMaxOutputTokens("anthropic/claude-haiku-4-5-20260101"), 64_000);
  });

  it("matches model ids case-insensitively", () => {
    assertEquals(getModelMaxOutputTokens("Anthropic/Claude-Haiku-4-5"), 64_000);
  });

  it("warns with the model id when an unknown model falls back", () => {
    const records = captureUnknownModelWarnings(() => {
      assertEquals(getModelMaxOutputTokens("unknown/model"), FALLBACK_MODEL_MAX_OUTPUT_TOKENS);
    });
    assertEquals(records.length, 1);
    const warning = records[0];
    assertExists(warning);
    assertEquals(warning.level, "warn");
    assertEquals(warning.context?.model, "unknown/model");
    assertEquals(warning.context?.max_output_limit, FALLBACK_MODEL_MAX_OUTPUT_TOKENS);
  });

  it("stays quiet for models the table covers", () => {
    const records = captureUnknownModelWarnings(() => {
      getModelMaxOutputTokens("anthropic/claude-haiku-4-5");
      getModelMaxOutputTokens("veryfront-cloud/openai/gpt-5.5");
      getModelMaxOutputTokens("google/gemini-2.5-pro");
    });
    assertEquals(records, []);
  });
});

describe("MODEL_MAX_OUTPUT_TOKENS covers the catalog", () => {
  // Every catalog model MUST have an explicit budget. A missing entry falls back
  // to FALLBACK_MODEL_MAX_OUTPUT_TOKENS (4_096), which truncates thinking models
  // before they emit any answer content (see veryfront-code#2791). This test
  // keeps the token table in sync with the catalog so a newly added model
  // cannot regress into that class of bug unnoticed.
  it("every catalog model has an explicit max-output-token budget (not just the fallback)", () => {
    const missing = VERYFRONT_CLOUD_CHAT_MODELS
      .filter((model) =>
        getModelMaxOutputTokens(model.modelId) === FALLBACK_MODEL_MAX_OUTPUT_TOKENS
      )
      .map((model) => model.modelId);
    assertEquals(missing, []);
  });

  // veryfront-issue-inbox#1480: agent definitions are written with the undated
  // spelling as often as the dated one. Both must carry the same budget.
  it("every dated catalog model gives its undated id the same budget", () => {
    const mismatched = VERYFRONT_CLOUD_CHAT_MODELS
      .filter((model) => /-\d{8}$/.test(model.modelId))
      .map((model) => ({
        modelId: model.modelId,
        dated: getModelMaxOutputTokens(model.modelId),
        undated: getModelMaxOutputTokens(model.modelId.replace(/-\d{8}$/, "")),
      }))
      .filter((entry) => entry.dated !== entry.undated)
      .map((entry) => `${entry.modelId}=${entry.dated} vs undated=${entry.undated}`);
    assertEquals(mismatched, []);
  });

  it("every thinking model gets enough budget for reasoning plus an answer", () => {
    // Thinking models stream reasoning_content ahead of the answer; the budget
    // must comfortably exceed the reasoning burst. Non-thinking models are
    // exempt (e.g. mistral-large-2512 is intentionally quota-capped at 1_024).
    const FLOOR = 16_000;
    const tooLow = VERYFRONT_CLOUD_CHAT_MODELS
      .filter((model) => model.thinking && getModelMaxOutputTokens(model.modelId) < FLOOR)
      .map((model) => `${model.modelId}=${getModelMaxOutputTokens(model.modelId)}`);
    assertEquals(tooLow, []);
  });

  // Codex P2 on veryfront-code#4514: the first version stopped INSERTING at the
  // cap but still returned true, so every id past it warned on every call --
  // the exact log flood the cap exists to prevent.
  it("stops warning once the dedup cap is reached", () => {
    const records = captureUnknownModelWarnings(() => {
      for (let i = 0; i < 300; i++) getModelMaxOutputTokens(`unknown/model-${i}`);
      // Well past the 256 cap: these must be silent, not warn every call.
      for (let i = 0; i < 5; i++) getModelMaxOutputTokens("unknown/model-well-past-the-cap");
    });
    assertEquals(records.length <= 256, true);
    const pastCap = records.filter((entry) =>
      entry.context?.model === "unknown/model-well-past-the-cap"
    );
    assertEquals(pastCap.length, 0);
  });

  // Codex P2: a model id is caller-supplied and can be as large as the request
  // body allows, so the entry count alone does not bound retained memory.
  it("bounds the retained length of an oversized model id", () => {
    const huge = `unknown/${"x".repeat(50_000)}`;
    const records = captureUnknownModelWarnings(() => {
      getModelMaxOutputTokens(huge);
      // Same id: deduped on the truncated key, so exactly one warning.
      getModelMaxOutputTokens(huge);
    });
    assertEquals(records.length, 1);
    // The emitted value is bounded too: logging a caller-controlled id whole
    // would put untrusted request content in the logs and let a few requests
    // produce megabytes of them.
    const logged = String(records[0]?.context?.model ?? "");
    assertEquals(logged.length < 400, true);
    assertEquals(logged.includes("more characters]"), true);
    assertEquals(logged.startsWith("unknown/xxx"), true);
  });
});
