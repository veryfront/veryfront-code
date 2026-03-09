import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RenderHandler } from "./render-handler.ts";

describe("server/services/rsc/orchestrators/render-handler", () => {
  describe("handle", () => {
    it("returns error response when component is not found", async () => {
      const handler = new RenderHandler(
        "/tmp/nonexistent-project",
        () => null,
        false,
      );

      const response = await handler.handle("/nonexistent", new URLSearchParams());
      // Should get an error response (component not found or renderer not initialized)
      assertEquals(response.status >= 400, true);
    });

    it("returns error response when renderer is null", async () => {
      // RenderHandler with a getRenderer that returns null
      // The component path won't resolve, so we get "Component not found"
      const handler = new RenderHandler(
        "/tmp/nonexistent",
        () => null,
        false,
      );

      const response = await handler.handle("/some-page", new URLSearchParams());
      assertEquals(response.status >= 400, true);
      const body = await response.text();
      // Should include error information
      assertEquals(body.length > 0, true);
    });

    it("returns error response as JSON with proper content type", async () => {
      const handler = new RenderHandler(
        "/tmp/nonexistent",
        () => null,
        false,
      );

      const response = await handler.handle("/test", new URLSearchParams());
      const contentType = response.headers.get("content-type");
      // Error responses should be JSON
      assertEquals(contentType?.includes("json") ?? false, true);
    });

    it("handles root pathname", async () => {
      const handler = new RenderHandler(
        "/tmp/nonexistent",
        () => null,
        false,
      );

      const response = await handler.handle("/", new URLSearchParams());
      // Should fail gracefully since project doesn't exist
      assertEquals(response.status >= 400, true);
    });

    it("handles pathname with search params", async () => {
      const handler = new RenderHandler(
        "/tmp/nonexistent",
        () => null,
        false,
      );

      const params = new URLSearchParams({ foo: "bar", baz: "qux" });
      const response = await handler.handle("/page", params);
      assertEquals(response.status >= 400, true);
    });
  });
});
