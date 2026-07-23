import { assertEquals, assertStringIncludes } from "./assert.ts";
import { describe, it } from "./bdd.ts";

describe("testing/Deno BDD timeout", () => {
  it("applies an inherited suite timeout to Deno tests", async () => {
    const testFile = await Deno.makeTempFile({ prefix: "vf-bdd-timeout-", suffix: ".ts" });
    const bddUrl = new URL("./bdd.ts", import.meta.url).href;
    const configPath = await Deno.realPath(new URL("../../deno.json", import.meta.url));
    try {
      await Deno.writeTextFile(
        testFile,
        `import { describe, it } from ${JSON.stringify(bddUrl)};
describe({ name: "timeout suite", timeout: 5 }, () => {
  it("times out", () => new Promise(() => undefined));
});
`,
      );
      const result = await new Deno.Command(Deno.execPath(), {
        args: ["test", "--no-check", "--allow-all", "--config", configPath, testFile],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.success, false);
      const output = new TextDecoder().decode(result.stdout) +
        new TextDecoder().decode(result.stderr);
      assertStringIncludes(output, "Test timed out after 5ms");
    } finally {
      await Deno.remove(testFile);
    }
  });
});

describe("testing/environment overlay installation", () => {
  it("installs storage through accessor-backed sentinel slots without invoking them", async () => {
    const moduleUrl = new URL("./env-overlay.ts", import.meta.url).href;
    const configPath = await Deno.realPath(new URL("../../deno.json", import.meta.url));
    const script = `
      const storageKey = "__vfTestEnvOverlay";
      let reads = 0;
      let writes = 0;
      Object.defineProperty(globalThis, storageKey, {
        configurable: true,
        get() { reads++; return undefined; },
        set() { writes++; throw new Error("storage setter must not run"); },
      });
      const { ensureEnvOverlayStorage } = await import(${JSON.stringify(moduleUrl)});
      const first = ensureEnvOverlayStorage();
      const second = ensureEnvOverlayStorage();
      if (first !== second) throw new Error("installed storage was not rediscovered");
      if (reads !== 0 || writes !== 0) throw new Error("storage sentinel accessor executed");
    `;
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config", configPath, script],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
  });

  it("does not invoke a replaceable facade sentinel accessor", async () => {
    const moduleUrl = new URL("./env-overlay.ts", import.meta.url).href;
    const configPath = await Deno.realPath(new URL("../../deno.json", import.meta.url));
    const script = `
      const marker = Symbol.for("veryfront.testing.envOverlayFacadeInstalled");
      let reads = 0;
      let writes = 0;
      Object.defineProperty(globalThis, marker, {
        configurable: true,
        get() { reads++; return false; },
        set() { writes++; throw new Error("sentinel setter must not run"); },
      });
      const { ensureEnvOverlayRuntime } = await import(${JSON.stringify(moduleUrl)});
      const firstStorage = ensureEnvOverlayRuntime();
      const firstProcessEnv = process.env;
      const firstMethods = [Deno.env.get, Deno.env.set, Deno.env.delete, Deno.env.has, Deno.env.toObject];
      const secondStorage = ensureEnvOverlayRuntime();
      const installed = Object.getOwnPropertyDescriptor(globalThis, marker);
      if (reads !== 0 || writes !== 0) throw new Error("sentinel accessor executed");
      if (firstStorage !== secondStorage || firstProcessEnv !== process.env) {
        throw new Error("facade installation was not idempotent");
      }
      const secondMethods = [Deno.env.get, Deno.env.set, Deno.env.delete, Deno.env.has, Deno.env.toObject];
      if (firstMethods.some((method, index) => method !== secondMethods[index])) {
        throw new Error("environment methods were wrapped more than once");
      }
      if (!(installed && "value" in installed && installed.value === true)) {
        throw new Error("facade marker was not installed safely");
      }
      if (typeof process.env.toString !== "function") {
        throw new Error("process environment facade is incomplete");
      }
    `;
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config", configPath, script],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
  });

  it("fails before mutation for a non-replaceable facade sentinel", async () => {
    const moduleUrl = new URL("./env-overlay.ts", import.meta.url).href;
    const configPath = await Deno.realPath(new URL("../../deno.json", import.meta.url));
    const script = `
      const marker = Symbol.for("veryfront.testing.envOverlayFacadeInstalled");
      let reads = 0;
      const originalProcessEnv = process.env;
      Object.defineProperty(globalThis, marker, {
        configurable: false,
        get() { reads++; return false; },
      });
      const { ensureEnvOverlayRuntime } = await import(${JSON.stringify(moduleUrl)});
      let rejected = false;
      try {
        ensureEnvOverlayRuntime();
      } catch (error) {
        rejected = error instanceof TypeError;
      }
      if (!rejected) throw new Error("non-replaceable sentinel was accepted");
      if (reads !== 0) throw new Error("sentinel accessor executed");
      if (process.env !== originalProcessEnv) throw new Error("process environment was mutated");
    `;
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config", configPath, script],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
  });

  it("fails before partially patching a non-replaceable Deno environment method", async () => {
    const moduleUrl = new URL("./env-overlay.ts", import.meta.url).href;
    const configPath = await Deno.realPath(new URL("../../deno.json", import.meta.url));
    const script = `
      const marker = Symbol.for("veryfront.testing.envOverlayFacadeInstalled");
      const methodNames = ["get", "set", "delete", "has", "toObject"];
      const originals = new Map(methodNames.map((name) => [name, Deno.env[name]]));
      const originalProcessEnv = process.env;
      const setDescriptor = Object.getOwnPropertyDescriptor(Deno.env, "set");
      Object.defineProperty(Deno.env, "set", {
        ...setDescriptor,
        configurable: false,
        writable: false,
      });
      const { ensureEnvOverlayRuntime } = await import(${JSON.stringify(moduleUrl)});
      let rejected = false;
      try {
        ensureEnvOverlayRuntime();
      } catch (error) {
        rejected = error instanceof TypeError;
      }
      if (!rejected) throw new Error("non-replaceable environment method was accepted");
      for (const name of methodNames) {
        if (Deno.env[name] !== originals.get(name)) throw new Error("Deno environment was patched");
      }
      if (process.env !== originalProcessEnv) throw new Error("process environment was patched");
      if (Object.getOwnPropertyDescriptor(globalThis, marker)) {
        throw new Error("facade marker was installed after failure");
      }
    `;
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config", configPath, script],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
  });
});
