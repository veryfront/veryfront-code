import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { webhook } from "#veryfront/webhook";
import { discoverSourceTriggers } from "#veryfront/trigger/discovery.ts";
import { resolveTriggerTarget } from "#veryfront/trigger/target.ts";
import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";

it("validates webhook control characters without invoking a replaced codePointAt", () => {
  const original = String.prototype.codePointAt;
  const errors: unknown[] = [];
  let calls = 0;
  try {
    String.prototype.codePointAt = () => {
      calls++;
      return 65;
    };
    for (
      const fields of [
        { name: "unsafe\u0001name" },
        { description: "unsafe\u0001description" },
        {
          eventFilter: {
            mode: "all",
            conditions: [{ path: "unsafe\u0001path", operator: "exists" }],
          },
        },
      ]
    ) {
      try {
        webhook(
          { id: "intrinsic-check", target: { kind: "task", id: "task" }, ...fields } as never,
        );
      } catch (error) {
        errors.push(error);
      }
    }
  } finally {
    String.prototype.codePointAt = original;
  }
  assertEquals(calls, 0);
  assertEquals(errors.length, 3);
  for (const error of errors) {
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "webhook-config-invalid");
  }
});

it("preserves bounded webhook and target diagnostics with a throwing codePointAt", () => {
  const key = "x".repeat(79) + "😀" + "tail";
  const target = { kind: "task", id: "task", [key]: true };
  const expectedTarget = resolveTriggerTarget("target", target);
  function webhookDiagnostic(): string {
    try {
      webhook(
        { id: "intrinsic-check", target: { kind: "task", id: "task" }, [key]: true } as never,
      );
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("Expected unsupported key rejection");
  }
  const expectedWebhook = webhookDiagnostic();
  const original = String.prototype.codePointAt;
  let calls = 0;
  let actualTarget: unknown;
  let actualWebhook: unknown;
  try {
    String.prototype.codePointAt = () => {
      calls++;
      throw new Error("project hook");
    };
    actualTarget = resolveTriggerTarget("target", target);
    actualWebhook = webhookDiagnostic();
  } finally {
    String.prototype.codePointAt = original;
  }
  assertEquals(calls, 0);
  assertEquals(actualTarget, expectedTarget);
  assertEquals(actualWebhook, expectedWebhook);
});

it("rejects control characters in discovery paths without invoking codePointAt hooks", async () => {
  const original = String.prototype.codePointAt;
  let calls = 0;
  let error: unknown;
  try {
    String.prototype.codePointAt = () => {
      calls++;
      return 65;
    };
    try {
      await discoverSourceTriggers({
        projectDir: "/project\u0001",
        triggerDir: "webhooks",
        sourceKind: "webhook",
        adapter: undefined as never,
        validate: (value: unknown): value is { id: string } =>
          typeof value === "object" && value !== null,
      });
    } catch (cause) {
      error = cause;
    }
  } finally {
    String.prototype.codePointAt = original;
  }
  assertEquals(calls, 0);
  assertInstanceOf(error, VeryfrontError);
  assertEquals(error.slug, "trigger-config-invalid");
});
