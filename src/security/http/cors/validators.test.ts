import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { validateCORSConfig, validateOrigin, validateOriginSync } from "./validators.ts";

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
    it("should allow when function returns true", () => {
      const result = validateOriginSync("https://sub.example.com", {
        origin: (o) => o.endsWith(".example.com"),
      });
      assertEquals(result.allowedOrigin, "https://sub.example.com");
    });

    it("should deny when function returns false", () => {
      const result = validateOriginSync("https://evil.com", {
        origin: (o) => o.endsWith(".example.com"),
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
  });
});

describe("validateOrigin (async)", () => {
  it("should allow matching origin", async () => {
    const result = await validateOrigin("https://example.com", {
      origin: "https://example.com",
    });
    assertEquals(result.allowedOrigin, "https://example.com");
  });

  it("should support async validation functions", async () => {
    const result = await validateOrigin("https://example.com", {
      origin: async (o) => {
        await Promise.resolve();
        return o === "https://example.com";
      },
    });
    assertEquals(result.allowedOrigin, "https://example.com");
  });

  it("should handle rejected async validator", async () => {
    const result = await validateOrigin("https://evil.com", {
      origin: async (o) => {
        await Promise.resolve();
        return o === "https://example.com";
      },
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
    assertEquals(result.error, "maxAge must be a positive number");
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
});
