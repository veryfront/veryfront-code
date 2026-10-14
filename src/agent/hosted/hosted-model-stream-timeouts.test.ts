import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS } from "#veryfront/chat/stream-watchdog.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseAgentServiceConfig } from "../service/config.ts";
import {
  resolveHostedModelRuntimeOptions,
  resolveHostedModelStreamTimeouts,
} from "./hosted-model-stream-timeouts.ts";

describe("host-owned model stream timeouts", () => {
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
    for (const outerBudget of [90_000, 120_000]) {
      assertThrows(
        () => resolveHostedModelStreamTimeouts(config, outerBudget),
        TypeError,
        "first progress timeout window",
      );
    }
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

  it("rejects an outer budget shorter than unchanged model defaults", () => {
    assertThrows(() =>
      resolveHostedModelStreamTimeouts(
        parseAgentServiceConfig({}),
        30_000,
      )
    );
  });

  it("checks the default first-output budget when only semantic idle is configured", () => {
    const config = parseAgentServiceConfig({
      VERYFRONT_MODEL_STREAM_SEMANTIC_IDLE_TIMEOUT_MS: "20000",
    });
    assertThrows(() => resolveHostedModelStreamTimeouts(config, 30_000));
  });

  it("checks the default semantic-idle budget when only first output is configured", () => {
    const config = parseAgentServiceConfig({
      VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS: "4000",
    });
    assertThrows(
      () => resolveHostedModelStreamTimeouts(config, 10_000),
      TypeError,
      "semantic idle",
    );
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
