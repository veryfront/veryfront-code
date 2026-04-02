import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { fromError } from "#veryfront/errors/veryfront-error.ts";
import { isLocalAIDisabled, throwIfLocalAIDisabled } from "./env.ts";

const DISABLE_LOCAL_AI_ENV = "VERYFRONT_DISABLE_LOCAL_AI";
const originalEnv = Deno.env.get(DISABLE_LOCAL_AI_ENV);

function restoreEnv(): void {
  if (originalEnv === undefined) {
    Deno.env.delete(DISABLE_LOCAL_AI_ENV);
    return;
  }

  Deno.env.set(DISABLE_LOCAL_AI_ENV, originalEnv);
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
});
