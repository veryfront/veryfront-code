import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const MODULE_PATH = new URL("./jwt.ts", import.meta.url).href;

/**
 * Dynamically import jwt.ts with a cache-busting query param so each
 * test gets a fresh module evaluation with its own process.env snapshot.
 */
let importCounter = 0;
function importJwt() {
  return import(`${MODULE_PATH}?v=${++importCounter}`) as Promise<
    typeof import("./jwt.ts")
  >;
}

describe("jwt template", () => {
  const originalSecret = process.env.JWT_SECRET;

  function restoreEnv() {
    if (originalSecret !== undefined) {
      process.env.JWT_SECRET = originalSecret;
    } else {
      delete process.env.JWT_SECRET;
    }
  }

  describe("missing JWT_SECRET", () => {
    it("throws when JWT_SECRET is not set", async () => {
      delete process.env.JWT_SECRET;
      try {
        await assertRejects(
          () => importJwt(),
          Error,
          "JWT_SECRET environment variable is required",
        );
      } finally {
        restoreEnv();
      }
    });

    it("throws when JWT_SECRET is empty string", async () => {
      process.env.JWT_SECRET = "";
      try {
        await assertRejects(
          () => importJwt(),
          Error,
          "JWT_SECRET environment variable is required",
        );
      } finally {
        restoreEnv();
      }
    });
  });

  describe("sign and verify", () => {
    it("signs and verifies a token roundtrip", async () => {
      process.env.JWT_SECRET = "test-secret-key-for-unit-tests-only";
      try {
        const { sign, verify } = await importJwt();

        const payload = { userId: "123", role: "admin" };
        const token = await sign(payload);

        const decoded = await verify(token);
        assertEquals(decoded?.userId, "123");
        assertEquals(decoded?.role, "admin");
      } finally {
        restoreEnv();
      }
    });

    it("returns null for an invalid token", async () => {
      process.env.JWT_SECRET = "test-secret-key-for-unit-tests-only";
      try {
        const { verify } = await importJwt();

        assertEquals(await verify("not.a.valid-token"), null);
        assertEquals(await verify(""), null);
        assertEquals(await verify("only-one-part"), null);
      } finally {
        restoreEnv();
      }
    });

    it("returns null for a token signed with a different secret", async () => {
      process.env.JWT_SECRET = "secret-one";
      try {
        const mod1 = await importJwt();
        const token = await mod1.sign({ userId: "123" });

        process.env.JWT_SECRET = "secret-two";
        const mod2 = await importJwt();
        assertEquals(await mod2.verify(token), null);
      } finally {
        restoreEnv();
      }
    });
  });
});
