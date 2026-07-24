import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { cors } from "./middleware.ts";
import {
  corsOriginForTelemetry,
  validateCORSConfig,
  validateOrigin,
  validateOriginSync,
} from "./validators.ts";
import {
  MAX_CORS_ORIGIN_COUNT,
  MAX_CORS_ORIGIN_LENGTH,
  MAX_CORS_TOKEN_COUNT,
  MAX_CORS_TOKEN_LENGTH,
} from "#veryfront/utils/cors-policy-limits.ts";

describe("validateOriginSync", () => {
  describe("no config", () => {
    it("should return null origin when config is undefined", () => {
      const result = validateOriginSync("https://example.com", undefined);
      assertEquals(result.allowedOrigin, null);
      assertEquals(result.allowCredentials, false);
    });

    it("should return null origin when config is false", () => {
      const result = validateOriginSync("https://example.com", false);
      assertEquals(result.allowedOrigin, null);
      assertEquals(result.allowCredentials, false);
    });

    it("returns fresh immutable denial results", () => {
      const first = validateOriginSync("https://example.com", undefined);
      const second = validateOriginSync("https://example.com", undefined);

      assertEquals(first === second, false);
      assertEquals(Object.isFrozen(first), true);
      assertEquals(Object.isFrozen(second), true);
    });
  });

  describe("config = true", () => {
    it("should allow any origin", () => {
      const result = validateOriginSync("https://example.com", true);
      assertEquals(result.allowedOrigin, "https://example.com");
      assertEquals(result.allowCredentials, false);
    });

    it("should return wildcard when no origin header", () => {
      const result = validateOriginSync(null, true);
      assertEquals(result.allowedOrigin, "*");
    });
  });

  describe("wildcard origin", () => {
    it("should allow any origin with wildcard", () => {
      const result = validateOriginSync("https://example.com", { origin: "*" });
      assertEquals(result.allowedOrigin, "*");
      assertEquals(result.allowCredentials, false);
    });

    it("should deny credentials with wildcard", () => {
      const result = validateOriginSync("https://example.com", {
        origin: "*",
        credentials: true,
      });
      assertEquals(result.allowedOrigin, null);
      assertEquals(result.error, "Cannot use credentials with wildcard origin");
    });

    it("should return wildcard when no request origin", () => {
      const result = validateOriginSync(null, { origin: "*" });
      assertEquals(result.allowedOrigin, "*");
    });
  });

  describe("string origin", () => {
    it("should allow matching origin", () => {
      const result = validateOriginSync("https://example.com", {
        origin: "https://example.com",
      });
      assertEquals(result.allowedOrigin, "https://example.com");
    });

    it("should deny non-matching origin", () => {
      const result = validateOriginSync("https://evil.com", {
        origin: "https://example.com",
      });
      assertEquals(result.allowedOrigin, null);
      assertEquals(result.error, "Origin does not match");
    });

    it("should include credentials flag when allowed", () => {
      const result = validateOriginSync("https://example.com", {
        origin: "https://example.com",
        credentials: true,
      });
      assertEquals(result.allowCredentials, true);
    });
  });

  describe("array origin", () => {
    it("should allow origin in array", () => {
      const result = validateOriginSync("https://app.example.com", {
        origin: ["https://example.com", "https://app.example.com"],
      });
      assertEquals(result.allowedOrigin, "https://app.example.com");
    });

    it("should deny origin not in array", () => {
      const result = validateOriginSync("https://evil.com", {
        origin: ["https://example.com", "https://app.example.com"],
      });
      assertEquals(result.allowedOrigin, null);
      assertEquals(result.error, "Origin not in allowlist");
    });
  });

  describe("function origin (sync)", () => {
    const endsWithExample = (o: string): boolean => o.endsWith(".example.com");

    it("should allow when function returns true", () => {
      const result = validateOriginSync("https://sub.example.com", {
        origin: endsWithExample,
      });
      assertEquals(result.allowedOrigin, "https://sub.example.com");
    });

    it("should deny when function returns false", () => {
      const result = validateOriginSync("https://evil.com", {
        origin: endsWithExample,
      });
      assertEquals(result.allowedOrigin, null);
      assertEquals(result.error, "Origin rejected by validation function");
    });

    it("should use returned string as allowed origin", () => {
      const result = validateOriginSync("https://example.com", {
        origin: () => "https://allowed.com",
      });
      assertEquals(result.allowedOrigin, "https://allowed.com");
    });

    it("should handle errors in validation function", () => {
      const result = validateOriginSync("https://example.com", {
        origin: () => {
          throw new Error("Test error");
        },
      });
      assertEquals(result.allowedOrigin, null);
      assertEquals(result.error, "Origin validation error");
    });

    it("does not invoke validators for unsafe request origins", () => {
      let calls = 0;
      const result = validateOriginSync("https://例.example", {
        origin: () => {
          calls++;
          return true;
        },
      });

      assertEquals(calls, 0);
      assertEquals(result.allowedOrigin, null);
      assertEquals(result.error, "Invalid or oversized request origin");
    });

    it("rejects malformed non-string request origins without throwing", () => {
      for (const origin of [undefined, 42, {}, Symbol("origin")]) {
        const result = validateOriginSync(origin as never, true);
        assertEquals(result.allowedOrigin, null);
        assertEquals(result.error, "Invalid or oversized request origin");
      }
    });
  });
});

