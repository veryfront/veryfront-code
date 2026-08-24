import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { schedule } from "#veryfront/schedule";
import { captureScheduleIntegrationRequirementsConfig } from "#veryfront/schedule/validation.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("schedule validation with hostile ambient intrinsics", () => {
  it("does not trust a replaced Intl.DateTimeFormat constructor", () => {
    const originalDateTimeFormat = Intl.DateTimeFormat;
    class PoisonedDateTimeFormat {
      format(): string {
        return "accepted";
      }
    }

    try {
      Intl.DateTimeFormat = PoisonedDateTimeFormat as unknown as typeof Intl.DateTimeFormat;

      assertThrows(
        () =>
          schedule({
            id: "invalid-timezone",
            schedule: "0 8 * * *",
            timezone: "Mars/Olympus",
            target: { kind: "task", id: "run-calendar-sweep" },
          }),
        VeryfrontError,
        "Schedule timezone must be a supported IANA timezone name.",
      );
    } finally {
      Intl.DateTimeFormat = originalDateTimeFormat;
    }
  });

  it("captures integration requirements without ambient collection methods", () => {
    const originalArrayIterator = Array.prototype[Symbol.iterator];
    const originalArrayMap = Array.prototype.map;
    const originalArrayPush = Array.prototype.push;
    const originalArraySome = Array.prototype.some;
    const originalArrayZeroDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    const originalDefineProperty = Object.defineProperty;
    const originalDeleteProperty = Reflect.deleteProperty;
    const originalRegExpExec = RegExp.prototype.exec;
    const originalRegExpTest = RegExp.prototype.test;
    const originalSetAdd = Set.prototype.add;
    const originalSetHas = Set.prototype.has;
    const originalStringConstructor = globalThis.String;
    const originalStringCharCodeAt = String.prototype.charCodeAt;
    const originalStringSlice = String.prototype.slice;
    const originalStringTrim = String.prototype.trim;
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls += 1;
      throw new Error("ambient metadata collection method must not run");
    };
    let captured: ReturnType<typeof captureScheduleIntegrationRequirementsConfig>;

    try {
      originalDefineProperty(Array.prototype, "0", {
        configurable: true,
        set(this: unknown[], next: unknown) {
          if (
            typeof next === "object" && next !== null &&
            (next as { integration?: unknown }).integration === "slack"
          ) {
            poisonCalls += 1;
            return;
          }
          originalDefineProperty(this, "0", {
            value: next,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        },
      });
      Array.prototype[Symbol.iterator] = poison as typeof originalArrayIterator;
      Array.prototype.map = poison as typeof Array.prototype.map;
      Array.prototype.push = poison as typeof Array.prototype.push;
      Array.prototype.some = poison as typeof Array.prototype.some;
      RegExp.prototype.exec = poison as typeof RegExp.prototype.exec;
      RegExp.prototype.test = poison as typeof RegExp.prototype.test;
      Set.prototype.add = poison as typeof Set.prototype.add;
      Set.prototype.has = poison as typeof Set.prototype.has;
      String.prototype.charCodeAt = poison as typeof String.prototype.charCodeAt;
      String.prototype.slice = poison as typeof String.prototype.slice;
      String.prototype.trim = poison as typeof String.prototype.trim;
      globalThis.String = poison as unknown as StringConstructor;

      captured = captureScheduleIntegrationRequirementsConfig(
        [{
          integration: "slack",
          requiredScopes: ["channels:read"],
          resources: [{
            kind: "channel",
            id: "C012345",
            parent: { kind: "workspace", id: "T012345" },
          }],
        }],
        "Task",
      );
    } finally {
      Array.prototype[Symbol.iterator] = originalArrayIterator;
      Array.prototype.map = originalArrayMap;
      Array.prototype.push = originalArrayPush;
      Array.prototype.some = originalArraySome;
      RegExp.prototype.exec = originalRegExpExec;
      RegExp.prototype.test = originalRegExpTest;
      Set.prototype.add = originalSetAdd;
      Set.prototype.has = originalSetHas;
      globalThis.String = originalStringConstructor;
      String.prototype.charCodeAt = originalStringCharCodeAt;
      String.prototype.slice = originalStringSlice;
      String.prototype.trim = originalStringTrim;
      if (originalArrayZeroDescriptor) {
        originalDefineProperty(Array.prototype, "0", originalArrayZeroDescriptor);
      } else {
        originalDeleteProperty(Array.prototype, "0");
      }
    }

    assertEquals(poisonCalls, 0);
    assertEquals(captured, [{
      integration: "slack",
      requiredScopes: ["channels:read"],
      resources: [{
        kind: "channel",
        id: "C012345",
        parent: { kind: "workspace", id: "T012345" },
      }],
    }]);
  });

  it("compares duplicate resources without ambient array serialization", () => {
    const originalArrayToJsonDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "toJSON",
    );
    let toJsonCalls = 0;

    try {
      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        value() {
          toJsonCalls += 1;
          return [toJsonCalls];
        },
      });
      assertThrows(
        () =>
          schedule({
            id: "duplicate-resources",
            schedule: "0 9 * * 1-5",
            target: { kind: "workflow", id: "post-slack-digest" },
            integrationRequirements: [{
              integration: "slack",
              resources: [
                { kind: "channel", id: "C012345" },
                { kind: "channel", id: "C012345" },
              ],
            }],
          }),
        VeryfrontError,
        "Schedule integrationRequirements[0].resources contains a duplicate resource identity.",
      );
    } finally {
      if (originalArrayToJsonDescriptor) {
        Object.defineProperty(Array.prototype, "toJSON", originalArrayToJsonDescriptor);
      } else {
        Reflect.deleteProperty(Array.prototype, "toJSON");
      }
    }

    assertEquals(toJsonCalls, 0);
  });
});
