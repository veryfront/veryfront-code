import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseAgentServiceConfig } from "../service/config.ts";
import {
  resolveHostedModelRuntimeOptions,
  resolveHostedModelStreamTimeouts,
} from "./hosted-model-stream-timeouts.ts";

describe("host-owned model stream timeouts", () => {
  it("keeps framework defaults when the host has no override", () => {
    assertEquals(resolveHostedModelStreamTimeouts(parseAgentServiceConfig({}), 120_000), undefined);
  });

  it("passes only explicit model stream budgets", () => {
    const config = parseAgentServiceConfig({
      VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS: "90000",
      VERYFRONT_MODEL_STREAM_SEMANTIC_IDLE_TIMEOUT_MS: "20000",
    });
    assertEquals(resolveHostedModelStreamTimeouts(config, 120_000), {
      firstProgressTimeoutMs: 90_000,
      semanticIdleTimeoutMs: 20_000,
    });
  });

  it("requires the outer stream watchdog to exceed each model budget", () => {
    const config = parseAgentServiceConfig({
      VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS: "120000",
    });
    assertThrows(() => resolveHostedModelStreamTimeouts(config, 120_000));
    assertEquals(resolveHostedModelStreamTimeouts(config, 150_000), {
      firstProgressTimeoutMs: 120_000,
    });
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
      VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS: "9000",
    });
    assertThrows(() => resolveHostedModelStreamTimeouts(config, 10_000));
  });

  it("preserves the trusted private resolver while adding host timing", () => {
    const resolver = () => undefined;
    const config = parseAgentServiceConfig({
      VERYFRONT_MODEL_STREAM_FIRST_PROGRESS_TIMEOUT_MS: "90000",
    });
    assertEquals(
      resolveHostedModelRuntimeOptions(config, { resolveModelRuntime: resolver }, 120_000),
      {
        resolveModelRuntime: resolver,
        modelStreamTimeouts: { firstProgressTimeoutMs: 90_000 },
      },
    );
    assertEquals(
      resolveHostedModelRuntimeOptions(parseAgentServiceConfig({}), {
        resolveModelRuntime: resolver,
      }, 120_000),
      { resolveModelRuntime: resolver },
    );
    assertEquals(
      resolveHostedModelRuntimeOptions(parseAgentServiceConfig({}), undefined, 120_000),
      undefined,
    );
  });
});