describe("validateOrigin (async)", () => {
  it("should allow matching origin", async () => {
    const result = await validateOrigin("https://example.com", {
      origin: "https://example.com",
    });
    assertEquals(result.allowedOrigin, "https://example.com");
  });

  const asyncEqualsExample = async (o: string): Promise<boolean> => {
    await Promise.resolve();
    return o === "https://example.com";
  };

  it("should support async validation functions", async () => {
    const result = await validateOrigin("https://example.com", {
      origin: asyncEqualsExample,
    });
    assertEquals(result.allowedOrigin, "https://example.com");
  });

  it("should handle rejected async validator", async () => {
    const result = await validateOrigin("https://evil.com", {
      origin: asyncEqualsExample,
    });
    assertEquals(result.allowedOrigin, null);
  });

  it("should handle async function returning string", async () => {
    const result = await validateOrigin("https://example.com", {
      origin: async () => {
        await Promise.resolve();
        return "https://custom.com";
      },
    });
    assertEquals(result.allowedOrigin, "https://custom.com");
  });

  it("should handle errors in async validation", async () => {
    const result = await validateOrigin("https://example.com", {
      origin: async () => {
        await Promise.resolve();
        throw new Error("Async error");
      },
    });
    assertEquals(result.allowedOrigin, null);
    assertEquals(result.error, "Origin validation error");
  });

  it("rejects unsafe callback-returned origins and wildcard credentials", async () => {
    for (
      const [returnedOrigin, credentials] of [
        ["https://例.example", false],
        [" https://example.com", false],
        ["https://example.com\r\nX-Injected: yes", false],
        ["*", true],
      ] as const
    ) {
      const result = await validateOrigin("https://request.example", {
        origin: () => returnedOrigin,
        credentials,
      });

      assertEquals(result.allowedOrigin, null);
    }
  });
});

