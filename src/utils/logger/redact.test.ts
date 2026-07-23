import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isSensitiveKey,
  REDACTED,
  redactSensitive,
  sanitizeSerializedError,
  sanitizeUrlCredentials,
  sanitizeUrlForSpan,
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

    it("keeps results stable after the sensitive-key cache evicts old entries", () => {
      for (let i = 0; i < 600; i++) {
        assertEquals(isSensitiveKey(`requestId${i}`), false);
      }

      assertEquals(isSensitiveKey("token"), true);
      assertEquals(isSensitiveKey("requestId0"), false);
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
      const result = redactSensitive({ config: new ApiConfig() }) as unknown as {
        config: Record<string, unknown>;
      };
      assertEquals(result.config.apiKey, REDACTED);
      assertEquals(result.config.name, "app");
    });

    it("does not mutate the input object", () => {
      const input = { password: "hunter2", keep: "v" };
      const result = redactSensitive(input);
      assertEquals(input.password, "hunter2");
      assertEquals((result as Record<string, unknown>).password, REDACTED);
    });

    it("preserves primitives and snapshots scalar-serializing objects", () => {
      const date = new Date(0);
      const result = redactSensitive({ when: date, n: 5, flag: true, nil: null }) as Record<
        string,
        unknown
      >;
      assertEquals(result.when, date.toISOString());
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

    it("fails closed on a throwing array element getter", () => {
      const values: unknown[] = [];
      Object.defineProperty(values, 0, {
        enumerable: true,
        get() {
          throw new Error("blocked");
        },
      });
      values.length = 1;

      assertEquals(redactSensitive({ values }) as unknown, { values: REDACTED });
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

    it("fails closed when reading toJSON itself throws", () => {
      const value = {};
      Object.defineProperty(value, "toJSON", {
        get() {
          throw new Error("getter failed");
        },
      });

      assertEquals(redactSensitive({ value }), { value: REDACTED });
    });

    it("converts BigInt values into JSON-safe text", () => {
      assertEquals(redactSensitive({ count: 42n }) as unknown, { count: "42" });
    });

    it("scrubs URL credentials from non-sensitive string fields", () => {
      const result = redactSensitive({
        endpoint: "https://user:field-secret@example.test/path?token=query-secret&page=2",
      }) as unknown as { endpoint: string };

      assertEquals(result.endpoint.includes("field-secret"), false);
      assertEquals(result.endpoint.includes("query-secret"), false);
      assertEquals(result.endpoint.includes("page=2"), true);
    });

    it("scrubs bearer tokens and credential assignments in free-form strings", () => {
      const result = redactSensitive({
        detail: "Authorization: Bearer abc.def.ghi password=plain-secret mode=test",
      }) as unknown as { detail: string };

      assertEquals(result.detail.includes("abc.def.ghi"), false);
      assertEquals(result.detail.includes("plain-secret"), false);
      assertEquals(result.detail.includes("mode=test"), true);
    });

    it("scrubs quoted and colon-delimited credential assignments", () => {
      const result = redactSensitive({
        detail: 'password="two word secret" api_key: plain-secret',
      });

      assertEquals(result, {
        detail: `password=${REDACTED} api_key: ${REDACTED}`,
      });
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

    it("masks percent-encoded sensitive query parameter names", () => {
      assertEquals(
        sanitizeUrlCredentials(
          "https://api.example.com/cb?%61ccess%5Ftoken=secret&route%5Fstate=canvas",
        ),
        `https://api.example.com/cb?%61ccess%5Ftoken=${REDACTED}&route%5Fstate=canvas`,
      );
    });

    it("masks repeatedly encoded names and fails closed on malformed escapes", () => {
      assertEquals(
        sanitizeUrlCredentials(
          "https://api.example.com/cb?%2561ccess%255Ftoken=secret&route%5Fstate=canvas",
        ),
        `https://api.example.com/cb?%2561ccess%255Ftoken=${REDACTED}&route%5Fstate=canvas`,
      );
      assertEquals(
        sanitizeUrlCredentials("https://api.example.com/cb?to%ZZken=secret"),
        `https://api.example.com/cb?to%ZZken=${REDACTED}`,
      );
    });

    it("masks bracket-notation credential parameter names", () => {
      assertEquals(
        sanitizeUrlCredentials(
          "https://api.example.com/cb?access_token[]=secret&auth[token]=nested&page=2",
        ),
        `https://api.example.com/cb?access_token[]=${REDACTED}&auth[token]=${REDACTED}&page=2`,
      );
    });

    it("masks URL-normalized whitespace variants of credential names", () => {
      assertEquals(
        sanitizeUrlCredentials(
          "https://api.example.com/cb?api key=space&session\tid=tab&api\u00a0key=nbsp&page=2",
        ),
        `https://api.example.com/cb?api key=${REDACTED}&session\tid=${REDACTED}&api\u00a0key=${REDACTED}&page=2`,
      );
    });

    it("masks complete userinfo when a password contains at-signs", () => {
      assertEquals(
        sanitizeUrlCredentials("https://user:p@ss@example.com/path"),
        `https://user:${REDACTED}@example.com/path`,
      );
      assertEquals(
        sanitizeUrlCredentials("postgres://u:p@a@db/app"),
        `postgres://u:${REDACTED}@db/app`,
      );
    });

    it("masks parseable whitespace, protocol-relative, and backslash userinfo forms", () => {
      const cases = [
        [
          "https://user:secret word@example.test/path",
          `https://user:${REDACTED}@example.test/path`,
        ],
        [
          "https://user :secret@example.test/path",
          `https://user :${REDACTED}@example.test/path`,
        ],
        [
          "https://secret word@example.test/path",
          `https://${REDACTED}@example.test/path`,
        ],
        [
          "https://user:secret\tword@example.test/path",
          `https://user:${REDACTED}@example.test/path`,
        ],
        [
          "//user:secret@example.test/path",
          `//user:${REDACTED}@example.test/path`,
        ],
        [
          "https:\\\\user:secret@example.test/path",
          `https:\\\\user:${REDACTED}@example.test/path`,
        ],
        [
          "https:/\\user:secret@example.test/path",
          `https:/\\user:${REDACTED}@example.test/path`,
        ],
        [
          "https:\t//user:secret@example.test/path",
          `https:\t//user:${REDACTED}@example.test/path`,
        ],
        [
          "https:user:secret word@example.test/path",
          `https:user:${REDACTED}@example.test/path`,
        ],
      ] as const;

      for (const [input, expected] of cases) {
        assertEquals(sanitizeUrlCredentials(input), expected);
      }
    });

    it("masks slashless special-scheme credential URLs", () => {
      assertEquals(
        sanitizeUrlCredentials("https:user:secret@example.test/path"),
        `https:user:${REDACTED}@example.test/path`,
      );
    });

    it("does not merge unrelated prose and email addresses into URL userinfo", () => {
      const cases = [
        "Fetch https://example.test failed; contact ops@example.com",
        "Fetch https://example.test failed\nContact: ops@example.com",
        "source // ordinary text and owner@example.com",
        "Fetch https://example.test,contact@example.com",
        "Fetch https://example.test(contact@example.com",
      ];
      for (const value of cases) assertEquals(sanitizeUrlCredentials(value), value);
    });

    it("masks identity tokens and session identifiers in URLs", () => {
      assertEquals(
        sanitizeUrlCredentials(
          "https://example.test/callback?id_token=identity&session_id=session&jwt=token",
        ),
        `https://example.test/callback?id_token=${REDACTED}&session_id=${REDACTED}&jwt=${REDACTED}`,
      );
    });

    it("masks authorization header values across authentication schemes", () => {
      assertEquals(
        sanitizeUrlCredentials("Authorization: Basic dXNlcjpwYXNzd29yZA=="),
        `Authorization: Basic ${REDACTED}`,
      );
      assertEquals(
        sanitizeUrlCredentials(
          'authorization=Digest username="alice", realm="production", response="digest-secret"',
        ),
        `authorization=Digest ${REDACTED}`,
      );
      assertEquals(
        sanitizeUrlCredentials("Proxy-Authorization: Negotiate opaque-proxy-token"),
        `Proxy-Authorization: Negotiate ${REDACTED}`,
      );
      assertEquals(
        sanitizeUrlCredentials("Authorization: opaque-credential"),
        `Authorization: ${REDACTED}`,
      );
    });

    it("masks cookie header values without consuming adjacent lines", () => {
      assertEquals(
        sanitizeUrlCredentials(
          "request failed\r\nCookie: session=cookie-secret; theme=dark\r\n" +
            "Set-Cookie: session=response-secret; Path=/; HttpOnly\r\nstatus=401",
        ),
        `request failed\r\nCookie: ${REDACTED}\r\nSet-Cookie: ${REDACTED}\r\nstatus=401`,
      );
    });

    it("leaves non-URL strings untouched", () => {
      assertEquals(sanitizeUrlCredentials("just a plain message"), "just a plain message");
    });
  });

  describe("sanitizeUrlForSpan", () => {
    it("removes query strings, fragments, and URL credentials", () => {
      assertEquals(
        sanitizeUrlForSpan("https://user:secret@example.com/path?token=secret#frag"),
        "https://example.com/path",
      );
    });

    it("removes query strings from relative URL-shaped values", () => {
      assertEquals(sanitizeUrlForSpan("/cache/get?key=secret#frag"), "/cache/get");
    });

    it("removes userinfo from protocol-relative URL-shaped values", () => {
      assertEquals(
        sanitizeUrlForSpan("//user:secret@example.com/path?key=secret"),
        "//example.com/path",
      );
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

    it("scrubs authorization and cookie headers from message and stack", () => {
      const sanitized = sanitizeSerializedError({
        name: "Error",
        message: "upstream rejected request\nAuthorization: Basic message-secret",
        stack:
          'Error: rejected\nProxy-Authorization: Digest username="alice", response="stack-secret"\n' +
          "Set-Cookie: session=stack-cookie; HttpOnly\n  at request",
      });

      assertEquals(
        sanitized.message,
        `upstream rejected request\nAuthorization: Basic ${REDACTED}`,
      );
      assertEquals(
        sanitized.stack,
        `Error: rejected\nProxy-Authorization: Digest ${REDACTED}\nSet-Cookie: ${REDACTED}\n  at request`,
      );
    });

    it("returns undefined unchanged", () => {
      assertEquals(sanitizeSerializedError(undefined), undefined);
    });
  });
});
