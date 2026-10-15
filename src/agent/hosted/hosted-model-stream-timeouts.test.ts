import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS } from "#veryfront/chat/stream-watchdog.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { parseAgentServiceConfig } from "../service/config.ts";
import {
  resetHostedModelStreamTimeoutWarningsForTests,
  resolveHostedModelRuntimeOptions,
  resolveHostedModelStreamTimeouts,
} from "./hosted-model-stream-timeouts.ts";

describe("host-owned model stream timeouts", () => {
  beforeEach(() => resetHostedModelStreamTimeoutWarningsForTests());

  it("derives an unset first-progress budget under a watchdog pinned to the old 120s default", () => {
    const warnings: Array<{ message: string; metadata: Record<string, unknown> }> = [];
    const warn = (message: string, metadata: Record<string, unknown>) =>
      warnings.push({ message, metadata });
    for (let request = 0; request < 3; request++) {
      assertEquals(
        resolveHostedModelStreamTimeouts(parseAgentServiceConfig({}), 120_000, warn),
        { firstProgressTimeoutMs: 59_999 },
      );
    }
    assertEquals(warnings.length, 1);
    assertStringIncludes(warnings[0]!.message, "VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS");
    assertStringIncludes(warnings[0]!.message, "VERYFRONT_CHAT_STREAM_IDLE_TIMEOUT_MS=120000ms");
    assertStringIncludes(warnings[0]!.message, "59999ms");
  });

  it("names the env vars and effective values when an explicit budget does not fit", () => {
    const error = <Error> assertThrows(
      () =>
        resolveHostedModelStreamTimeouts(
          parseAgentServiceConfig({ VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS: "60000" }),
          120_000,
        ),
      TypeError,
    );
    assertStringIncludes(error.message, "VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS=60000");
    assertStringIncludes(error.message, "= 120000ms");
    assertStringIncludes(error.message, "VERYFRONT_CHAT_STREAM_IDLE_TIMEOUT_MS=120000ms");
    const idleError = <Error> assertThrows(
      () =>
        resolveHostedModelStreamTimeouts(
          parseAgentServiceConfig({ VERYFRONT_MODEL_STREAM_SEMANTIC_IDLE_TIMEOUT_MS: "150000" }),
          150_000,
        ),
      TypeError,
    );
    assertStringIncludes(
      idleError.message,
      "VERYFRONT_MODEL_STREAM_SEMANTIC_IDLE_TIMEOUT_MS=150000ms",
    );
  });
  it("keeps framework defaults when the host has no override", () => {
    assertEquals(
      resolveHostedModelStreamTimeouts(
        parseAgentServiceConfig({}),
        DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS,
      ),
      undefined,
    );
  });

  it("counts default first-progress replays when only semantic idle is configured", () => {
    const config = parseAgentServiceConfig({
      VERYFRONT_MODEL_STREAM_SEMANTIC_IDLE_TIMEOUT_MS: "20000",
    });
    assertEquals(resolveHostedModelStreamTimeouts(config, 90_000), {
      firstProgressTimeoutMs: 44_999,
      semanticIdleTimeoutMs: 20_000,
    });
    assertEquals(resolveHostedModelStreamTimeouts(config, 120_000), {
      firstProgressTimeoutMs: 59_999,
      semanticIdleTimeoutMs: 20_000,
    });
    assertEquals(resolveHostedModelStreamTimeouts(config, DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS), {
      semanticIdleTimeoutMs: 20_000,
    });
  });

  it("passes only explicit model stream budgets", () => {
    const config = parseAgentServiceConfig({
      VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS: "50000",
      VERYFRONT_MODEL_STREAM_SEMANTIC_IDLE_TIMEOUT_MS: "20000",
    });
    assertEquals(resolveHostedModelStreamTimeouts(config, 120_000), {
      firstProgressTimeoutMs: 50_000,
      semanticIdleTimeoutMs: 20_000,
    });
  });

  it("requires the outer stream watchdog to exceed each model budget", () => {
    const config = parseAgentServiceConfig({
      VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS: "120000",
    });
    assertThrows(() => resolveHostedModelStreamTimeouts(config, 120_000));
    assertEquals(resolveHostedModelStreamTimeouts(config, 250_000), {
      firstProgressTimeoutMs: 120_000,
    });
  });

  it("counts the replay of a first-progress timeout against the outer watchdog", () => {
    // Active lifecycle mode replays a stream that timed out before output, so
    // a 90s budget can wait 180s before the failure reaches a 120s watchdog.
    const config = parseAgentServiceConfig({
      VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS: "90000",
    });
    assertThrows(
      () => resolveHostedModelStreamTimeouts(config, 120_000),
      TypeError,
      "first progress timeout window",
    );
  });

  it("derives unset defaults under an outer budget shorter than both", () => {
    assertEquals(resolveHostedModelStreamTimeouts(parseAgentServiceConfig({}), 10_000), {
      firstProgressTimeoutMs: 4_999,
      semanticIdleTimeoutMs: 9_999,
    });
    assertThrows(
      () => resolveHostedModelStreamTimeouts(parseAgentServiceConfig({}), 1),
      TypeError,
      "VERYFRONT_CHAT_STREAM_IDLE_TIMEOUT_MS=1ms",
    );
  });

  it("derives the default semantic-idle budget when only first output is configured", () => {
    const config = parseAgentServiceConfig({
      VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS: "4000",
    });
    assertEquals(resolveHostedModelStreamTimeouts(config, 10_000), {
      firstProgressTimeoutMs: 4_000,
      semanticIdleTimeoutMs: 9_999,
    });
  });

  it("preserves the trusted private resolver while adding host timing", () => {
    const resolver = () => undefined;
    const config = parseAgentServiceConfig({
      VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS: "50000",
    });
    assertEquals(
      resolveHostedModelRuntimeOptions(config, { resolveModelRuntime: resolver }, 120_000),
      {
        resolveModelRuntime: resolver,
        modelStreamTimeouts: { firstProgressTimeoutMs: 50_000 },
      },
    );
    assertEquals(
      resolveHostedModelRuntimeOptions(parseAgentServiceConfig({}), {
        resolveModelRuntime: resolver,
      }, DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS),
      { resolveModelRuntime: resolver },
    );
    assertEquals(
      resolveHostedModelRuntimeOptions(
        parseAgentServiceConfig({}),
        undefined,
        DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS,
      ),
      undefined,
    );
  });
});
