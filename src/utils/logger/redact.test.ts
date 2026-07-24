import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isSensitiveKey,
  REDACTED,
  redactForSerialization,
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

    it("classifies oversized keys without relying on cache retention", () => {
      const prefix = "x".repeat(16_384);
      assertEquals(isSensitiveKey(`${prefix}Token`), true);
      assertEquals(isSensitiveKey(`${prefix}RequestId`), false);
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

    it("preserves its generic source contract and non-JSON runtime value shapes", () => {
      const callback = () => "ok";
      const input = {
        when: new Date(0),
        count: 42n,
        callback,
        absent: undefined,
      };

      const result: typeof input = redactSensitive(input);
      assertStrictEquals(result.when, input.when);
      assertStrictEquals(result.count, 42n);
      assertStrictEquals(result.callback, callback);
      assertEquals(Object.hasOwn(result, "absent"), true);
      assertStrictEquals(result.absent, undefined);
    });

    it("preserves sparse array slots through the compatibility API", () => {
      const input = new Array<string | undefined>(2);
      input[1] = "kept";

      const result = redactSensitive(input);
      assertEquals(result.length, 2);
      assertEquals(0 in result, false);
      assertEquals(result[1], "kept");
    });

    it("leaves safe primitives intact and snapshots scalar serializers for JSON", () => {
      const date = new Date(0);
      const result = redactForSerialization({
        when: date,
        n: 5,
        flag: true,
        nil: null,
      }) as Record<string, unknown>;
      // Snapshot toJSON output so a later/non-deterministic invocation cannot
      // bypass the sanitization pass.
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

    it("fails closed on a hostile array element getter", () => {
      const hostile: unknown[] = [];
      Object.defineProperty(hostile, 0, {
        enumerable: true,
        get() {
          throw new Error("hostile array element getter");
        },
      });

      assertEquals(redactSensitive(hostile) as unknown, REDACTED);
      assertEquals(redactSensitive({ values: hostile }) as unknown, { values: REDACTED });
    });

    it("fails closed for revoked root and nested proxies during array classification", () => {
      const revokedObject = Proxy.revocable({ token: "object-secret" }, {});
      const revokedArray = Proxy.revocable(["array-secret"], {});
      revokedObject.revoke();
      revokedArray.revoke();

      assertEquals(redactSensitive(revokedObject.proxy as unknown), REDACTED);
      assertEquals(redactSensitive(revokedArray.proxy as unknown), REDACTED);
      assertEquals(
        redactSensitive({ nested: revokedObject.proxy }) as unknown,
        { nested: REDACTED },
      );
      assertEquals(
        redactSensitive({ nested: revokedArray.proxy }) as unknown,
        { nested: REDACTED },
      );
      assertEquals(redactForSerialization(revokedObject.proxy as unknown), REDACTED);
      assertEquals(redactForSerialization(revokedArray.proxy as unknown), REDACTED);
      assertEquals(redactForSerialization({ nested: revokedObject.proxy }), {
        nested: REDACTED,
      });
      assertEquals(redactForSerialization({ nested: revokedArray.proxy }), {
        nested: REDACTED,
      });
    });

    it("preserves dangerous property names as safe own properties", () => {
      const input: Record<string, unknown> = {};
      Object.defineProperty(input, "__proto__", {
        enumerable: true,
        value: "secret",
      });

      const result = redactSensitive(input) as Record<string, unknown>;
      assertEquals(Object.hasOwn(result, "__proto__"), true);
      assertEquals(result["__proto__"], "secret");
      assertEquals(Object.getPrototypeOf(result), Object.prototype);
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

    it("fails closed when reading a toJSON getter throws", () => {
      const hostile: Record<string, unknown> = {};
      Object.defineProperty(hostile, "toJSON", {
        enumerable: false,
        get() {
          throw new Error("hostile serializer getter");
        },
      });

      assertEquals(redactSensitive(hostile) as unknown, REDACTED);
      assertEquals(redactSensitive({ nested: hostile }) as unknown, { nested: REDACTED });
    });

    it("normalizes values that JSON cannot serialize through the explicit API", () => {
      assertEquals(
        redactForSerialization({
          count: 42n,
          callback: () => {},
          marker: Symbol("marker"),
          absent: undefined,
        }),
        {
          count: "42",
          callback: REDACTED,
          marker: REDACTED,
        },
      );
    });

    it("fails closed on sparse arrays wider than the per-container budget", () => {
      const sparse: unknown[] = [];
      sparse.length = 1_025;
      sparse[1_024] = { token: "must-not-leak" };

      assertEquals(redactSensitive(sparse) as unknown, REDACTED);
      assertEquals(redactForSerialization(sparse), REDACTED);
    });

    it("bounds maximally sparse arrays without iterating their declared length", () => {
      const sparse: unknown[] = [];
      sparse.length = 0xffff_ffff;
      sparse[0xffff_fffe] = { token: "must-not-leak" };

      assertEquals(redactSensitive(sparse) as unknown, REDACTED);
      assertEquals(redactForSerialization(sparse), REDACTED);
    });

    it("fails closed on objects wider than the per-container budget", () => {
      const wide: Record<string, unknown> = {};
      for (let index = 0; index < 1_025; index++) {
        wide[`field${index}`] = index;
      }

      assertEquals(redactSensitive(wide) as unknown, REDACTED);
      assertEquals(redactForSerialization(wide), REDACTED);
    });

    it("shares a cumulative traversal budget across nested containers", () => {
      const manyNodes = Array.from(
        { length: 65 },
        () => Array.from({ length: 65 }, () => "safe"),
      );

      assertEquals(redactSensitive(manyNodes) as unknown, REDACTED);
      assertEquals(redactForSerialization(manyNodes), REDACTED);
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

    it("masks passwords containing an unescaped at sign", () => {
      assertEquals(
        sanitizeUrlCredentials("postgres://user:p@ss@db.host:5432/app"),
        `postgres://user:${REDACTED}@db.host:5432/app`,
      );
    });

    it("masks malformed URL userinfo containing horizontal whitespace", () => {
      for (const whitespace of [" ", "\t"]) {
        const input = `https://user:secret${whitespace}value@example.test/path\r\n` +
          "next_line=kept";
        assertEquals(
          sanitizeUrlCredentials(input),
          `https://user:${REDACTED}@example.test/path\r\nnext_line=kept`,
          JSON.stringify(whitespace),
        );
      }
    });

    it("does not mistake a later email address for URL userinfo", () => {
      for (
        const input of [
          "visit https://example.test then email user@example.test",
          "visit https://example.test:443 then email user@example.test",
        ]
      ) {
        assertEquals(sanitizeUrlCredentials(input), input);
      }
    });

    it("masks protocol-relative URL userinfo", () => {
      assertEquals(
        sanitizeUrlCredentials("//user:secret@example.test/path"),
        `//user:${REDACTED}@example.test/path`,
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

    it("masks credentials encoded as fragment parameters", () => {
      assertEquals(
        sanitizeUrlCredentials(
          "https://app.example.test/callback#access_token=fragment-secret&view=summary",
        ),
        `https://app.example.test/callback#access_token=${REDACTED}&view=summary`,
      );
    });

    it("masks sensitive parameter names containing percent-encoded separators", () => {
      assertEquals(
        sanitizeUrlCredentials("https://app.example.test/?access%5Ftoken=secret&page=2"),
        `https://app.example.test/?access%5Ftoken=${REDACTED}&page=2`,
      );
    });

    it("masks AWS and Google signed-URL credential parameters", () => {
      const sanitized = sanitizeUrlCredentials(
        "https://storage.example.test/object" +
          "?X-Amz-Credential=aws-credential" +
          "&X-Amz-Signature=aws-signature" +
          "&X-Amz-Security-Token=aws-session-token" +
          "&X-Goog-Credential=google-credential" +
          "&X-Goog-Signature=google-signature",
      );

      for (
        const secret of [
          "aws-credential",
          "aws-signature",
          "aws-session-token",
          "google-credential",
          "google-signature",
        ]
      ) {
        assertEquals(sanitized.includes(secret), false);
      }
    });

    it("masks raw authorization values and secret assignments", () => {
      const sanitized = sanitizeUrlCredentials(
        "Authorization: Bearer bearer-secret Basic basic-secret " +
          "password=hunter2 api_key: key-secret",
      );

      for (const secret of ["bearer-secret", "basic-secret", "hunter2", "key-secret"]) {
        assertEquals(sanitized.includes(secret), false);
      }
    });

    it("masks delimiter-bearing assignment values through the next field boundary", () => {
      const sanitized = sanitizeUrlCredentials(
        [
          "password=alpha beta status=401",
          "api_key=alpha,beta, retry=true",
          "client_secret=alpha;beta; attempt=2",
          "access_token=alpha&beta&result=denied",
          "refresh_token=alpha?beta?reason=expired",
          "credential=alpha#beta}",
        ].join("\n"),
      );

      assertEquals(
        sanitized,
        [
          `password=${REDACTED} status=401`,
          `api_key=${REDACTED}, retry=true`,
          `client_secret=${REDACTED}; attempt=2`,
          `access_token=${REDACTED}&result=denied`,
          `refresh_token=${REDACTED}?reason=expired`,
          `credential=${REDACTED}}`,
        ].join("\n"),
      );
    });

    it("is idempotent without trusting a redaction-marker secret prefix", () => {
      const sanitized = sanitizeUrlCredentials(
        "password=alpha beta status=401 api_key=[REDACTED]still-secret retry=true",
      );

      assertEquals(
        sanitized,
        `password=${REDACTED} status=401 api_key=${REDACTED} retry=true`,
      );
      assertEquals(sanitizeUrlCredentials(sanitized), sanitized);
    });

    it("does not trust a closed token or stray closer before a secret suffix", () => {
      for (
        const [input, expected] of [
          [
            "password={}still-secret status=401",
            `password=${REDACTED} status=401`,
          ],
          [
            `password="alpha"still-secret status=401`,
            `password="${REDACTED}" status=401`,
          ],
          [
            "password=[]still-secret status=401",
            `password=${REDACTED} status=401`,
          ],
          [
            "password=abc}still-secret status=401",
            `password=${REDACTED} status=401`,
          ],
        ] as const
      ) {
        const sanitized = sanitizeUrlCredentials(input);
        assertEquals(sanitized, expected, input);
        assertEquals(sanitizeUrlCredentials(sanitized), sanitized, input);
      }
    });

    it("masks sensitive assignment keys with identifier-prefix characters", () => {
      const sanitized = sanitizeUrlCredentials(
        [
          "_password=underscore-secret status=401",
          "$password=dollar-secret retry=true",
          `"_password":"quoted-underscore-secret","status":401`,
          `"$password":"quoted-dollar-secret","retry":true`,
        ].join("\n"),
      );

      assertEquals(
        sanitized,
        [
          `_password=${REDACTED} status=401`,
          `$password=${REDACTED} retry=true`,
          `"_password":"${REDACTED}","status":401`,
          `"$password":"${REDACTED}","retry":true`,
        ].join("\n"),
      );
    });

    it("fails closed for marker and container suffixes while retaining CRLF fields", () => {
      const sanitized = sanitizeUrlCredentials(
        [
          "password=[REDACTED]{}still-secret\r\nstatus=401",
          "secret=[REDACTED][]still-secret\r\nretry=true",
          `private_key="alpha"still-secret\r\n"attempt":2`,
          `credential=${REDACTED}"alpha status=inside-secret"\r\nattempt=3`,
          `private_key=${REDACTED}\`alpha retry=inside-secret\`\r\nresult=denied`,
        ].join("\r\n"),
      );

      assertEquals(
        sanitized,
        [
          `password=${REDACTED}\r\nstatus=401`,
          `secret=${REDACTED}\r\nretry=true`,
          `private_key="${REDACTED}"\r\n"attempt":2`,
          `credential=${REDACTED}\r\nattempt=3`,
          `private_key=${REDACTED}\r\nresult=denied`,
        ].join("\r\n"),
      );
      assertEquals(sanitizeUrlCredentials(sanitized), sanitized);
    });

    it("masks balanced structured assignment values through their outer boundary", () => {
      const sanitized = sanitizeUrlCredentials(
        [
          `password={"part1":"alpha","part2":{"nested":"beta"}} status=401`,
          `secret=["alpha",{"nested":["beta"]}] retry=true`,
        ].join("\n"),
      );

      assertEquals(
        sanitized,
        [
          `password=${REDACTED} status=401`,
          `secret=${REDACTED} retry=true`,
        ].join("\n"),
      );
    });

    it("fails closed across multiline private-key-style assignment values", () => {
      const sanitized = sanitizeUrlCredentials(
        [
          "private_key=-----BEGIN PRIVATE KEY-----",
          "alpha",
          "beta",
          "-----END PRIVATE KEY-----",
          "status=401",
        ].join("\n"),
      );

      assertEquals(sanitized, `private_key=${REDACTED}\nstatus=401`);
    });

    it("masks complete non-Basic authorization header values", () => {
      const sanitized = sanitizeUrlCredentials(
        "Authorization: AWS4-HMAC-SHA256 " +
          "Credential=AKIAEXAMPLE/20260724/eu-north-1/service/aws4_request, " +
          "SignedHeaders=host;x-amz-date, Signature=super-secret-signature",
      );

      for (
        const secret of [
          "AWS4-HMAC-SHA256",
          "AKIAEXAMPLE",
          "aws4_request",
          "x-amz-date",
          "super-secret-signature",
        ]
      ) {
        assertEquals(sanitized.includes(secret), false);
      }
      assertEquals(sanitized, `Authorization: ${REDACTED}`);
    });

    it("masks complete Cookie and Set-Cookie header lines", () => {
      const sanitized = sanitizeUrlCredentials(
        [
          "Cookie: session=first-secret; admin=second-secret; theme=dark",
          "X-Request-Id: safe-request-id",
          "sEt-CoOkIe: access=third-secret; refresh=fourth-secret; Path=/; HttpOnly",
          "Content-Type: application/json",
        ].join("\n"),
      );

      for (
        const secret of [
          "first-secret",
          "second-secret",
          "third-secret",
          "fourth-secret",
        ]
      ) {
        assertEquals(sanitized.includes(secret), false);
      }
      assertEquals(sanitized.includes(`Cookie: ${REDACTED}`), true);
      assertEquals(sanitized.includes(`sEt-CoOkIe: ${REDACTED}`), true);
      assertEquals(sanitized.includes("X-Request-Id: safe-request-id"), true);
      assertEquals(sanitized.includes("Content-Type: application/json"), true);
    });

    it("masks quoted JSON-style credential assignments", () => {
      const sanitized = sanitizeUrlCredentials(
        `request failed: {"password":"super-secret-password","api_key":"super-secret-key"}`,
      );

      assertEquals(sanitized.includes("super-secret-password"), false);
      assertEquals(sanitized.includes("super-secret-key"), false);
      assertEquals(
        sanitized,
        `request failed: {"password":"${REDACTED}","api_key":"${REDACTED}"}`,
      );
    });

    it("applies the complete sensitive-key deny-list to free-form assignments", () => {
      const secrets = [
        "credential-value",
        "signature-value",
        "private-key-value",
        "access-key-value",
        "connection-string-value",
        "jwt-value",
        "session-value",
      ];
      const sanitized = sanitizeUrlCredentials(
        `request failed: {"credential":"${secrets[0]}",` +
          `"signature":"${secrets[1]}",` +
          `"privateKey":"${secrets[2]}",` +
          `"accessKey":"${secrets[3]}",` +
          `"connectionString":"${secrets[4]}",` +
          `"jwt":"${secrets[5]}",` +
          `"sessionId":"${secrets[6]}",` +
          `"status":"safe-value"}`,
      );

      for (const secret of secrets) assertEquals(sanitized.includes(secret), false);
      assertEquals(sanitized.includes(`"status":"safe-value"`), true);
    });

    it("leaves non-URL strings untouched", () => {
      assertEquals(sanitizeUrlCredentials("just a plain message"), "just a plain message");
    });
  });

  describe("structured string sanitization", () => {
    it("scrubs URL credentials from nested strings and URL objects", () => {
      const result = redactForSerialization({
        nested: {
          endpoint: "https://user:pass@example.test/path?token=query-secret",
          callback: new URL(
            "https://client:password@example.test/callback#access_token=fragment-secret",
          ),
        },
      }) as unknown as {
        nested: { endpoint: string; callback: string };
      };

      const serialized = JSON.stringify(result);
      assertEquals(serialized.includes("pass"), false);
      assertEquals(serialized.includes("query-secret"), false);
      assertEquals(serialized.includes("password"), false);
      assertEquals(serialized.includes("fragment-secret"), false);
      assertEquals(result.nested.endpoint.includes(REDACTED), true);
      assertEquals(result.nested.callback.includes(REDACTED), true);
    });

    it("scrubs URL credentials returned by scalar toJSON methods", () => {
      const value = {
        toJSON: () => "https://example.test/callback#token=scalar-secret",
      };

      const serialized = JSON.stringify(redactForSerialization({ value }));
      assertEquals(serialized.includes("scalar-secret"), false);
      assertEquals(serialized.includes(REDACTED), true);
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

    it("omits opaque and local URL payloads from span attributes", () => {
      assertEquals(sanitizeUrlForSpan("data:text/plain,private-payload"), "data:");
      assertEquals(sanitizeUrlForSpan("file:///private/local/path"), "file:");
      assertEquals(sanitizeUrlForSpan("mailto:private@example.test"), "mailto:");
    });

    it("omits blob object identifiers while retaining the embedded origin", () => {
      assertEquals(
        sanitizeUrlForSpan("blob:https://example.com/private-object-id"),
        "blob:https://example.com",
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

    it("scrubs credentials from an error name", () => {
      const sanitized = sanitizeSerializedError({
        name: "postgres://user:secret@db.host/app",
        message: "connection failed",
      });

      assertEquals(sanitized.name.includes("secret"), false);
      assertEquals(sanitized.name.includes(REDACTED), true);
    });

    it("returns undefined unchanged", () => {
      assertEquals(sanitizeSerializedError(undefined), undefined);
    });
  });
});
