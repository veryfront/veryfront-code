import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { DenoAdapter, denoAdapter } from "./deno.ts";

describe("deno.ts exports", () => {
  describe("DenoAdapter class", () => {
    it("should export DenoAdapter class", () => {
      assertExists(DenoAdapter);
      assertEquals(typeof DenoAdapter, "function");
    });
  });

  describe("denoAdapter singleton", () => {
    it("should export denoAdapter instance", () => {
      assertExists(denoAdapter);
    });

    it("should have correct id", () => {
      assertEquals(denoAdapter.id, "deno");
    });

    it("should have correct name", () => {
      assertEquals(denoAdapter.name, "deno");
    });

    it("should have fs adapter", () => {
      assertExists(denoAdapter.fs);
      assertExists(denoAdapter.fs.readFile);
      assertExists(denoAdapter.fs.writeFile);
      assertExists(denoAdapter.fs.exists);
    });

    it("should have env adapter", () => {
      assertExists(denoAdapter.env);
      assertExists(denoAdapter.env.get);
      assertExists(denoAdapter.env.set);
      assertExists(denoAdapter.env.toObject);
    });

    it("should have capabilities", () => {
      assertExists(denoAdapter.capabilities);
      assertEquals(denoAdapter.capabilities.typescript, true);
      assertEquals(denoAdapter.capabilities.jsx, true);
    });

    it("should have serve method", () => {
      assertExists(denoAdapter.serve);
      assertEquals(typeof denoAdapter.serve, "function");
    });

    it("should have server adapter", () => {
      assertExists(denoAdapter.server);
      assertExists(denoAdapter.server.upgradeWebSocket);
    });
  });
});
