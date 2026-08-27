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
  it("keeps strict serialization usable for plain objects when brand checks are unavailable", async () => {
    const script = `
      Object.defineProperty(globalThis, "caches", {
        configurable: true,
        value: {},
      });
      Object.defineProperty(globalThis, "WebSocketPair", {
        configurable: true,
        value: function WebSocketPair() {},
      });

      const { canIdentifyProxyWithoutHooks } = await import(
        "./src/platform/compat/error-introspection.ts"
      );
      const { serializeWorkflowContext } = await import(
        "./src/workflow/context-serialization.ts"
      );
      const serialized = serializeWorkflowContext(
        { input: {}, step: { ok: true, nested: { value: 1 } } },
        "run-edge-strict",
        { strictContext: true },
      );
      console.log(JSON.stringify({ canIdentifyProxyWithoutHooks, serialized }));
    `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config=deno.json", script],
      cwd: new URL("../../../", import.meta.url),
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.code, 0, stderr);
    assertEquals(
      JSON.parse(new TextDecoder().decode(output.stdout)),
      {
        canIdentifyProxyWithoutHooks: false,
        serialized: '{"input":{},"step":{"ok":true,"nested":{"value":1}}}',
      },
    );
  });

  it("rejects class instances in strict mode when brand checks are unavailable", async () => {
    const script = `
      Object.defineProperty(globalThis, "caches", {
        configurable: true,
        value: {},
      });
      Object.defineProperty(globalThis, "WebSocketPair", {
        configurable: true,
        value: function WebSocketPair() {},
      });

      const { canIdentifyProxyWithoutHooks } = await import(
        "./src/platform/compat/error-introspection.ts"
      );
      const { serializeWorkflowContext } = await import(
        "./src/workflow/context-serialization.ts"
      );

      class Receipt {
        total = 7;
      }
      class Rows extends Array {}

      const failures = [];
      for (const [name, value] of [
        ["receipt", new Receipt()],
        ["rows", new Rows(1, 2)],
      ]) {
        try {
          serializeWorkflowContext(
            { input: {}, step: { [name]: value } },
            "run-edge-strict",
            { strictContext: true },
          );
          failures.push({ name, message: "accepted" });
        } catch (error) {
          failures.push({ name, message: error instanceof Error ? error.message : String(error) });
        }
      }

      console.log(JSON.stringify({ canIdentifyProxyWithoutHooks, failures }));
    `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config=deno.json", script],
      cwd: new URL("../../../", import.meta.url),
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.code, 0, stderr);
    const result = JSON.parse(new TextDecoder().decode(output.stdout)) as {
      canIdentifyProxyWithoutHooks: boolean;
      failures: Array<{ name: string; message: string }>;
    };

    assertEquals(result.canIdentifyProxyWithoutHooks, false);
    for (const failure of result.failures) {
      assertStringIncludes(failure.message, "strictContext");
      assertStringIncludes(failure.message, `context.step.${failure.name}`);
    }
  });

  it("rejects known non-plain built-ins in strict mode when brand checks are unavailable", async () => {
    const script = `
      Object.defineProperty(globalThis, "caches", {
        configurable: true,
        value: {},
      });
      Object.defineProperty(globalThis, "WebSocketPair", {
        configurable: true,
        value: function WebSocketPair() {},
      });

      const { canIdentifyProxyWithoutHooks } = await import(
        "./src/platform/compat/error-introspection.ts"
      );
      const { serializeWorkflowContext } = await import(
        "./src/workflow/context-serialization.ts"
      );

      const failures = [];
      for (const [name, value] of [
        ["map", new Map([["a", 1]])],
        ["set", new Set([1])],
        ["regexp", /abc/],
        ["error", new Error("not persisted as an error")],
        ["typedArray", new Uint8Array([1, 2])],
        ["arrayBuffer", new ArrayBuffer(2)],
        ["dataView", new DataView(new ArrayBuffer(2))],
      ]) {
        try {
          serializeWorkflowContext(
            { input: {}, step: { [name]: value } },
            "run-edge-strict",
            { strictContext: true },
          );
          failures.push({ name, message: "accepted" });
        } catch (error) {
          failures.push({ name, message: error instanceof Error ? error.message : String(error) });
        }
      }

      console.log(JSON.stringify({ canIdentifyProxyWithoutHooks, failures }));
    `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config=deno.json", script],
      cwd: new URL("../../../", import.meta.url),
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.code, 0, stderr);
    const result = JSON.parse(new TextDecoder().decode(output.stdout)) as {
      canIdentifyProxyWithoutHooks: boolean;
      failures: Array<{ name: string; message: string }>;
    };

    assertEquals(result.canIdentifyProxyWithoutHooks, false);
    for (const failure of result.failures) {
      assertStringIncludes(failure.message, "strictContext");
      assertStringIncludes(failure.message, `context.step.${failure.name}`);
    }
  });

  it("rejects enumerable named array properties in strict mode when brand checks are unavailable", async () => {
    const script = `
      Object.defineProperty(globalThis, "caches", {
        configurable: true,
        value: {},
      });
      Object.defineProperty(globalThis, "WebSocketPair", {
        configurable: true,
        value: function WebSocketPair() {},
      });

      const { canIdentifyProxyWithoutHooks } = await import(
        "./src/platform/compat/error-introspection.ts"
      );
      const { serializeWorkflowContext } = await import(
        "./src/workflow/context-serialization.ts"
      );

      const rows = [1, 2];
      Object.defineProperty(rows, "meta", {
        value: "diagnostic-only",
        enumerable: true,
      });

      try {
        serializeWorkflowContext(
          { input: {}, step: { rows } },
          "run-edge-strict",
          { strictContext: true },
        );
        console.log(JSON.stringify({ canIdentifyProxyWithoutHooks, message: "accepted" }));
      } catch (error) {
        console.log(JSON.stringify({
          canIdentifyProxyWithoutHooks,
          message: error instanceof Error ? error.message : String(error),
        }));
      }
    `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config=deno.json", script],
      cwd: new URL("../../../", import.meta.url),
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.code, 0, stderr);
    const result = JSON.parse(new TextDecoder().decode(output.stdout)) as {
      canIdentifyProxyWithoutHooks: boolean;
      message: string;
    };

    assertEquals(result.canIdentifyProxyWithoutHooks, false);
    assertStringIncludes(result.message, "strictContext");
    assertStringIncludes(result.message, "context.step.rows.meta");
  });

  it("rejects inherited array holes and numeric accessors in strict mode when brand checks are unavailable", async () => {
    const script = `
      Object.defineProperty(globalThis, "caches", {
        configurable: true,
        value: {},
      });
      Object.defineProperty(globalThis, "WebSocketPair", {
        configurable: true,
        value: function WebSocketPair() {},
      });

      const { canIdentifyProxyWithoutHooks } = await import(
        "./src/platform/compat/error-introspection.ts"
      );
      const { serializeWorkflowContext } = await import(
        "./src/workflow/context-serialization.ts"
      );

      const failures = [];
      let accessorReads = 0;
      let proxyOwnKeys = 0;
      const priorArrayZeroDescriptor = Object.getOwnPropertyDescriptor(
        Array.prototype,
        "0",
      );
      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        value: null,
        writable: true,
      });
      try {
        const sparse = [];
        sparse.length = 1;
        const reportedHoleTarget = [];
        reportedHoleTarget.length = 1;
        const reportedHole = new Proxy(reportedHoleTarget, {
          ownKeys() {
            proxyOwnKeys += 1;
            return ["0", "length"];
          },
          getOwnPropertyDescriptor(target, key) {
            if (key === "0") return undefined;
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        });
        const accessor = [];
        Object.defineProperty(accessor, "0", {
          enumerable: true,
          get() {
            accessorReads += 1;
            return 1;
          },
        });

        for (const [name, value] of [
          ["sparse", sparse],
          ["reportedHole", reportedHole],
          ["accessor", accessor],
        ]) {
          try {
            serializeWorkflowContext(
              { input: {}, step: { [name]: value } },
              "run-edge-strict",
              { strictContext: true },
            );
            failures.push({ name, message: "accepted" });
          } catch (error) {
            failures.push({ name, message: error instanceof Error ? error.message : String(error) });
          }
        }
      } finally {
        if (priorArrayZeroDescriptor === undefined) {
          delete Array.prototype[0];
        } else {
          Object.defineProperty(Array.prototype, "0", priorArrayZeroDescriptor);
        }
      }

      console.log(JSON.stringify({ canIdentifyProxyWithoutHooks, failures, accessorReads, proxyOwnKeys }));
    `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config=deno.json", script],
      cwd: new URL("../../../", import.meta.url),
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.code, 0, stderr);
    const result = JSON.parse(new TextDecoder().decode(output.stdout)) as {
      canIdentifyProxyWithoutHooks: boolean;
      failures: Array<{ name: string; message: string }>;
      accessorReads: number;
      proxyOwnKeys: number;
    };

    assertEquals(result.canIdentifyProxyWithoutHooks, false);
    assertStringIncludes(result.failures[0]!.message, "strictContext");
    assertStringIncludes(result.failures[0]!.message, "context.step.sparse");
    assertStringIncludes(result.failures[0]!.message, "array hole");
    assertStringIncludes(result.failures[1]!.message, "strictContext");
    assertStringIncludes(result.failures[1]!.message, "context.step.reportedHole");
    assertStringIncludes(result.failures[1]!.message, "array hole");
    assertStringIncludes(result.failures[2]!.message, "strictContext");
    assertStringIncludes(result.failures[2]!.message, "context.step.accessor[0]");
    assertStringIncludes(result.failures[2]!.message, "accessor property");
    assertEquals(result.accessorReads, 1);
    assertEquals(result.proxyOwnKeys, 1);
  });

  it("rejects enumerable symbol properties in strict mode when brand checks are unavailable", async () => {
    const script = `
      Object.defineProperty(globalThis, "caches", {
        configurable: true,
        value: {},
      });
      Object.defineProperty(globalThis, "WebSocketPair", {
        configurable: true,
        value: function WebSocketPair() {},
      });

      const { canIdentifyProxyWithoutHooks } = await import(
        "./src/platform/compat/error-introspection.ts"
      );
      const { serializeWorkflowContext } = await import(
        "./src/workflow/context-serialization.ts"
      );

      const value = {};
      Object.defineProperty(value, Symbol("required"), {
        value: 1,
        enumerable: true,
      });

      try {
        serializeWorkflowContext(
          { input: {}, step: { value } },
          "run-edge-strict",
          { strictContext: true },
        );
        console.log(JSON.stringify({ canIdentifyProxyWithoutHooks, message: "accepted" }));
      } catch (error) {
        console.log(JSON.stringify({
          canIdentifyProxyWithoutHooks,
          message: error instanceof Error ? error.message : String(error),
        }));
      }
    `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config=deno.json", script],
      cwd: new URL("../../../", import.meta.url),
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.code, 0, stderr);
    const result = JSON.parse(new TextDecoder().decode(output.stdout)) as {
      canIdentifyProxyWithoutHooks: boolean;
      message: string;
    };

    assertEquals(result.canIdentifyProxyWithoutHooks, false);
    assertStringIncludes(result.message, "strictContext");
    assertStringIncludes(result.message, "context.step.value");
    assertStringIncludes(result.message, "symbol-keyed property");
  });

  it("rejects enumerable array symbol properties in strict mode when brand checks are unavailable", async () => {
    const script = `
      Object.defineProperty(globalThis, "caches", {
        configurable: true,
        value: {},
      });
      Object.defineProperty(globalThis, "WebSocketPair", {
        configurable: true,
        value: function WebSocketPair() {},
      });

      const { canIdentifyProxyWithoutHooks } = await import(
        "./src/platform/compat/error-introspection.ts"
      );
      const { serializeWorkflowContext } = await import(
        "./src/workflow/context-serialization.ts"
      );

      const target = [1, 2];
      Object.defineProperty(target, Symbol("required"), {
        value: 1,
        enumerable: true,
      });
      let ownKeysCalls = 0;
      const rows = new Proxy(target, {
        get: Reflect.get,
        getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
        ownKeys(target) {
          ownKeysCalls += 1;
          return Reflect.ownKeys(target);
        },
      });

      try {
        serializeWorkflowContext(
          { input: {}, step: { rows } },
          "run-edge-strict",
          { strictContext: true },
        );
        console.log(JSON.stringify({ canIdentifyProxyWithoutHooks, message: "accepted", ownKeysCalls }));
      } catch (error) {
        console.log(JSON.stringify({
          canIdentifyProxyWithoutHooks,
          message: error instanceof Error ? error.message : String(error),
          ownKeysCalls,
        }));
      }
    `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config=deno.json", script],
      cwd: new URL("../../../", import.meta.url),
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.code, 0, stderr);
    const result = JSON.parse(new TextDecoder().decode(output.stdout)) as {
      canIdentifyProxyWithoutHooks: boolean;
      message: string;
      ownKeysCalls: number;
    };

    assertEquals(result.canIdentifyProxyWithoutHooks, false);
    assertEquals(result.ownKeysCalls, 1);
    assertStringIncludes(result.message, "strictContext");
    assertStringIncludes(result.message, "context.step.rows");
    assertStringIncludes(result.message, "symbol-keyed property");
  });

  it("skips diagnostic-only Proxy metadata when brand checks are unavailable", async () => {
    const script = `
      Object.defineProperty(globalThis, "caches", {
        configurable: true,
        value: {},
      });
      Object.defineProperty(globalThis, "WebSocketPair", {
        configurable: true,
        value: function WebSocketPair() {},
      });

      const { canIdentifyProxyWithoutHooks } = await import(
        "./src/platform/compat/error-introspection.ts"
      );
      const { serializeWorkflowContext } = await import(
        "./src/workflow/context-serialization.ts"
      );
      let prototypeTrapCalls = 0;
      let descriptorTrapCalls = 0;
      let ownKeysCalls = 0;
      const value = new Proxy({}, {
        getPrototypeOf() {
          prototypeTrapCalls += 1;
          throw new Error("diagnostic prototype trap must not run");
        },
        getOwnPropertyDescriptor() {
          descriptorTrapCalls += 1;
          throw new Error("diagnostic descriptor trap must not run");
        },
        ownKeys() {
          ownKeysCalls += 1;
          return [];
        },
      });
      const serialized = serializeWorkflowContext({ input: {}, step: value });
      console.log(JSON.stringify({
        canIdentifyProxyWithoutHooks,
        serialized,
        prototypeTrapCalls,
        descriptorTrapCalls,
        ownKeysCalls,
      }));
    `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config=deno.json", script],
      cwd: new URL("../../../", import.meta.url),
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.code, 0, stderr);
    assertEquals(
      JSON.parse(new TextDecoder().decode(output.stdout)),
      {
        canIdentifyProxyWithoutHooks: false,
        serialized: '{"input":{},"step":{}}',
        prototypeTrapCalls: 0,
        descriptorTrapCalls: 0,
        ownKeysCalls: 1,
      },
    );
  });

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
