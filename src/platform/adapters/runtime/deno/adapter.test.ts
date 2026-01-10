import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { DenoAdapter, denoAdapter } from "./adapter.ts";

describe("DenoAdapter", () => {
  describe("class instantiation", () => {
    it("should be instantiable", () => {
      const adapter = new DenoAdapter();
      assertExists(adapter);
    });

    it("should have correct id", () => {
      const adapter = new DenoAdapter();
      assertEquals(adapter.id, "deno");
    });

    it("should have correct name", () => {
      const adapter = new DenoAdapter();
      assertEquals(adapter.name, "deno");
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
      assertExists(denoAdapter.fs.readFile);
      assertEquals(typeof denoAdapter.fs.readFile, "function");
    });

    it("should have readFileBytes method", () => {
      assertExists(denoAdapter.fs.readFileBytes);
      assertEquals(typeof denoAdapter.fs.readFileBytes, "function");
    });

    it("should have writeFile method", () => {
      assertExists(denoAdapter.fs.writeFile);
      assertEquals(typeof denoAdapter.fs.writeFile, "function");
    });

    it("should have exists method", () => {
      assertExists(denoAdapter.fs.exists);
      assertEquals(typeof denoAdapter.fs.exists, "function");
    });

    it("should have readDir method", () => {
      assertExists(denoAdapter.fs.readDir);
      assertEquals(typeof denoAdapter.fs.readDir, "function");
    });

    it("should have stat method", () => {
      assertExists(denoAdapter.fs.stat);
      assertEquals(typeof denoAdapter.fs.stat, "function");
    });

    it("should have mkdir method", () => {
      assertExists(denoAdapter.fs.mkdir);
      assertEquals(typeof denoAdapter.fs.mkdir, "function");
    });

    it("should have remove method", () => {
      assertExists(denoAdapter.fs.remove);
      assertEquals(typeof denoAdapter.fs.remove, "function");
    });

    it("should have makeTempDir method", () => {
      assertExists(denoAdapter.fs.makeTempDir);
      assertEquals(typeof denoAdapter.fs.makeTempDir, "function");
    });

    it("should have watch method", () => {
      assertExists(denoAdapter.fs.watch);
      assertEquals(typeof denoAdapter.fs.watch, "function");
    });
  });

  describe("env adapter", () => {
    it("should have env adapter", () => {
      assertExists(denoAdapter.env);
    });

    it("should have get method", () => {
      assertExists(denoAdapter.env.get);
      assertEquals(typeof denoAdapter.env.get, "function");
    });

    it("should have set method", () => {
      assertExists(denoAdapter.env.set);
      assertEquals(typeof denoAdapter.env.set, "function");
    });

    it("should have toObject method", () => {
      assertExists(denoAdapter.env.toObject);
      assertEquals(typeof denoAdapter.env.toObject, "function");
    });
  });

  describe("server adapter", () => {
    it("should have server adapter", () => {
      assertExists(denoAdapter.server);
    });

    it("should have upgradeWebSocket method", () => {
      assertExists(denoAdapter.server.upgradeWebSocket);
      assertEquals(typeof denoAdapter.server.upgradeWebSocket, "function");
    });
  });

  describe("shell adapter", () => {
    it("should have shell adapter", () => {
      assertExists(denoAdapter.shell);
    });

    it("should have statSync method", () => {
      assertExists(denoAdapter.shell.statSync);
      assertEquals(typeof denoAdapter.shell.statSync, "function");
    });

    it("should have readFileSync method", () => {
      assertExists(denoAdapter.shell.readFileSync);
      assertEquals(typeof denoAdapter.shell.readFileSync, "function");
    });
  });

  describe("serve method", () => {
    it("should have serve method", () => {
      assertExists(denoAdapter.serve);
      assertEquals(typeof denoAdapter.serve, "function");
    });
  });

  describe("shutdown method", () => {
    it("should have shutdown method", () => {
      assertExists(denoAdapter.shutdown);
      assertEquals(typeof denoAdapter.shutdown, "function");
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