describe("validateCORSConfig", () => {
  it("should accept undefined config", () => {
    const result = validateCORSConfig(undefined);
    assertEquals(result.valid, true);
  });

  it("should accept config = true", () => {
    const result = validateCORSConfig(true);
    assertEquals(result.valid, true);
  });

  it("should accept valid config", () => {
    const result = validateCORSConfig({
      origin: "https://example.com",
      methods: ["GET", "POST"],
      credentials: true,
    });
    assertEquals(result.valid, true);
  });

  it("should reject credentials with wildcard", () => {
    const result = validateCORSConfig({
      origin: "*",
      credentials: true,
    });
    assertEquals(result.valid, false);
    assertEquals(result.error, "Cannot use credentials with wildcard origin (*)");
  });

  it("should reject empty methods array", () => {
    const result = validateCORSConfig({
      origin: "https://example.com",
      methods: [],
    });
    assertEquals(result.valid, false);
    assertEquals(result.error, "methods array cannot be empty");
  });

  it("should reject empty allowedHeaders array", () => {
    const result = validateCORSConfig({
      origin: "https://example.com",
      allowedHeaders: [],
    });
    assertEquals(result.valid, false);
    assertEquals(result.error, "allowedHeaders array cannot be empty");
  });

  it("should reject empty exposedHeaders array", () => {
    const result = validateCORSConfig({
      origin: "https://example.com",
      exposedHeaders: [],
    });
    assertEquals(result.valid, false);
    assertEquals(result.error, "exposedHeaders array cannot be empty");
  });

  it("should reject negative maxAge", () => {
    const result = validateCORSConfig({
      origin: "https://example.com",
      maxAge: -1,
    });
    assertEquals(result.valid, false);
    assertEquals(result.error, "maxAge must be a non-negative safe integer");
  });

  it("should accept zero maxAge", () => {
    const result = validateCORSConfig({
      origin: "https://example.com",
      maxAge: 0,
    });
    assertEquals(result.valid, true);
  });

  it("should accept positive maxAge", () => {
    const result = validateCORSConfig({
      origin: "https://example.com",
      maxAge: 3600,
    });
    assertEquals(result.valid, true);
  });

  it("should reject malformed method and header tokens", () => {
    for (
      const config of [
        { origin: "https://example.com\r\nX-Injected: yes" },
        { methods: ["GET, POST"] },
        { methods: ["GET\nInjected"] },
        { allowedHeaders: ["X Invalid"] },
        { exposedHeaders: ["X-Valid\r\nInjected"] },
      ]
    ) {
      assertEquals(validateCORSConfig(config).valid, false);
    }

    assertEquals(
      validateOriginSync("a".repeat(MAX_CORS_ORIGIN_LENGTH + 1), true).allowedOrigin,
      null,
    );
  });

  it("should reject oversized CORS origins, lists, tokens, and aggregate header values", () => {
    const tooManyTokens = Array.from(
      { length: MAX_CORS_TOKEN_COUNT + 1 },
      (_, index) => `X-${index}`,
    );
    const aggregateTokens = Array.from(
      { length: 17 },
      (_, index) => `${"X".repeat(MAX_CORS_TOKEN_LENGTH - 3)}${String(index).padStart(3, "0")}`,
    );
    const aggregateOrigins = Array.from(
      { length: Math.min(MAX_CORS_ORIGIN_COUNT, 5) },
      (_, index) => `${index}${"a".repeat(MAX_CORS_ORIGIN_LENGTH - 1)}`,
    );

    for (
      const config of [
        { origin: "a".repeat(MAX_CORS_ORIGIN_LENGTH + 1) },
        { origin: aggregateOrigins },
        { methods: ["M".repeat(MAX_CORS_TOKEN_LENGTH + 1)] },
        { allowedHeaders: tooManyTokens },
        { exposedHeaders: aggregateTokens },
      ]
    ) {
      assertEquals(validateCORSConfig(config).valid, false);
    }
  });

  it("should reject an oversized origin returned by a validator", async () => {
    const result = await validateOrigin("https://request.example", {
      origin: () => "a".repeat(MAX_CORS_ORIGIN_LENGTH + 1),
    });

    assertEquals(result.allowedOrigin, null);
    assertEquals(result.error, "Origin validator returned an invalid or oversized origin");
  });

  it("should reject non-integer, non-finite, and unsafe maxAge values", () => {
    for (const maxAge of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      assertEquals(
        validateCORSConfig({ origin: "https://example.com", maxAge }).valid,
        false,
      );
    }
  });

  it("should reject malformed runtime option shapes without throwing", () => {
    for (
      const config of [
        null,
        1,
        [],
        { origin: "" },
        { origin: [] },
        { origin: ["https://example.com", 1] },
        { credentials: "true" },
        { methods: "GET" },
        { allowedHeaders: "Authorization" },
        { exposedHeaders: {} },
        { origin: "https://例.example" },
        { origin: " https://example.com" },
        { maxAge: "3600" },
        { unknown: true },
      ]
    ) {
      assertEquals(validateCORSConfig(config as never).valid, false);
    }
  });

  it("rejects accessor-backed and inherited runtime options without invoking them", () => {
    let getterCalls = 0;
    const accessorConfig = Object.defineProperty({}, "origin", {
      enumerable: true,
      get() {
        getterCalls++;
        return "*";
      },
    });
    const inheritedConfig = Object.create({ origin: "*" });

    assertEquals(validateCORSConfig(accessorConfig as never).valid, false);
    assertEquals(validateCORSConfig(inheritedConfig as never).valid, false);
    assertEquals(getterCalls, 0);
  });

  it("fails closed for revoked configuration and list proxies", () => {
    const revokedConfig = Proxy.revocable({}, {});
    const revokedOrigins = Proxy.revocable(["https://example.com"], {});
    const revokedMethods = Proxy.revocable(["GET"], {});
    revokedConfig.revoke();
    revokedOrigins.revoke();
    revokedMethods.revoke();

    for (
      const config of [
        revokedConfig.proxy,
        { origin: revokedOrigins.proxy },
        { methods: revokedMethods.proxy },
      ]
    ) {
      assertEquals(validateCORSConfig(config as never).valid, false);
    }
  });

  it("uses a fixed bounded error for every unknown option name", () => {
    for (
      const key of [
        "unknown\r\nX-Injected: yes",
        "non-byte-\u{100}",
        "x".repeat(100_000),
      ]
    ) {
      const result = validateCORSConfig({ [key]: true } as never);
      assertEquals(result, {
        valid: false,
        error: "configuration contains unknown options",
      });
    }
  });

  it("should reject malformed values through the public cors factory", () => {
    assertThrows(
      () => cors({ methods: ["GET, POST"] }),
      Error,
      "Invalid configuration",
    );
    assertThrows(
      () => cors({ allowedHeaders: ["X Invalid"] }),
      Error,
      "Invalid configuration",
    );
    assertThrows(
      () => cors({ maxAge: Number.NaN }),
      Error,
      "Invalid configuration",
    );
  });
});

