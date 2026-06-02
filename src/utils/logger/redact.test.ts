import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isSensitiveKey,
  REDACTED,
  redactSensitive,
  sanitizeSerializedError,
  sanitizeUrlCredentials,
} from "./redact.ts";

describe("logger/redact", () => {
  describe("isSensitiveKey", () => {
    it("matches credential-like keys across naming conventions", () => {
      for (
        const key of [
          "password",
          "passwd",
          "pwd",
          "passphrase",
          "secret",
          "clientSecret",
          "token",
          "access_token",
          "refreshToken",
          "jwt",
          "jwtToken",
          "apiKey",
          "API-Key",
          "x-api-key",
          "accessKey",
          "privateKey",
          "credential",
          "authorization",
          "Authorization",
          "Cookie",
          "bearer",
          "connectionString",
          // Extended deny-list (#1989).
          "signature",
          "x-csrf-token",
          "xsrfToken",
          "sessionId",
          "otp",
          "mfaCode",
          "pin",
          "salt",
        ]
      ) {
        assertEquals(isSensitiveKey(key), true, `expected ${key} to be sensitive`);
      }
    });

    it("does not flag benign keys that merely look similar", () => {
      // `author` must NOT match (the deny-list deliberately omits bare `auth`),
      // and short tokens like `dsn`/`sas` are omitted to avoid masking e.g.
      // `feedsNamespace`.
      for (
        const key of ["author", "count", "userId", "requestId", "url", "domain", "feedsNamespace"]
      ) {
        assertEquals(isSensitiveKey(key), false, `expected ${key} to be non-sensitive`);
      }
    });

    it("documents the accepted over-redaction of keys containing a pattern", () => {
      // Over-redaction is the safe failure mode: a key like "tokenCount" is
      // masked even though it is not itself a secret.
      assertEquals(isSensitiveKey("tokenCount"), true);
    });
  });

  describe("redactSensitive", () => {
    it("masks top-level sensitive values and preserves the rest", () => {
      const result = redactSensitive({
        requestId: "req-1",
        password: "hunter2",
        authorization: "Bearer abc",
        message: "ok",
      });
      assertEquals(result, {
        requestId: "req-1",
        password: REDACTED,
        authorization: REDACTED,
        message: "ok",
      });
    });

    it("redacts nested objects and arrays of objects", () => {
      const result = redactSensitive({
        outer: {
          apiKey: "k",
          nested: { token: "t", keep: 1 },
        },
        list: [{ secret: "s", id: 2 }],
      });
      assertEquals(result, {
        outer: {
          apiKey: REDACTED,
          nested: { token: REDACTED, keep: 1 },
        },
        list: [{ secret: REDACTED, id: 2 }],
      });
    });

    it("traverses class instances so their secret fields cannot leak", () => {
      class ApiConfig {
        apiKey = "sk-secret";
        name = "app";
      }
      const result = redactSensitive({ config: new ApiConfig() }) as Record<
        string,
        Record<string, unknown>
      >;
      assertEquals(result.config.apiKey, REDACTED);
      assertEquals(result.config.name, "app");
    });

    it("does not mutate the input object", () => {
      const input = { password: "hunter2", keep: "v" };
      const result = redactSensitive(input);
      assertEquals(input.password, "hunter2");
      assertEquals((result as Record<string, unknown>).password, REDACTED);
    });

    it("leaves primitives and scalar-serializing objects untouched", () => {
      const date = new Date(0);
      const result = redactSensitive({ when: date, n: 5, flag: true, nil: null }) as Record<
        string,
        unknown
      >;
      // Date defines toJSON → serializes to a scalar → returned as-is.
      assertEquals(result.when, date);
      assertEquals(result.n, 5);
      assertEquals(result.flag, true);
      assertEquals(result.nil, null);
    });

    it("fails closed on cyclic references (no unredacted back-reference)", () => {
      const cyclic: Record<string, unknown> = { token: "t", keep: 1 };
      cyclic.self = cyclic;
      const result = redactSensitive(cyclic) as Record<string, unknown>;
      assertEquals(result.token, REDACTED);
      assertEquals(result.keep, 1);
      // The back-reference is masked rather than re-emitting the raw object.
      assertEquals(result.self, REDACTED);
    });

    it("fails closed on a throwing getter", () => {
      const obj: Record<string, unknown> = { password: "x" };
      Object.defineProperty(obj, "boom", {
        enumerable: true,
        get() {
          throw new Error("nope");
        },
      });
      // The whole object is masked rather than crashing the log call.
      assertEquals(redactSensitive({ wrap: obj }) as Record<string, unknown>, {
        wrap: REDACTED,
      });
    });

    it("fails closed past the max traversal depth", () => {
      // Build a structure deeper than MAX_DEPTH (16) with a secret at the bottom.
      let node: Record<string, unknown> = { token: "deep-secret" };
      for (let i = 0; i < 20; i++) node = { child: node };
      const serialized = JSON.stringify(redactSensitive(node));
      assertEquals(serialized.includes("deep-secret"), false);
    });

    it("redacts secrets smuggled through a toJSON method (CODEX P2)", () => {
      // `JSON.stringify` invokes toJSON, so a key-based pass over the object's
      // own properties would miss the credential the serializer actually emits.
      const config = { toJSON: () => ({ apiKey: "sk-secret", name: "app" }) };
      const result = redactSensitive({ config });
      const serialized = JSON.stringify(result);
      assertEquals(serialized.includes("sk-secret"), false);
      // Non-sensitive sibling from the toJSON output survives.
      assertEquals(serialized.includes("app"), true);
    });

    it("redacts a nested toJSON returning an array of credential bags", () => {
      const obj = { toJSON: () => [{ token: "t-1" }, { keep: 2 }] };
      const serialized = JSON.stringify(redactSensitive({ obj }));
      assertEquals(serialized.includes("t-1"), false);
      assertEquals(serialized.includes("2"), true);
    });
  });

  describe("sanitizeUrlCredentials", () => {
    it("masks URL userinfo passwords", () => {
      assertEquals(
        sanitizeUrlCredentials("postgres://user:s3cret@db.host:5432/app"),
        `postgres://user:${REDACTED}@db.host:5432/app`,
      );
    });

    it("masks bare-token userinfo (no colon)", () => {
      assertEquals(
        sanitizeUrlCredentials("https://t0ken@api.example.com/path"),
        `https://${REDACTED}@api.example.com/path`,
      );
    });

    it("masks sensitive query params and keeps benign ones", () => {
      const out = sanitizeUrlCredentials(
        "https://api.example.com/cb?code=abc123&access_token=xyz&page=2",
      );
      assertEquals(out.includes("abc123"), false);
      assertEquals(out.includes("xyz"), false);
      assertEquals(out.includes("page=2"), true);
      assertEquals(
        out,
        `https://api.example.com/cb?code=${REDACTED}&access_token=${REDACTED}&page=2`,
      );
    });

    it("leaves non-URL strings untouched", () => {
      assertEquals(sanitizeUrlCredentials("just a plain message"), "just a plain message");
    });
  });

  describe("sanitizeSerializedError", () => {
    it("scrubs credentials from message and stack", () => {
      const sanitized = sanitizeSerializedError({
        name: "Error",
        message: "connect failed: postgres://u:p4ss@db/app",
        stack: "Error: token leak https://x.io?api_key=SECRET\n  at f",
      });
      assertEquals(sanitized.message.includes("p4ss"), false);
      assertEquals(sanitized.stack?.includes("SECRET"), false);
      assertEquals(sanitized.name, "Error");
    });

    it("returns undefined unchanged", () => {
      assertEquals(sanitizeSerializedError(undefined), undefined);
    });
  });
});
