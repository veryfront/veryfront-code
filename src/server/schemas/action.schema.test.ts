import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ActionPayloadSchema } from "./action.schema.ts";

describe("server/schemas/action.schema", () => {
  describe("ActionPayloadSchema", () => {
    it("should accept a valid payload with id and args", () => {
      const result = ActionPayloadSchema.safeParse({ id: "action-1", args: [1, "two"] });
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.id, "action-1");
        assertEquals(result.data.args, [1, "two"]);
      }
    });

    it("should default args to empty array when omitted", () => {
      const result = ActionPayloadSchema.safeParse({ id: "action-1" });
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.args, []);
      }
    });

    it("should reject empty id string", () => {
      const result = ActionPayloadSchema.safeParse({ id: "" });
      assertEquals(result.success, false);
    });

    it("should reject missing id", () => {
      const result = ActionPayloadSchema.safeParse({ args: [] });
      assertEquals(result.success, false);
    });

    it("should reject non-string id", () => {
      const result = ActionPayloadSchema.safeParse({ id: 123 });
      assertEquals(result.success, false);
    });

    it("should reject args array with more than 50 elements", () => {
      const bigArgs = Array.from({ length: 51 }, (_, i) => i);
      const result = ActionPayloadSchema.safeParse({ id: "x", args: bigArgs });
      assertEquals(result.success, false);
    });

    it("should accept args array with exactly 50 elements", () => {
      const maxArgs = Array.from({ length: 50 }, (_, i) => i);
      const result = ActionPayloadSchema.safeParse({ id: "x", args: maxArgs });
      assertEquals(result.success, true);
    });

    it("should accept args with mixed types", () => {
      const result = ActionPayloadSchema.safeParse({
        id: "x",
        args: [null, undefined, 42, "str", { key: "val" }, [1, 2]],
      });
      assertEquals(result.success, true);
    });

    it("should reject non-array args", () => {
      const result = ActionPayloadSchema.safeParse({ id: "x", args: "not-array" });
      assertEquals(result.success, false);
    });

    it("should reject null payload", () => {
      const result = ActionPayloadSchema.safeParse(null);
      assertEquals(result.success, false);
    });

    it("should reject undefined payload", () => {
      const result = ActionPayloadSchema.safeParse(undefined);
      assertEquals(result.success, false);
    });
  });
});
