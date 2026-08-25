import "#veryfront/schemas/_test-setup.ts";
import { RSC_ACTION_MAX_TOP_LEVEL_ARGUMENTS } from "#veryfront/extensions/auth/index.ts";
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

    it("snapshots the argument array at the request boundary", async () => {
      const args: unknown[] = [{ value: 1 }];
      const result = await parseActionBody({ id: "myAction", args });
      const body = assertActionBody(result);

      args.push("late mutation");

      assertEquals(body.args, [{ value: 1 }]);
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

    it("rejects non-array and oversized args", async () => {
      assertErrorResponse(await parseActionBody({ id: "action", args: "not-array" }), 400);
      assertErrorResponse(
        await parseActionBody({
          id: "action",
          args: Array.from({ length: RSC_ACTION_MAX_TOP_LEVEL_ARGUMENTS + 1 }),
        }),
        400,
      );

      const atLimit = await parseActionBody({
        id: "action",
        args: Array.from({ length: RSC_ACTION_MAX_TOP_LEVEL_ARGUMENTS }, (_, i) => i),
      });
      const body = assertActionBody(atLimit);
      assertEquals(
        body.args.length,
        RSC_ACTION_MAX_TOP_LEVEL_ARGUMENTS,
        "exactly the documented maximum argument count must still be accepted",
      );
    });

    it("rejects inherited and accessor-backed action fields", async () => {
      const inherited = Object.create({ id: "inherited" }) as Record<string, unknown>;
      assertErrorResponse(await parseActionBody(inherited), 400);

      let getterCalls = 0;
      const accessorBody = Object.create(null);
      Object.defineProperty(accessorBody, "id", {
        enumerable: true,
        get() {
          getterCalls++;
          return "action";
        },
      });

      assertErrorResponse(await parseActionBody(accessorBody), 400);
      assertEquals(getterCalls, 0);
    });

    it("rejects sparse or accessor-backed argument arrays without invoking getters", async () => {
      const sparse = new Array(1);
      assertErrorResponse(await parseActionBody({ id: "action", args: sparse }), 400);

      let getterCalls = 0;
      const accessorArgs: unknown[] = [];
      Object.defineProperty(accessorArgs, 0, {
        enumerable: true,
        get() {
          getterCalls++;
          return "argument";
        },
      });
      Object.defineProperty(accessorArgs, "length", { value: 1 });

      assertErrorResponse(await parseActionBody({ id: "action", args: accessorArgs }), 400);
      assertEquals(getterCalls, 0);
    });

    it("rejects sparse arguments even when inherited descriptors mask missing indexes", async () => {
      const args = ["first", "second"];
      Reflect.deleteProperty(args, "1");
      Object.defineProperty(args, "extra", {
        configurable: true,
        enumerable: true,
        value: "padding",
      });
      const inheritedIndex = Object.getOwnPropertyDescriptor(Object.prototype, "1");
      Object.defineProperty(Object.prototype, "1", {
        configurable: true,
        value: {
          configurable: true,
          enumerable: true,
          value: "inherited",
          writable: true,
        },
        writable: true,
      });
      try {
        assertErrorResponse(await parseActionBody({ id: "save", args }), 400);
      } finally {
        if (inheritedIndex === undefined) {
          Reflect.deleteProperty(Object.prototype, "1");
        } else {
          Object.defineProperty(Object.prototype, "1", inheritedIndex);
        }
      }
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

    it("rejects action ids beyond the bounded route length", async () => {
      const result = await parseActionBody({ id: "a".repeat(513), args: [] });
      assertErrorResponse(result, 400);
    });

    it("should reject ids with consecutive slashes", async () => {
      const result = await parseActionBody({ id: "foo//bar", args: [] });
      assertErrorResponse(result, 400);
    });

    it("should complete quickly on adversarial input (ReDoS resistance)", async () => {
      // Crafted input that would cause catastrophic backtracking with the old
      // regex where `/` appeared in the character classes AND the group separator.
      const malicious = "a" + "/".repeat(50) + "!";
      const start = performance.now();
      const result = await parseActionBody({ id: malicious, args: [] });
      const elapsed = performance.now() - start;
      assertErrorResponse(result, 400);
      assertEquals(elapsed < 100, true, `Regex took ${elapsed}ms, expected <100ms`);
    });
  });
});
