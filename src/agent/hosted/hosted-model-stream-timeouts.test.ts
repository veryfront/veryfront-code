import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS } from "#veryfront/chat/stream-watchdog.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { parseAgentServiceConfig } from "../service/config.ts";
import {
  hostedFirstProgressWindowMs,
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
        { firstProgressTimeoutMs: 54_000 },
      );
    }
    assertEquals(warnings.length, 1);
    assertStringIncludes(warnings[0]!.message, "VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS");
    assertStringIncludes(warnings[0]!.message, "VERYFRONT_CHAT_STREAM_IDLE_TIMEOUT_MS=120000ms");
    assertStringIncludes(warnings[0]!.message, "54000ms");
  });

  it("leaves real headroom below the watchdog for the retry of a derived budget", () => {
    for (const idle of [10_000, 30_000, 120_000]) {
      const resolved = resolveHostedModelStreamTimeouts(parseAgentServiceConfig({}), idle);
      const firstProgress = resolved?.firstProgressTimeoutMs;
      if (firstProgress === undefined) throw new Error(`${idle}ms derives no budget`);
      // The whole replayed window still ends well before the outer watchdog.
      const spare = idle - hostedFirstProgressWindowMs(firstProgress);
      assertEquals(spare >= Math.max(1_000, idle * 0.1), true, `${idle}ms leaves ${spare}ms`);
      if (resolved?.semanticIdleTimeoutMs !== undefined) {
        assertEquals(idle - resolved.semanticIdleTimeoutMs >= 1_000, true);
      }
    }
  });

  it("warns once when an explicit budget leaves less than the headroom", () => {
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    const thin = parseAgentServiceConfig({
      VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS: "74999",
      VERYFRONT_MODEL_STREAM_SEMANTIC_IDLE_TIMEOUT_MS: "149000",
    });
    for (let request = 0; request < 2; request++) {
      assertEquals(resolveHostedModelStreamTimeouts(thin, 150_000, warn), {
        firstProgressTimeoutMs: 74_999,
        semanticIdleTimeoutMs: 149_000,
      });
    }
    assertEquals(warnings.length, 2);
    assertStringIncludes(warnings[0]!, "leaves only 2ms");
    assertStringIncludes(warnings[1]!, "leaves only 1000ms");
    const roomy = parseAgentServiceConfig({
      VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS: "60000",
      VERYFRONT_MODEL_STREAM_SEMANTIC_IDLE_TIMEOUT_MS: "120000",
    });
    resolveHostedModelStreamTimeouts(roomy, 150_000, warn);
    assertEquals(warnings.length, 2);
  });

  it("names the env vars and effective values when an explicit budget does not fit", () => {
    const error = assertThrows(
      () =>
        resolveHostedModelStreamTimeouts(
          parseAgentServiceConfig({ VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS: "60000" }),
          120_000,
        ),
      TypeError,
    ) as Error;
    assertStringIncludes(error.message, "VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS=60000");
    assertStringIncludes(error.message, "= 120000ms");
    assertStringIncludes(error.message, "VERYFRONT_CHAT_STREAM_IDLE_TIMEOUT_MS=120000ms");
    const idleError = assertThrows(
      () =>
        resolveHostedModelStreamTimeouts(
          parseAgentServiceConfig({ VERYFRONT_MODEL_STREAM_SEMANTIC_IDLE_TIMEOUT_MS: "150000" }),
          150_000,
        ),
      TypeError,
    ) as Error;
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
      firstProgressTimeoutMs: 40_500,
      semanticIdleTimeoutMs: 20_000,
    });
    assertEquals(resolveHostedModelStreamTimeouts(config, 120_000), {
      firstProgressTimeoutMs: 54_000,
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
      firstProgressTimeoutMs: 4_500,
      semanticIdleTimeoutMs: 9_000,
    });
    assertThrows(
      () => resolveHostedModelStreamTimeouts(parseAgentServiceConfig({}), 1_000),
      TypeError,
      "VERYFRONT_CHAT_STREAM_IDLE_TIMEOUT_MS=1000ms",
    );
  });

  it("derives the default semantic-idle budget when only first output is configured", () => {
    const config = parseAgentServiceConfig({
      VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS: "4000",
    });
    assertEquals(resolveHostedModelStreamTimeouts(config, 10_000), {
      firstProgressTimeoutMs: 4_000,
      semanticIdleTimeoutMs: 9_000,
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
