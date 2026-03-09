import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isUsingEsbuild, transformJsx } from "./transform.ts";

// esbuild starts a child process that lives across tests, so we disable sanitizers
describe("platform/compat/transform", { sanitizeOps: false, sanitizeResources: false }, () => {
  describe("isUsingEsbuild", () => {
    it("should return true", () => {
      assertEquals(isUsingEsbuild(), true);
    });
  });

  describe("transformJsx", () => {
    it("should transform TSX to JS", async () => {
      const result = await transformJsx(
        `const App = () => <div>Hello</div>;`,
        { loader: "tsx" },
      );

      assertExists(result.code);
      assertEquals(typeof result.code, "string");
      assertEquals(result.code.includes("<div>"), false); // JSX should be compiled away
    });

    it("should transform JSX to JS", async () => {
      const result = await transformJsx(
        `const App = () => <span>Test</span>;`,
        { loader: "jsx" },
      );

      assertExists(result.code);
      assertEquals(result.code.includes("<span>"), false);
    });

    it("should use tsx loader by default", async () => {
      const result = await transformJsx(
        `const x: number = 1; const App = () => <div>{x}</div>;`,
      );

      assertExists(result.code);
      // TypeScript types should be stripped and JSX compiled
      assertEquals(result.code.includes(": number"), false);
    });

    it("should transform TypeScript without JSX", async () => {
      const result = await transformJsx(
        `const x: string = "hello"; export default x;`,
        { loader: "ts" },
      );

      assertExists(result.code);
      assertEquals(result.code.includes(": string"), false);
    });

    it("should handle plain JS", async () => {
      const result = await transformJsx(
        `const x = 42; export default x;`,
        { loader: "js" },
      );

      assertExists(result.code);
      assertEquals(result.code.includes("42"), true);
    });
  });
});