Deno.test("CORS telemetry origins are bounded before tracing", () => {
  assertEquals(corsOriginForTelemetry("https://example.com"), "https://example.com");
  assertEquals(corsOriginForTelemetry(null), "null");
  assertEquals(corsOriginForTelemetry("https://例.example"), "invalid");
  assertEquals(
    corsOriginForTelemetry("a".repeat(MAX_CORS_ORIGIN_LENGTH + 1)),
    "invalid",
  );
  assertEquals(corsOriginForTelemetry({}), "invalid");
});

Deno.test("sync validation observes rejected Promises and thenables", async () => {
  const validatorsUrl = new URL("./validators.ts", import.meta.url).href;
  const source = `
    import { validateOriginSync } from ${JSON.stringify(validatorsUrl)};

    const validators = [
      async () => {
        throw new Error("expected Promise rejection");
      },
      () => ({
        then(_resolve, reject) {
          queueMicrotask(() => reject(new Error("expected thenable rejection")));
        },
      }),
    ];
    for (const origin of validators) {
      const result = validateOriginSync("https://example.com", {
        origin,
      });
      if (result.allowedOrigin !== null) {
        throw new Error("async validator was not denied");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  `;
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["eval", "--frozen", "--config=deno.json", source],
    stdout: "piped",
    stderr: "piped",
  }).output();

  assertEquals(
    output.success,
    true,
    new TextDecoder().decode(output.stderr),
  );
});
