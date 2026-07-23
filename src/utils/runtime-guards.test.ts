import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { hasBunRuntime, hasDenoRuntime, hasNodeProcess } from "./runtime-guards.ts";

describe("runtime-guards", () => {
  describe("hasDenoRuntime", () => {
    it("should return true for Deno-like global", () => {
      assertEquals(hasDenoRuntime({ Deno: { env: { get: () => undefined } } }), true);
    });

    it("should return false for missing Deno", () => {
      assertEquals(hasDenoRuntime({}), false);
    });

    it("should return false for Deno without env.get function", () => {
      assertEquals(hasDenoRuntime({ Deno: { env: {} } }), false);
    });

    it("should return false for null", () => {
      assertEquals(hasDenoRuntime(null), false);
    });

    it("should return false for non-object", () => {
      assertEquals(hasDenoRuntime("string"), false);
    });

    it("should return false for undefined", () => {
      assertEquals(hasDenoRuntime(undefined), false);
    });

    it("does not invoke runtime accessors", () => {
      let reads = 0;
      const accessorGlobal = Object.defineProperty({}, "Deno", {
        get() {
          reads++;
          return { env: { get: () => undefined } };
        },
      });
      const accessorRuntime = Object.defineProperty({}, "env", {
        get() {
          reads++;
          return { get: () => undefined };
        },
      });
      const accessorEnv = Object.defineProperty({}, "get", {
        get() {
          reads++;
          return () => undefined;
        },
      });

      assertEquals(hasDenoRuntime(accessorGlobal), false);
      assertEquals(hasDenoRuntime({ Deno: accessorRuntime }), false);
      assertEquals(hasDenoRuntime({ Deno: { env: accessorEnv } }), false);
      assertEquals(reads, 0);
    });

    it("reads data properties through proxies without invoking get traps", () => {
      let reads = 0;
      const handler: ProxyHandler<Record<string, unknown>> = {
        get(target, key, receiver) {
          reads++;
          return Reflect.get(target, key, receiver);
        },
      };
      const env = new Proxy({ get: () => undefined }, handler);
      const deno = new Proxy({ env }, handler);
      const global = new Proxy({ Deno: deno }, handler);

      assertEquals(hasDenoRuntime(global), true);
      assertEquals(reads, 0);
    });

    it("fails closed for revoked proxies", () => {
      const { proxy, revoke } = Proxy.revocable({ Deno: { env: { get() {} } } }, {});
      revoke();

      assertEquals(hasDenoRuntime(proxy), false);
    });

    it("fails closed when proxies violate descriptor invariants", () => {
      const proxy = new Proxy({}, {
        getOwnPropertyDescriptor() {
          return {
            configurable: false,
            enumerable: true,
            value: { env: { get() {} } },
            writable: true,
          };
        },
      });

      assertEquals(hasDenoRuntime(proxy), false);
    });

    it("recognizes the active Deno global when present", () => {
      const descriptor = Reflect.getOwnPropertyDescriptor(globalThis, "Deno");
      if (!descriptor) return;

      assertEquals(hasDenoRuntime(globalThis), true);
    });
  });

  describe("hasNodeProcess", () => {
    it("should return true for Node-like global", () => {
      assertEquals(hasNodeProcess({ process: { env: {} } }), true);
    });

    it("should return false for missing process", () => {
      assertEquals(hasNodeProcess({}), false);
    });

    it("should return false for process without env object", () => {
      assertEquals(hasNodeProcess({ process: {} }), false);
    });

    it("should return false for null", () => {
      assertEquals(hasNodeProcess(null), false);
    });

    it("returns false when process.env is null", () => {
      assertEquals(hasNodeProcess({ process: { env: null } }), false);
    });

    it("rejects array-shaped env values", () => {
      assertEquals(hasNodeProcess({ process: { env: [] } }), false);
    });

    it("does not invoke process accessors on supplied objects", () => {
      let reads = 0;
      const accessorGlobal = Object.defineProperty({}, "process", {
        get() {
          reads++;
          return { env: {} };
        },
      });
      const accessorProcess = Object.defineProperty({}, "env", {
        get() {
          reads++;
          return {};
        },
      });

      assertEquals(hasNodeProcess(accessorGlobal), false);
      assertEquals(hasNodeProcess({ process: accessorProcess }), false);
      assertEquals(reads, 0);
    });

    it("reads data properties through proxies without invoking get traps", () => {
      let reads = 0;
      const handler: ProxyHandler<Record<string, unknown>> = {
        get(target, key, receiver) {
          reads++;
          return Reflect.get(target, key, receiver);
        },
      };
      const process = new Proxy({ env: {} }, handler);
      const global = new Proxy({ process }, handler);

      assertEquals(hasNodeProcess(global), true);
      assertEquals(reads, 0);
    });

    it("fails closed for revoked proxies", () => {
      const { proxy, revoke } = Proxy.revocable({ process: { env: {} } }, {});
      revoke();

      assertEquals(hasNodeProcess(proxy), false);
    });

    it("recognizes the active Node global when present", () => {
      const descriptor = Reflect.getOwnPropertyDescriptor(globalThis, "process");
      if (!descriptor) return;

      assertEquals(hasNodeProcess(globalThis), true);
    });
  });

  describe("hasBunRuntime", () => {
    it("should return true for Bun-like global", () => {
      assertEquals(hasBunRuntime({ Bun: { version: "1.0.0" } }), true);
    });

    it("should return false for missing Bun", () => {
      assertEquals(hasBunRuntime({}), false);
    });

    it("should return false for null", () => {
      assertEquals(hasBunRuntime(null), false);
    });

    it("should return false for non-object", () => {
      assertEquals(hasBunRuntime(42), false);
    });

    it("requires a Bun object with a string version", () => {
      assertEquals(hasBunRuntime({ Bun: null }), false);
      assertEquals(hasBunRuntime({ Bun: {} }), false);
      assertEquals(hasBunRuntime({ Bun: { version: 1 } }), false);
    });

    it("does not invoke runtime accessors", () => {
      let reads = 0;
      const accessorGlobal = Object.defineProperty({}, "Bun", {
        get() {
          reads++;
          return { version: "1.0.0" };
        },
      });
      const accessorRuntime = Object.defineProperty({}, "version", {
        get() {
          reads++;
          return "1.0.0";
        },
      });

      assertEquals(hasBunRuntime(accessorGlobal), false);
      assertEquals(hasBunRuntime({ Bun: accessorRuntime }), false);
      assertEquals(reads, 0);
    });

    it("reads data properties through proxies without invoking get traps", () => {
      let reads = 0;
      const handler: ProxyHandler<Record<string, unknown>> = {
        get(target, key, receiver) {
          reads++;
          return Reflect.get(target, key, receiver);
        },
      };
      const bun = new Proxy({ version: "1.0.0" }, handler);
      const global = new Proxy({ Bun: bun }, handler);

      assertEquals(hasBunRuntime(global), true);
      assertEquals(reads, 0);
    });

    it("fails closed for revoked proxies", () => {
      const { proxy, revoke } = Proxy.revocable({ Bun: { version: "1.0.0" } }, {});
      revoke();

      assertEquals(hasBunRuntime(proxy), false);
    });

    it("recognizes the active Bun global when present", () => {
      const descriptor = Reflect.getOwnPropertyDescriptor(globalThis, "Bun");
      if (!descriptor) return;

      assertEquals(hasBunRuntime(globalThis), true);
    });

    it("does not trust nested accessors on the active global", () => {
      const original = Reflect.getOwnPropertyDescriptor(globalThis, "Bun");
      if (original) return;

      let reads = 0;
      const bun = Object.defineProperty({}, "version", {
        get() {
          reads++;
          return "1.0.0";
        },
      });
      Object.defineProperty(globalThis, "Bun", {
        configurable: true,
        value: bun,
      });
      try {
        assertEquals(hasBunRuntime(globalThis), false);
        assertEquals(reads, 0);
      } finally {
        Reflect.deleteProperty(globalThis, "Bun");
      }
    });

    it("returns false for browser-shaped globals", () => {
      const browserGlobal = { document: {}, navigator: {}, window: {} };

      assertEquals(hasDenoRuntime(browserGlobal), false);
      assertEquals(hasNodeProcess(browserGlobal), false);
      assertEquals(hasBunRuntime(browserGlobal), false);
    });
  });
});
