import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createSecureFs } from "./secure-fs.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";

// Minimal adapter stub — only getUnsafeAdapter() is being tested
function createMockAdapter() {
  return { fs: {} } as any;
}

describe("SecureFs", () => {
  describe("getUnsafeAdapter", () => {
    it("throws in production", () => {
      const originalEnv = Deno.env.get("NODE_ENV");
      try {
        Deno.env.set("NODE_ENV", "production");
        const secureFs = createSecureFs({
          baseDir: "/tmp",
          adapter: createMockAdapter(),
        });

        assertThrows(
          () => secureFs.getUnsafeAdapter(),
          VeryfrontError,
          "not allowed in production",
        );
      } finally {
        if (originalEnv !== undefined) {
          Deno.env.set("NODE_ENV", originalEnv);
        } else {
          Deno.env.delete("NODE_ENV");
        }
      }
    });

    it("returns adapter in development", () => {
      const originalEnv = Deno.env.get("NODE_ENV");
      try {
        Deno.env.set("NODE_ENV", "development");
        const adapter = createMockAdapter();
        const secureFs = createSecureFs({
          baseDir: "/tmp",
          adapter,
        });

        const result = secureFs.getUnsafeAdapter();
        assertEquals(result, adapter);
      } finally {
        if (originalEnv !== undefined) {
          Deno.env.set("NODE_ENV", originalEnv);
        } else {
          Deno.env.delete("NODE_ENV");
        }
      }
    });
  });
});
