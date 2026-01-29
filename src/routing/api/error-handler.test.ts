import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleAPIError } from "./error-handler.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function makeAdapter(mode?: string): RuntimeAdapter {
  const envMap = new Map<string, string>();
  if (mode) envMap.set("MODE", mode);
  return {
    env: {
      get: (key: string) => envMap.get(key),
    },
  } as unknown as RuntimeAdapter;
}

describe("routing/api/error-handler", () => {
  describe("handleAPIError", () => {
    it("should return 500 status in production", () => {
      const res = handleAPIError(new Error("fail"), "/api/test", makeAdapter("production"));
      assertEquals(res.status, 500);
    });

    it("should return 500 status in development", () => {
      const res = handleAPIError(new Error("fail"), "/api/test", makeAdapter("development"));
      assertEquals(res.status, 500);
    });

    it("should include error details in development mode", async () => {
      const res = handleAPIError(new Error("bad input"), "/api/test", makeAdapter("development"));
      const body = await res.json();
      assertEquals(body.error, "bad input");
      assertEquals(typeof body.stack, "string");
    });

    it("should hide error details in production mode", async () => {
      const res = handleAPIError(new Error("secret info"), "/api/test", makeAdapter("production"));
      const text = await res.text();
      assertEquals(text.includes("secret info"), false);
    });

    it("should handle non-Error objects", () => {
      const res = handleAPIError("string error", "/api/test", makeAdapter("development"));
      assertEquals(res.status, 500);
    });
  });
});
