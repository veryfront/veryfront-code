import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  assertEquals,
  assertInstanceOf,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { serializeWorkflowContext } from "#veryfront/workflow/context-serialization.ts";

describe("workflow context serialization with hostile ambient intrinsics", () => {
  it("uses admitted JSON, object, reflection, and array primitives", () => {
    const originalStringify = JSON.stringify;
    const originalKeys = Object.keys;
    const originalGet = Reflect.get;
    const originalPush = Array.prototype.push;
    let serialized = "";
    try {
      JSON.stringify = (() => "{}") as typeof JSON.stringify;
      Object.keys = (() => []) as typeof Object.keys;
      Reflect.get = (() => undefined) as typeof Reflect.get;
      Array.prototype.push = function () {
        return this.length;
      };
      serialized = serializeWorkflowContext({
        input: {},
        step: { values: [1, 2], nested: { ok: true } },
      });
    } finally {
      JSON.stringify = originalStringify;
      Object.keys = originalKeys;
      Reflect.get = originalGet;
      Array.prototype.push = originalPush;
    }

    assertEquals(JSON.parse(serialized), {
      input: {},
      step: { values: [1, 2], nested: { ok: true } },
    });
  });

  it("detects cycles after Set methods are replaced", () => {
    const originalHas = Set.prototype.has;
    const originalAdd = Set.prototype.add;
    const originalDelete = Set.prototype.delete;
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let error: unknown;
    try {
      Set.prototype.has = () => false;
      Set.prototype.add = function () {
        return this;
      };
      Set.prototype.delete = () => false;
      error = assertThrows(
        () => serializeWorkflowContext({ input: {}, step: cyclic }),
      );
    } finally {
      Set.prototype.has = originalHas;
      Set.prototype.add = originalAdd;
      Set.prototype.delete = originalDelete;
    }

    assertInstanceOf(error, VeryfrontError);
    assertStringIncludes(error.message, "context.step.self");
    assertStringIncludes(error.message, "circular reference");
  });

  it("keeps sensitive path segments redacted after RegExp execution is replaced", () => {
    const originalExec = RegExp.prototype.exec;
    let error: unknown;
    try {
      RegExp.prototype.exec = (() => ({ 0: "matched", index: 0 })) as never;
      error = assertThrows(() =>
        serializeWorkflowContext({
          input: {},
          step: { "user@example.com": 1n },
        })
      );
    } finally {
      RegExp.prototype.exec = originalExec;
    }

    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.message.includes("user@example.com"), false);
    assertStringIncludes(error.message, "<redacted>");
  });
});
