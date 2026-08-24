import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isSensitiveKey,
  REDACTED,
  redactForSerialization,
  redactPathFromText,
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
          "auth",
          "authHeader",
          "auth.header",
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
      // Exact `auth` is sensitive, but it must not turn ordinary words such as
      // `author` into sensitive keys. Short tokens like `dsn`/`sas` remain
      // omitted to avoid masking e.g. `feedsNamespace`.
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

    it("scrubs credential-shaped text from URL objects", () => {
      const result = redactSensitive({
        callback: new URL("https://api.example.com/cb?access_token=synthetic-url-secret&page=2"),
      }) as Record<string, unknown>;

      assertEquals(
        result.callback,
        `https://api.example.com/cb?access_token=${REDACTED}&page=2`,
      );
    });

    it("scrubs credential-shaped text from scalar toJSON strings", () => {
      const sensitive = {
        toJSON: () => "https://api.example.com/cb?access_token=synthetic-to-json-secret&page=2",
      };
      const benign = { toJSON: () => "https://api.example.com/cb?page=2" };

      const result = redactSensitive({ sensitive, benign }) as Record<string, unknown>;

      assertEquals(
        result.sensitive,
        `https://api.example.com/cb?access_token=${REDACTED}&page=2`,
      );
      assertEquals(result.benign, benign);
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

    it("fails closed on a cyclic serializer prototype chain", () => {
      const cyclicPrototype: object = new Proxy({}, {
        getPrototypeOf: () => cyclicPrototype,
      });

      assertEquals(redactSensitive({ wrap: cyclicPrototype }) as Record<string, unknown>, {
        wrap: REDACTED,
      });
    });

    it("keeps serializer hook cycle detection stable after the global Set changes", () => {
      const originalSetConstructor = globalThis.Set;
      let redacted: unknown;

      try {
        globalThis.Set = function ReplacementSet() {
          throw new Error("project code replaced Set");
        } as unknown as SetConstructor;

        redacted = redactForSerialization({
          wrap: {
            toJSON: () => ({ apiKey: "synthetic-opaque-credential" }),
          },
        });
      } finally {
        globalThis.Set = originalSetConstructor;
      }

      assertEquals(redacted, { wrap: { apiKey: REDACTED } });
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

    it("ignores intrinsic serialization hooks after global constructors are replaced", () => {
      const originalObjectConstructor = globalThis.Object;
      const originalArrayConstructor = globalThis.Array;
      const originalObjectToJSON = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
      const originalArrayToJSON = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
      let hookCalls = 0;
      let redacted: unknown;

      try {
        Object.defineProperty(Object.prototype, "toJSON", {
          configurable: true,
          value() {
            hookCalls++;
            return { leaked: "synthetic-intrinsic-secret" };
          },
        });
        Object.defineProperty(Array.prototype, "toJSON", {
          configurable: true,
          value() {
            hookCalls++;
            return ["synthetic-intrinsic-secret"];
          },
        });
        globalThis.Object = function ReplacementObject() {} as unknown as ObjectConstructor;
        globalThis.Array = function ReplacementArray() {} as unknown as ArrayConstructor;

        redacted = redactForSerialization({ apiKey: "synthetic-opaque-credential" });
      } finally {
        globalThis.Object = originalObjectConstructor;
        globalThis.Array = originalArrayConstructor;
        if (originalObjectToJSON) {
          Object.defineProperty(Object.prototype, "toJSON", originalObjectToJSON);
        } else {
          delete (Object.prototype as { toJSON?: unknown }).toJSON;
        }
        if (originalArrayToJSON) {
          Object.defineProperty(Array.prototype, "toJSON", originalArrayToJSON);
        } else {
          delete (Array.prototype as { toJSON?: unknown }).toJSON;
        }
      }

      assertEquals(hookCalls, 0);
      assertEquals(redacted, { apiKey: REDACTED });
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

    it("masks whole cookie and set-cookie header lines", () => {
      const cookieLine = sanitizeUrlCredentials("cookie: theme=dark; _ga=GA1.2.99; sess=SECRET");
      assertEquals(
        cookieLine,
        `cookie: ${REDACTED}`,
        "the whole cookie header line is masked, not just the first pair",
      );
      assertEquals(cookieLine.includes("SECRET"), false);

      const setCookieLine = sanitizeUrlCredentials("set-cookie: sess=SECRET; Path=/; HttpOnly");
      assertEquals(
        setCookieLine,
        `set-cookie: ${REDACTED}`,
        "set-cookie attributes must not leak past the first delimiter",
      );
      assertEquals(setCookieLine.includes("SECRET"), false);

      const embedded = sanitizeUrlCredentials("request headers -> cookie: sess=SECRET; a=b");
      assertEquals(
        embedded,
        `request headers -> cookie: ${REDACTED}`,
        "a cookie header embedded mid-message is masked from the header name onward",
      );
      assertEquals(embedded.includes("SECRET"), false);
    });

    it("keeps benign assignment-shaped words intact", () => {
      for (
        const message of [
          "mapping: 4 routes resolved",
          "spinner=ready",
          "considered: safe",
          "residual=small",
          "saltiness=balanced",
        ]
      ) {
        assertEquals(sanitizeUrlCredentials(message), message);
      }
    });

    it("bounds oversized assignment-key classification and fails closed", () => {
      const oversizedKey = `benign_${"segment_".repeat(10_000)}`;
      assertEquals(
        sanitizeUrlCredentials(`${oversizedKey}=synthetic-opaque-value`),
        `${oversizedKey}=${REDACTED}`,
      );
    });

    it("keeps assignment redaction fail-closed after prototype methods are replaced", () => {
      const originalIncludes = String.prototype.includes;
      const originalSplit = String.prototype.split;
      const originalFilter = Array.prototype.filter;
      const originalSome = Array.prototype.some;
      let sensitive: string;
      let benign: string;

      try {
        String.prototype.includes = () => false;
        String.prototype.split = () => ["mapping"];
        Array.prototype.filter = () => [];
        Array.prototype.some = () => false;

        sensitive = sanitizeUrlCredentials("refreshToken=prototype-poison-secret");
        benign = sanitizeUrlCredentials("mapping: 4 routes resolved");
      } finally {
        String.prototype.includes = originalIncludes;
        String.prototype.split = originalSplit;
        Array.prototype.filter = originalFilter;
        Array.prototype.some = originalSome;
      }

      assertEquals(sensitive, `refreshToken=${REDACTED}`);
      assertEquals(benign, "mapping: 4 routes resolved");
    });

    it("keeps regex sanitization fail-closed after RegExp exec is replaced", () => {
      const originalExec = RegExp.prototype.exec;

      try {
        RegExp.prototype.exec = () => {
          throw new Error("project code replaced RegExp.prototype.exec");
        };

        assertEquals(
          sanitizeUrlCredentials("Using token sk-proj-abc123456789"),
          `Using token ${REDACTED}`,
        );
        assertEquals(
          sanitizeUrlCredentials("https://user:password@example.test/path"),
          `https://user:${REDACTED}@example.test/path`,
        );
        assertEquals(
          sanitizeUrlCredentials("https://example.test/?access_token=secret"),
          `https://example.test/?access_token=${REDACTED}`,
        );
        assertEquals(
          sanitizeUrlCredentials("Bearer opaque-secret"),
          `Bearer ${REDACTED}`,
        );
        assertEquals(
          sanitizeUrlCredentials("refreshToken=prototype-poison-secret"),
          `refreshToken=${REDACTED}`,
        );
        assertEquals(
          sanitizeUrlCredentials("mapping: 4 routes resolved"),
          "mapping: 4 routes resolved",
        );
      } finally {
        RegExp.prototype.exec = originalExec;
      }
    });

    it("does not inherit poisoned property-descriptor fields during regex sanitization", () => {
      const descriptorFields = [
        "value",
        "writable",
        "get",
        "set",
        "enumerable",
        "configurable",
      ] as const;
      const previousDescriptors = descriptorFields.map((field) =>
        Object.getOwnPropertyDescriptor(Object.prototype, field)
      );
      const poisonDescriptors = descriptorFields.map(() => {
        const descriptor = Object.create(null) as PropertyDescriptor;
        descriptor.configurable = true;
        descriptor.get = () => {
          throw new Error("descriptor prototype must not be read");
        };
        descriptor.set = () => {
          throw new Error("descriptor prototype must not be written");
        };
        return descriptor;
      });
      let sanitized: string[] | undefined;
      let failure: unknown;

      try {
        for (let index = 0; index < descriptorFields.length; index++) {
          Object.defineProperty(
            Object.prototype,
            descriptorFields[index]!,
            poisonDescriptors[index]!,
          );
        }
        sanitized = [
          sanitizeUrlCredentials("Using token sk-proj-abc123456789"),
          sanitizeUrlCredentials("https://user:password@example.test/path"),
          sanitizeUrlCredentials("https://example.test/?access_token=secret"),
          sanitizeUrlCredentials("refreshToken=prototype-poison-secret"),
        ];
      } catch (error) {
        failure = error;
      } finally {
        for (const field of descriptorFields) {
          Reflect.deleteProperty(Object.prototype, field);
        }
        for (let index = 0; index < descriptorFields.length; index++) {
          const previous = previousDescriptors[index];
          if (previous) Object.defineProperty(Object.prototype, descriptorFields[index]!, previous);
        }
      }

      if (failure) throw failure;
      assertEquals(sanitized, [
        `Using token ${REDACTED}`,
        `https://user:${REDACTED}@example.test/path`,
        `https://example.test/?access_token=${REDACTED}`,
        `refreshToken=${REDACTED}`,
      ]);
    });

    it("keeps structured and URL key redaction stable after collection prototypes change", () => {
      const originalMapGet = Map.prototype.get;
      const originalSetHas = Set.prototype.has;
      let structured: unknown;
      let url: string;

      try {
        Map.prototype.get = () => false;
        Set.prototype.has = () => false;
        structured = redactForSerialization({
          prototypeMutationApiKeyProbe3325: "synthetic-opaque-credential",
        });
        url = sanitizeUrlCredentials(
          "https://example.test/callback?code=synthetic-oauth-code",
        );
      } finally {
        Map.prototype.get = originalMapGet;
        Set.prototype.has = originalSetHas;
      }

      assertEquals(structured, {
        prototypeMutationApiKeyProbe3325: REDACTED,
      });
      assertEquals(
        url,
        `https://example.test/callback?code=${REDACTED}`,
      );
    });

    it("keeps credential redaction stable after string, array, and URL globals change", () => {
      const originalIndexOf = String.prototype.indexOf;
      const originalStartsWith = String.prototype.startsWith;
      const originalSearch = String.prototype.search;
      const originalCharCodeAt = String.prototype.charCodeAt;
      const originalPush = Array.prototype.push;
      const originalPop = Array.prototype.pop;
      const originalAt = Array.prototype.at;
      const originalDecodeURIComponent = globalThis.decodeURIComponent;
      let sanitizedUserinfo = "";
      let sanitizedAssignment = "";
      let sanitizedEncodedParameter = "";

      try {
        String.prototype.indexOf = () => -1;
        String.prototype.startsWith = () => false;
        String.prototype.search = () => -1;
        String.prototype.charCodeAt = () => 0;
        Array.prototype.push = () => 0;
        Array.prototype.pop = () => undefined;
        Array.prototype.at = () => undefined;
        globalThis.decodeURIComponent = () => "page";

        sanitizedUserinfo = sanitizeUrlCredentials(
          "https://user:synthetic-password@example.test/path",
        );
        sanitizedAssignment = sanitizeUrlCredentials(
          "refreshToken='synthetic-token' request continues",
        );
        sanitizedEncodedParameter = sanitizeUrlCredentials(
          "https://example.test/?access%5Ftoken=synthetic-token&page=2",
        );
      } finally {
        String.prototype.indexOf = originalIndexOf;
        String.prototype.startsWith = originalStartsWith;
        String.prototype.search = originalSearch;
        String.prototype.charCodeAt = originalCharCodeAt;
        Array.prototype.push = originalPush;
        Array.prototype.pop = originalPop;
        Array.prototype.at = originalAt;
        globalThis.decodeURIComponent = originalDecodeURIComponent;
      }

      assertEquals(
        sanitizedUserinfo,
        `https://user:${REDACTED}@example.test/path`,
      );
      assertEquals(
        sanitizedAssignment,
        `refreshToken='${REDACTED}' request continues`,
      );
      assertEquals(
        sanitizedEncodedParameter,
        `https://example.test/?access%5Ftoken=${REDACTED}&page=2`,
      );
    });

    it("keeps composite auth fields and trailing warning text visible", () => {
      const warning =
        "MCP server started with auth.type='none' (allowUnauthenticated) - all requests accepted";

      assertEquals(sanitizeUrlCredentials(warning), warning);
      assertEquals(
        sanitizeUrlCredentials("auth='synthetic-secret' warning remains visible"),
        `auth='${REDACTED}' warning remains visible`,
      );
      assertEquals(
        sanitizeUrlCredentials("authHeader='synthetic-secret' warning remains visible"),
        `authHeader='${REDACTED}' warning remains visible`,
      );
      assertEquals(
        sanitizeUrlCredentials("auth.header='synthetic-secret' warning remains visible"),
        `auth.header='${REDACTED}' warning remains visible`,
      );
    });

    it("masks common provider token prefixes without assignment syntax", () => {
      const message = "Using token sk-proj-abc123456789";
      const sanitized = sanitizeUrlCredentials(message);

      assertEquals(sanitized.includes("sk-proj-abc123456789"), false);
      assertEquals(sanitized, `Using token ${REDACTED}`);
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

    it("returns undefined unchanged", () => {
      assertEquals(sanitizeSerializedError(undefined), undefined);
    });
  });

  describe("redactPathFromText", () => {
    it("folds ASCII case and separators for Windows drive paths", () => {
      assertEquals(
        redactPathFromText(
          "ENOENT: no such file 'C:/Users/Me/proj/a.js'",
          "C:\\Users\\me\\proj",
          "[path]",
        ),
        "ENOENT: no such file '[path]/a.js'",
        "windows drive paths fold ASCII case and slash/backslash",
      );
    });

    it("keeps POSIX paths case sensitive", () => {
      assertEquals(
        redactPathFromText("/home/Me/p/a.js", "/home/me/p", "[path]"),
        "/home/Me/p/a.js",
        "posix paths must not fold case",
      );
    });

    it("replaces every occurrence", () => {
      assertEquals(
        redactPathFromText("a /x/y b /x/y c", "/x/y", "[p]"),
        "a [p] b [p] c",
        "every occurrence is replaced",
      );
    });

    it("returns the input unchanged for an empty path", () => {
      assertEquals(
        redactPathFromText("abc", "", "[p]"),
        "abc",
        "an empty path returns the input unchanged",
      );
    });
  });
});
