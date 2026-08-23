import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { webhook } from "#veryfront/webhook";
import {
  matchesWebhookEventFilter,
  prepareWebhookInvocation,
  renderWebhookPromptTemplate,
} from "#veryfront/webhook/runtime.ts";
import { assertEquals, assertInstanceOf, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("webhook validation with hostile ambient intrinsics", () => {
  it("does not trust a replaced Set.prototype.has when admitting operators", () => {
    const originalSetHas = Set.prototype.has;
    let error: unknown;

    try {
      Set.prototype.has = function (this: Set<unknown>, value: unknown): boolean {
        if (
          Reflect.apply(originalSetHas, this, ["equals"]) &&
          Reflect.apply(originalSetHas, this, ["contains"])
        ) {
          return true;
        }
        return Reflect.apply(originalSetHas, this, [value]) as boolean;
      };
      webhook({
        id: "unsupported-operator",
        target: { kind: "task", id: "process-event" },
        eventFilter: {
          mode: "all",
          conditions: [{ path: "action", operator: "always" as never }],
        },
      });
    } catch (cause) {
      error = cause;
    } finally {
      Set.prototype.has = originalSetHas;
    }

    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "webhook-config-invalid");
    assertStringIncludes(error.message, "operator is not supported");
  });

  it("does not trust a replaced Array.prototype.every when filtering", () => {
    const definition = webhook({
      id: "closed-event",
      target: { kind: "task", id: "process-event" },
      eventFilter: {
        mode: "all",
        conditions: [{ path: "action", operator: "equals", value: "opened" }],
      },
    });
    const originalEvery = Array.prototype.every;
    let matched: boolean | undefined;

    try {
      Array.prototype.every = (() => true) as typeof Array.prototype.every;
      matched = prepareWebhookInvocation(definition, { action: "closed" }).matched;
    } finally {
      Array.prototype.every = originalEvery;
    }

    assertEquals(matched, false);
  });

  it("does not trust a replaced JSON.stringify when bounding payloads", () => {
    const definition = webhook({
      id: "oversized-event",
      target: { kind: "task", id: "process-event" },
    });
    const originalStringify = JSON.stringify;
    const originalArrayToJson = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
    const originalByteLength = Object.getOwnPropertyDescriptor(
      Uint8Array.prototype,
      "byteLength",
    );
    let error: unknown;

    try {
      JSON.stringify = (() => "{}") as typeof JSON.stringify;
      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        value: () => null,
      });
      Object.defineProperty(Uint8Array.prototype, "byteLength", {
        configurable: true,
        get: () => 0,
      });
      prepareWebhookInvocation(definition, {
        data: Array.from({ length: 40_000 }, () => "x"),
      });
    } catch (cause) {
      error = cause;
    } finally {
      JSON.stringify = originalStringify;
      if (originalArrayToJson) {
        Object.defineProperty(Array.prototype, "toJSON", originalArrayToJson);
      } else {
        Reflect.deleteProperty(Array.prototype, "toJSON");
      }
      if (originalByteLength) {
        Object.defineProperty(Uint8Array.prototype, "byteLength", originalByteLength);
      } else {
        Reflect.deleteProperty(Uint8Array.prototype, "byteLength");
      }
    }

    assertInstanceOf(error, VeryfrontError);
    assertStringIncludes(error.message, "Webhook payload must be 64 KiB or smaller.");
  });

  it("does not trust the live array iterator for structural equality", () => {
    const originalIterator = Array.prototype[Symbol.iterator];
    let matched: boolean | undefined;
    try {
      Array.prototype[Symbol.iterator] = function* () {
        yield this[0];
        yield this[0];
      };
      matched = matchesWebhookEventFilter(
        {
          mode: "all",
          conditions: [{ path: "action", operator: "equals", value: "opened" }],
        },
        { action: "closed" },
      );
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
    }
    assertEquals(matched, false);
  });

  it("renders placeholders without the live RegExp replace protocol", () => {
    const originalReplace = RegExp.prototype[Symbol.replace];
    let rendered: string | undefined;
    try {
      RegExp.prototype[Symbol.replace] = () => "poisoned";
      rendered = renderWebhookPromptTemplate(
        "Review {{payload.action}}.",
        { action: "opened" },
      );
    } finally {
      RegExp.prototype[Symbol.replace] = originalReplace;
    }
    assertEquals(rendered, "Review opened.");
  });
});
