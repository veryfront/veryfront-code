import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("workflow context serialization on edge hosts", () => {
  it("does not invoke a Symbol.toStringTag getter before taking the JSON snapshot", async () => {
    const moduleUrl = new URL("./context-serialization.ts?edge-host-child", import.meta.url).href;
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
      args: ["eval", script],
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
