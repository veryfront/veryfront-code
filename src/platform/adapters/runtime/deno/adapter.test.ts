import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";

function assertFunction(value: unknown): void {
  assertExists(value);
  assertEquals(typeof value, "function");
}

if (!isDeno) {
  describe("DenoAdapter", { skip: true }, () => {
    it("skipped - not running in Deno", () => {});
  });

  describe("denoAdapter singleton", { skip: true }, () => {
    it("skipped - not running in Deno", () => {});
  });
} else {
  const { DenoAdapter, denoAdapter } = await import("./adapter.ts");

  describe("DenoAdapter", () => {
    describe("class instantiation", () => {
      it("should be instantiable", () => {
        assertExists(new DenoAdapter());
      });

      it("should have correct id", () => {
        assertEquals(new DenoAdapter().id, "deno");
      });

      it("should have correct name", () => {
        assertEquals(new DenoAdapter().name, "deno");
      });
    });

    describe("capabilities", () => {
      it("should have typescript capability", () => {
        assertEquals(denoAdapter.capabilities.typescript, true);
      });

      it("should have jsx capability", () => {
        assertEquals(denoAdapter.capabilities.jsx, true);
      });

      it("should have http2 capability", () => {
        assertEquals(denoAdapter.capabilities.http2, true);
      });

      it("should have websocket capability", () => {
        assertEquals(denoAdapter.capabilities.websocket, true);
      });

      it("should have workers capability", () => {
        assertEquals(denoAdapter.capabilities.workers, true);
      });

      it("should have fileWatching capability", () => {
        assertEquals(denoAdapter.capabilities.fileWatching, true);
      });

      it("should have shell capability", () => {
        assertEquals(denoAdapter.capabilities.shell, true);
      });

      it("should have kvStore capability", () => {
        assertEquals(denoAdapter.capabilities.kvStore, true);
      });

      it("should have writableFs capability", () => {
        assertEquals(denoAdapter.capabilities.writableFs, true);
      });
    });

    describe("fs adapter", () => {
      it("should have fs adapter", () => {
        assertExists(denoAdapter.fs);
      });

      it("should have readFile method", () => {
        assertFunction(denoAdapter.fs.readFile);
      });

      it("should have readFileBytes method", () => {
        assertFunction(denoAdapter.fs.readFileBytes);
      });

      it("should have writeFile method", () => {
        assertFunction(denoAdapter.fs.writeFile);
      });

      it("should have exists method", () => {
        assertFunction(denoAdapter.fs.exists);
      });

      it("should have readDir method", () => {
        assertFunction(denoAdapter.fs.readDir);
      });

      it("should have stat method", () => {
        assertFunction(denoAdapter.fs.stat);
      });

      it("should have mkdir method", () => {
        assertFunction(denoAdapter.fs.mkdir);
      });

      it("should have remove method", () => {
        assertFunction(denoAdapter.fs.remove);
      });

      it("should have makeTempDir method", () => {
        assertFunction(denoAdapter.fs.makeTempDir);
      });

      it("should have watch method", () => {
        assertFunction(denoAdapter.fs.watch);
      });
    });

    describe("env adapter", () => {
      it("should have env adapter", () => {
        assertExists(denoAdapter.env);
      });

      it("should have get method", () => {
        assertFunction(denoAdapter.env.get);
      });

      it("should have set method", () => {
        assertFunction(denoAdapter.env.set);
      });

      it("should have toObject method", () => {
        assertFunction(denoAdapter.env.toObject);
      });
    });

    describe("server adapter", () => {
      it("should have server adapter", () => {
        assertExists(denoAdapter.server);
      });

      it("should have upgradeWebSocket method", () => {
        assertFunction(denoAdapter.server.upgradeWebSocket);
      });
    });

    describe("shell adapter", () => {
      it("should have shell adapter", () => {
        assertExists(denoAdapter.shell);
      });

      it("should have statSync method", () => {
        assertFunction(denoAdapter.shell.statSync);
      });

      it("should have readFileSync method", () => {
        assertFunction(denoAdapter.shell.readFileSync);
      });
    });

    describe("serve method", () => {
      it("should have serve method", () => {
        assertFunction(denoAdapter.serve);
      });
    });

    describe("shutdown method", () => {
      it("should have shutdown method", () => {
        assertFunction(denoAdapter.shutdown);
      });
    });
  });

  describe("denoAdapter singleton", () => {
    it("should be an instance of DenoAdapter", () => {
      assertEquals(denoAdapter instanceof DenoAdapter, true);
    });

    it("should return consistent instance", () => {
      assertEquals(denoAdapter, denoAdapter);
    });
  });
}
