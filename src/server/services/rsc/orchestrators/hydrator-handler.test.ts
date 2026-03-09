import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { HydratorHandler } from "./hydrator-handler.ts";

// The HydratorHandler depends on esbuild for bundling.
// We test the fallback behavior when the fsAdapter fails to read the file,
// avoiding esbuild subprocess creation that causes resource leaks in tests.

describe("server/services/rsc/orchestrators/hydrator-handler", () => {
  describe("handle", () => {
    it("should return a fallback response when fsAdapter.readFile throws", async () => {
      const mockFs = {
        readFile: async () => {
          throw new Error("file not found");
        },
      };
      const handler = new HydratorHandler(mockFs as any);
      const response = await handler.handle();
      assertEquals(response instanceof Response, true);
      assertEquals(response.headers.get("content-type"), "application/javascript");

      // Should be the fallback response with hydrateRSC export
      const text = await response.text();
      assertEquals(text.includes("hydrateRSC"), true);
      assertEquals(text.includes("Hydrator not available"), true);
    });

    it("should have cache-control: no-cache on fallback response", async () => {
      const mockFs = {
        readFile: async () => {
          throw new Error("not found");
        },
      };
      const handler = new HydratorHandler(mockFs as any);
      const response = await handler.handle();
      assertEquals(response.headers.get("cache-control"), "no-cache");
    });

    it("should produce a valid JavaScript module in fallback", async () => {
      const mockFs = {
        readFile: async () => {
          throw new Error("not found");
        },
      };
      const handler = new HydratorHandler(mockFs as any);
      const response = await handler.handle();
      const text = await response.text();
      // The fallback should export an async function
      assertEquals(text.includes("export async function"), true);
    });
  });
});
