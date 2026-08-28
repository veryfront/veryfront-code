import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("workflow context serialization on edge hosts", () => {
  it("preserves the owned checkpoint envelope without proxy detection", async () => {
    const moduleUrl = new URL(
      "../../../src/workflow/backends/checkpoint-retention.ts?edge-host-owned-checkpoint",
      import.meta.url,
    ).href;
    const script = `
      const host = globalThis;
      const denoDescriptor = Object.getOwnPropertyDescriptor(host, "Deno");
      const processDescriptor = Object.getOwnPropertyDescriptor(host, "process");
      Reflect.deleteProperty(host, "Deno");
      Reflect.deleteProperty(host, "process");
      let retention;
      try {
        retention = await import(${JSON.stringify(moduleUrl)});
      } finally {
        if (denoDescriptor) Object.defineProperty(host, "Deno", denoDescriptor);
        if (processDescriptor) Object.defineProperty(host, "process", processDescriptor);
      }
      const snapshot = retention.cloneOwnedCheckpointForPersistence({
        id: "checkpoint-id",
        nodeId: "node-id",
        timestamp: new Date(0),
        context: { input: {}, value: "plain" },
        nodeStates: {},
      });
      const serializedContext = JSON.stringify(snapshot.context);
      console.log(JSON.stringify({
        id: snapshot.id,
        nodeId: snapshot.nodeId,
        timestamp: snapshot.timestamp.toISOString(),
        keys: Object.keys(snapshot),
        serializedContext,
      }));
    `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config=deno.json", script],
      cwd: new URL("../../../", import.meta.url),
      stderr: "piped",
      stdout: "piped",
    }).output();

    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    const result = JSON.parse(new TextDecoder().decode(output.stdout)) as {
      id: string;
      nodeId: string;
      timestamp: string;
      keys: string[];
      serializedContext: string;
    };
    assertEquals(result.id, "checkpoint-id");
    assertEquals(result.nodeId, "node-id");
    assertEquals(result.timestamp, "1970-01-01T00:00:00.000Z");
    assertEquals(result.keys, ["id", "nodeId", "timestamp", "context", "nodeStates"]);
    assertEquals(result.serializedContext, '{"input":{},"value":"plain"}');
  });

  it("warns for hook-free built-in brands in default mode", async () => {
    const moduleUrl = new URL(
      "../../../src/workflow/context-serialization.ts?edge-host-default-builtins",
      import.meta.url,
    ).href;
    const script = `
      const host = globalThis;
      const denoDescriptor = Object.getOwnPropertyDescriptor(host, "Deno");
      const processDescriptor = Object.getOwnPropertyDescriptor(host, "process");
      Reflect.deleteProperty(host, "Deno");
      Reflect.deleteProperty(host, "process");
      let serializer;
      try {
        serializer = await import(${JSON.stringify(moduleUrl)});
      } finally {
        if (denoDescriptor) Object.defineProperty(host, "Deno", denoDescriptor);
        if (processDescriptor) Object.defineProperty(host, "process", processDescriptor);
      }
      const { __subscribeLogRecordEmitter } = await import(
        "./src/utils/logger/logger.ts"
      );
      const warnings = [];
      const unsubscribe = __subscribeLogRecordEmitter((entry) => {
        if (entry.level === "warn" && entry.component === "workflow-context") {
          warnings.push(String(entry.context?.paths));
        }
      });
      for (const value of [
        new Map([["key", "value"]]),
        new Set([1]),
        /value/,
        new Uint8Array([1]),
      ]) {
        serializer.serializeWorkflowJson({ value }, "output");
      }
      unsubscribe();
      console.log(JSON.stringify({ warnings }));
    `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config=deno.json", script],
      cwd: new URL("../../../", import.meta.url),
      stderr: "piped",
      stdout: "piped",
    }).output();

    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    const result = JSON.parse(new TextDecoder().decode(output.stdout)) as {
      warnings: string[];
    };
    assertEquals(result.warnings.length, 4);
    for (const warning of result.warnings) assertStringIncludes(warning, "object");
  });

  it("fails strict serialization closed when proxy identity cannot be verified", async () => {
    const moduleUrl = new URL(
      "../../../src/workflow/context-serialization.ts?edge-host-strict-proxy",
      import.meta.url,
    ).href;
    const script = `
      const host = globalThis;
      const denoDescriptor = Object.getOwnPropertyDescriptor(host, "Deno");
      const processDescriptor = Object.getOwnPropertyDescriptor(host, "process");
      Reflect.deleteProperty(host, "Deno");
      Reflect.deleteProperty(host, "process");
      let serializer;
      try {
        serializer = await import(${JSON.stringify(moduleUrl)});
      } finally {
        if (denoDescriptor) Object.defineProperty(host, "Deno", denoDescriptor);
        if (processDescriptor) Object.defineProperty(host, "process", processDescriptor);
      }
      let reads = 0;
      const target = { value: 1 };
      const value = new Proxy(target, {
        get(target, key, receiver) {
          reads++;
          return key === "value" ? reads : Reflect.get(target, key, receiver);
        },
        getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
        getPrototypeOf: Reflect.getPrototypeOf,
        ownKeys: Reflect.ownKeys,
      });
      try {
        serializer.serializeWorkflowJson(
          { value },
          "output",
          undefined,
          { strictContext: true },
        );
        console.log(JSON.stringify({ message: "accepted", reads }));
      } catch (error) {
        console.log(JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
          reads,
        }));
      }
    `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config=deno.json", script],
      cwd: new URL("../../../", import.meta.url),
      stderr: "piped",
      stdout: "piped",
    }).output();

    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    const result = JSON.parse(new TextDecoder().decode(output.stdout)) as {
      message: string;
      reads: number;
    };
    assertStringIncludes(result.message, "strictContext");
    assertStringIncludes(result.message, "Proxy");
    assertEquals(result.reads, 0);
  });

  it("does not invoke a Symbol.toStringTag getter before taking the JSON snapshot", async () => {
    const moduleUrl = new URL(
      "../../../src/workflow/context-serialization.ts?edge-host-child",
      import.meta.url,
    ).href;
    const script = `
      const host = globalThis;
      const denoDescriptor = Object.getOwnPropertyDescriptor(host, "Deno");
      const processDescriptor = Object.getOwnPropertyDescriptor(host, "process");
      Reflect.deleteProperty(host, "Deno");
      Reflect.deleteProperty(host, "process");
      let serializer;
      try {
        serializer = await import(${JSON.stringify(moduleUrl)});
      } finally {
        if (denoDescriptor) Object.defineProperty(host, "Deno", denoDescriptor);
        if (processDescriptor) Object.defineProperty(host, "process", processDescriptor);
      }
      let tagReads = 0;
      const value = Object.defineProperty({ kept: 1 }, Symbol.toStringTag, {
        get() {
          tagReads++;
          value.kept = 2;
          return "Object";
        },
      });
      const serialized = serializer.serializeWorkflowJson(value, "output");
      console.log(JSON.stringify({ serialized, tagReads }));
    `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config=deno.json", script],
      cwd: new URL("../../../", import.meta.url),
      stderr: "piped",
      stdout: "piped",
    }).output();

    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    assertEquals(
      JSON.parse(new TextDecoder().decode(output.stdout)),
      { serialized: '{"kept":1}', tagReads: 0 },
    );
  });
});
