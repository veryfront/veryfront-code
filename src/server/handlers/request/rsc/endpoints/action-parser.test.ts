import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseActionBody } from "./action-parser.ts";

describe("server/handlers/request/rsc/endpoints/action-parser", () => {
  describe("parseActionBody", () => {
    it("should parse a valid action body with id and args", async () => {
      const result = await parseActionBody({ id: "myAction", args: [1, "two"] });
      // If it's not a Response, it should be an ActionBody
      if (result instanceof Response) {
        throw new Error("Expected ActionBody, got Response");
      }
      assertEquals(result.id, "myAction");
      assertEquals(result.args, [1, "two"]);
    });

    it("should parse a valid action body with no args (defaults to empty array)", async () => {
      const result = await parseActionBody({ id: "myAction" });
      if (result instanceof Response) {
        throw new Error("Expected ActionBody, got Response");
      }
      assertEquals(result.id, "myAction");
      assertEquals(result.args, []);
    });

    it("should accept action ids with slashes", async () => {
      const result = await parseActionBody({ id: "module/action", args: [] });
      if (result instanceof Response) {
        throw new Error("Expected ActionBody, got Response");
      }
      assertEquals(result.id, "module/action");
    });

    it("should accept action ids with underscores and hyphens", async () => {
      const result = await parseActionBody({ id: "my_action-name", args: [] });
      if (result instanceof Response) {
        throw new Error("Expected ActionBody, got Response");
      }
      assertEquals(result.id, "my_action-name");
    });

    it("should return error Response for missing id", async () => {
      const result = await parseActionBody({ id: "", args: [] });
      assertEquals(result instanceof Response, true);
      if (result instanceof Response) {
        assertEquals(result.status, 400);
      }
    });

    it("should return error Response for null body", async () => {
      const result = await parseActionBody(null);
      assertEquals(result instanceof Response, true);
      if (result instanceof Response) {
        assertEquals(result.status, 400);
      }
    });

    it("should return error Response for non-object body", async () => {
      const result = await parseActionBody("not an object");
      assertEquals(result instanceof Response, true);
      if (result instanceof Response) {
        assertEquals(result.status, 400);
      }
    });

    it("should return error Response for id starting with slash", async () => {
      const result = await parseActionBody({ id: "/leading-slash", args: [] });
      assertEquals(result instanceof Response, true);
      if (result instanceof Response) {
        assertEquals(result.status, 400);
      }
    });

    it("should return error Response for id ending with slash", async () => {
      const result = await parseActionBody({ id: "trailing/", args: [] });
      assertEquals(result instanceof Response, true);
      if (result instanceof Response) {
        assertEquals(result.status, 400);
      }
    });

    it("should return error Response for id containing ..", async () => {
      const result = await parseActionBody({ id: "foo/../bar", args: [] });
      assertEquals(result instanceof Response, true);
      if (result instanceof Response) {
        assertEquals(result.status, 400);
      }
    });

    it("should return error Response for id with special characters", async () => {
      const result = await parseActionBody({ id: "foo bar", args: [] });
      assertEquals(result instanceof Response, true);
      if (result instanceof Response) {
        assertEquals(result.status, 400);
      }
    });

    it("should accept deeply nested path ids", async () => {
      const result = await parseActionBody({ id: "a/b/c/d/e", args: [] });
      if (result instanceof Response) {
        throw new Error("Expected ActionBody, got Response");
      }
      assertEquals(result.id, "a/b/c/d/e");
    });
  });
});
