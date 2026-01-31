import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseActionBody } from "./action-parser.ts";

function assertActionBody(result: unknown): { id: string; args: unknown[] } {
  if (result instanceof Response) {
    throw new Error("Expected ActionBody, got Response");
  }
  return result as { id: string; args: unknown[] };
}

function assertErrorResponse(result: unknown, status: number): void {
  assertEquals(result instanceof Response, true);
  if (!(result instanceof Response)) return;
  assertEquals(result.status, status);
}

describe("server/services/rsc/endpoints/action-parser", () => {
  describe("parseActionBody", () => {
    it("should parse a valid action body with id and args", async () => {
      const result = await parseActionBody({ id: "myAction", args: [1, "two"] });
      const body = assertActionBody(result);
      assertEquals(body.id, "myAction");
      assertEquals(body.args, [1, "two"]);
    });

    it("should parse a valid action body with no args (defaults to empty array)", async () => {
      const result = await parseActionBody({ id: "myAction" });
      const body = assertActionBody(result);
      assertEquals(body.id, "myAction");
      assertEquals(body.args, []);
    });

    it("should accept action ids with slashes", async () => {
      const result = await parseActionBody({ id: "module/action", args: [] });
      const body = assertActionBody(result);
      assertEquals(body.id, "module/action");
    });

    it("should accept action ids with underscores and hyphens", async () => {
      const result = await parseActionBody({ id: "my_action-name", args: [] });
      const body = assertActionBody(result);
      assertEquals(body.id, "my_action-name");
    });

    it("should return error Response for missing id", async () => {
      const result = await parseActionBody({ id: "", args: [] });
      assertErrorResponse(result, 400);
    });

    it("should return error Response for null body", async () => {
      const result = await parseActionBody(null);
      assertErrorResponse(result, 400);
    });

    it("should return error Response for non-object body", async () => {
      const result = await parseActionBody("not an object");
      assertErrorResponse(result, 400);
    });

    it("should return error Response for id starting with slash", async () => {
      const result = await parseActionBody({ id: "/leading-slash", args: [] });
      assertErrorResponse(result, 400);
    });

    it("should return error Response for id ending with slash", async () => {
      const result = await parseActionBody({ id: "trailing/", args: [] });
      assertErrorResponse(result, 400);
    });

    it("should return error Response for id containing ..", async () => {
      const result = await parseActionBody({ id: "foo/../bar", args: [] });
      assertErrorResponse(result, 400);
    });

    it("should return error Response for id with special characters", async () => {
      const result = await parseActionBody({ id: "foo bar", args: [] });
      assertErrorResponse(result, 400);
    });

    it("should accept deeply nested path ids", async () => {
      const result = await parseActionBody({ id: "a/b/c/d/e", args: [] });
      const body = assertActionBody(result);
      assertEquals(body.id, "a/b/c/d/e");
    });
  });
});
