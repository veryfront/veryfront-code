import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { fromError } from "#veryfront/errors/veryfront-error.ts";
import {
  getLocalAIDevice,
  getLocalAIThinkingEnabled,
  isLocalAIDisabled,
  throwIfLocalAIDisabled,
} from "./env.ts";

const DISABLE_LOCAL_AI_ENV = "VERYFRONT_DISABLE_LOCAL_AI";
const LOCAL_AI_DEVICE_ENV = "VERYFRONT_LOCAL_AI_DEVICE";
const LOCAL_AI_THINKING_ENV = "VERYFRONT_LOCAL_AI_THINKING";
const originalEnv = Deno.env.get(DISABLE_LOCAL_AI_ENV);
const originalDeviceEnv = Deno.env.get(LOCAL_AI_DEVICE_ENV);
const originalThinkingEnv = Deno.env.get(LOCAL_AI_THINKING_ENV);

function restoreEnv(): void {
  if (originalEnv === undefined) {
    Deno.env.delete(DISABLE_LOCAL_AI_ENV);
  } else {
    Deno.env.set(DISABLE_LOCAL_AI_ENV, originalEnv);
  }

  if (originalDeviceEnv === undefined) {
    Deno.env.delete(LOCAL_AI_DEVICE_ENV);
  } else {
    Deno.env.set(LOCAL_AI_DEVICE_ENV, originalDeviceEnv);
  }

  if (originalThinkingEnv === undefined) {
    Deno.env.delete(LOCAL_AI_THINKING_ENV);
  } else {
    Deno.env.set(LOCAL_AI_THINKING_ENV, originalThinkingEnv);
  }
}

describe("provider/local/env", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("detects when local AI is disabled", () => {
    Deno.env.set(DISABLE_LOCAL_AI_ENV, "1");
    assertEquals(isLocalAIDisabled(), true);
  });

  it("throws a no_ai_available error when local AI is disabled", () => {
    Deno.env.set(DISABLE_LOCAL_AI_ENV, "1");

    let error: unknown;

    try {
      throwIfLocalAIDisabled();
    } catch (caught) {
      error = caught;
    }

    const vfError = fromError(error);

    assertEquals(vfError?.type, "no_ai_available");
    assertEquals(error instanceof Error, true);
    assertEquals(
      (error as Error).message,
      "Local AI disabled via VERYFRONT_DISABLE_LOCAL_AI environment variable.",
    );
  });

  it("is a no-op when local AI is enabled", () => {
    Deno.env.delete(DISABLE_LOCAL_AI_ENV);
    throwIfLocalAIDisabled();
  });

  it("uses CPU as the default local AI device", () => {
    Deno.env.delete(LOCAL_AI_DEVICE_ENV);
    assertEquals(getLocalAIDevice(), "cpu");
  });

  it("accepts explicit WebGPU local AI device", () => {
    Deno.env.set(LOCAL_AI_DEVICE_ENV, "WEBGPU");
    assertEquals(getLocalAIDevice(), "webgpu");
  });

  it("rejects unsupported local AI devices", () => {
    Deno.env.set(LOCAL_AI_DEVICE_ENV, "metal");

    let error: unknown;

    try {
      getLocalAIDevice();
    } catch (caught) {
      error = caught;
    }

    const vfError = fromError(error);

    assertEquals(vfError?.type, "config");
    assertEquals(
      (error as Error).message,
      'Invalid VERYFRONT_LOCAL_AI_DEVICE value "metal". Supported values are "cpu" and "webgpu".',
    );
  });

  it("disables local AI thinking by default", () => {
    Deno.env.delete(LOCAL_AI_THINKING_ENV);
    assertEquals(getLocalAIThinkingEnabled(), false);
  });

  it("accepts explicit local AI thinking enable values", () => {
    Deno.env.set(LOCAL_AI_THINKING_ENV, "YES");
    assertEquals(getLocalAIThinkingEnabled(), true);
  });

  it("accepts explicit local AI thinking disable values", () => {
    Deno.env.set(LOCAL_AI_THINKING_ENV, "off");
    assertEquals(getLocalAIThinkingEnabled(), false);
  });

  it("rejects unsupported local AI thinking values", () => {
    Deno.env.set(LOCAL_AI_THINKING_ENV, "maybe");

    let error: unknown;

    try {
      getLocalAIThinkingEnabled();
    } catch (caught) {
      error = caught;
    }

    const vfError = fromError(error);

    assertEquals(vfError?.type, "config");
    assertEquals(
      (error as Error).message,
      'Invalid VERYFRONT_LOCAL_AI_THINKING value "maybe". Supported values are "1", "true", "yes", "on", "0", "false", "no", and "off".',
    );
  });
});
