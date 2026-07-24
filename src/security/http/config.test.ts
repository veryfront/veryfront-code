import "#veryfront/schemas/_test-setup.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { deriveSecurityContext, SecurityConfigLoader } from "./config.ts";

function captureConsoleLog(): { getOutput: () => string; restore: () => void } {
  const originalWarn = console.warn;
  let capturedOutput = "";

  console.warn = (msg: string) => {
    capturedOutput += `${msg}\n`;
  };

  return {
    getOutput: () => capturedOutput,
    restore: () => {
      console.warn = originalWarn;
    },
  };
}

function createMockAdapter(
  envMap: Record<string, string> = {},
): RuntimeAdapter {
  return {
    env: {
      get(key: string) {
        return envMap[key];
      },
    },
  } as RuntimeAdapter;
}

describe("security/http/config", () => {
  const originalNodeEnv = Deno.env.get("NODE_ENV");

  afterEach(() => {
    if (originalNodeEnv === undefined) Deno.env.delete("NODE_ENV");
    else Deno.env.set("NODE_ENV", originalNodeEnv);
  });

  it("serializes object CSP config for downstream handler context", async () => {
    const loader = new SecurityConfigLoader(
      "/project",
      createMockAdapter(),
      {
        security: {
          csp: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "'nonce-{NONCE}'"],
          },
        },
      },
    );

    await loader.ensureLoaded();

    assertEquals(
      loader.getCspUserHeader(),
      "default-src 'self'; script-src 'self' 'nonce-{NONCE}'",
    );
    assertEquals(
      loader.buildCsp(false, "abc123"),
      "default-src 'self'; script-src 'self' 'nonce-abc123'",
    );
  });

  it("prefers configured headers over env headers and falls back to defaults", async () => {
    const loader = new SecurityConfigLoader(
      "/project",
      createMockAdapter({
        VERYFRONT_COOP: "unsafe-none",
        VERYFRONT_CORP: "cross-origin",
      }),
      {
        security: {
          coop: "same-origin",
        },
      },
    );

    await loader.ensureLoaded();

    assertEquals(loader.getSecurityHeader("COOP", "same-origin-allow-popups"), "same-origin");
    assertEquals(loader.getSecurityHeader("CORP", "same-origin"), "cross-origin");
    assertEquals(loader.getSecurityHeader("COEP", "require-corp"), "require-corp");
  });

  it("reset clears cached security state", async () => {
    const loader = new SecurityConfigLoader(
      "/project",
      createMockAdapter(),
      {
        security: {
          csp: { "default-src": ["'self'"] },
          cors: true,
        },
      },
    );

    await loader.ensureLoaded();

    assertEquals(loader.getSecurityConfig()?.cors, true);
    assertEquals(loader.getCspUserHeader(), "default-src 'self'");

    loader.reset();

    assertEquals(loader.getSecurityConfig(), null);
    assertEquals(loader.getCspUserHeader(), null);
    assertEquals(loader.getCorsConfig(), undefined);
  });

  it("defaults CSRF protection on in production when not explicitly configured", async () => {
    Deno.env.set("NODE_ENV", "production");
    const loader = new SecurityConfigLoader(
      "/project",
      createMockAdapter(),
      {
        security: {},
      },
    );

    await loader.ensureLoaded();

    assertEquals(loader.getSecurityConfig()?.csrf, true);
  });

  it("does not warn that CSRF is unconfigured when production defaults enable it", async () => {
    Deno.env.set("NODE_ENV", "production");
    const { getOutput, restore } = captureConsoleLog();
    const loader = new SecurityConfigLoader(
      "/project",
      createMockAdapter(),
      {
        security: {},
      },
    );

    try {
      await loader.ensureLoaded();
    } finally {
      restore();
    }

    assertEquals(getOutput().includes("Neither CORS nor CSRF protection is configured"), false);
  });

  it("honors explicit CSRF disablement in production", async () => {
    Deno.env.set("NODE_ENV", "production");
    const loader = new SecurityConfigLoader(
      "/project",
      createMockAdapter(),
      {
        security: { csrf: false },
      },
    );

    await loader.ensureLoaded();

    assertEquals(loader.getSecurityConfig()?.csrf, false);
  });

  it("derives a deep-frozen request-owned security context without mutating config", () => {
    const originValidator = (origin: string) => origin === "https://client.example";
    const config = {
      security: {
        cors: {
          origin: originValidator,
          methods: ["GET"],
          allowedHeaders: ["authorization"],
        },
        csrf: {
          excludePaths: ["/webhooks"],
        },
        csp: {
          "default-src": ["'none'"],
        },
        auth: {
          basic: {
            username: "alice",
            password: "secret",
          },
        },
      },
    } as VeryfrontConfig;

    const first = deriveSecurityContext(config, { productionDefaults: true });
    const second = deriveSecurityContext(config, { productionDefaults: true });
    const sourceCors = config.security?.cors as Exclude<
      NonNullable<NonNullable<VeryfrontConfig["security"]>["cors"]>,
      boolean
    >;
    const derivedCors = first.securityConfig.cors as Exclude<
      NonNullable<typeof first.securityConfig.cors>,
      boolean
    >;

    assertEquals(first.securityConfig === config.security, false);
    assertEquals(first.securityConfig === second.securityConfig, false);
    assertEquals(derivedCors === sourceCors, false);
    assertEquals(derivedCors.methods === sourceCors.methods, false);
    assertEquals(Object.isFrozen(first), true);
    assertEquals(Object.isFrozen(first.securityConfig), true);
    assertEquals(Object.isFrozen(derivedCors), true);
    assertEquals(Object.isFrozen(derivedCors.methods), true);
    assertEquals(derivedCors.origin === originValidator, false);
    assertEquals(Object.isFrozen(derivedCors.origin), true);
    assertEquals(
      typeof derivedCors.origin === "function" &&
        derivedCors.origin("https://client.example"),
      true,
    );
    assertEquals(
      typeof (second.securityConfig.cors as { origin?: unknown }).origin === "function" &&
        (second.securityConfig.cors as { origin?: unknown }).origin === derivedCors.origin,
      false,
    );
    assertEquals(first.cspUserHeader, "default-src 'none'");

    sourceCors.methods?.push("POST");
    assertEquals(derivedCors.methods, ["GET"]);
  });

  it("applies production defaults without overriding explicit security choices", () => {
    const production = deriveSecurityContext(
      { security: { csrf: false, cors: false } },
      { productionDefaults: true },
    );
    const development = deriveSecurityContext(
      { security: {} },
      { productionDefaults: false },
    );

    assertEquals(production.securityConfig.csrf, false);
    assertEquals(production.securityConfig.cors, false);
    assertEquals(development.securityConfig.csrf, undefined);
    assertEquals(development.securityConfig.cors, false);
  });

  it("rejects a failed load for the current caller and retries on the next call", async () => {
    let shouldFail = true;
    const config = new Proxy(
      { security: { csrf: true } },
      {
        get(target, property, receiver) {
          if (shouldFail) throw new Error("config load failed");
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const loader = new SecurityConfigLoader("/project", createMockAdapter(), config);

    await assertRejects(
      () => loader.ensureLoaded(),
      Error,
      "config load failed",
    );
    assertEquals(loader.getSecurityConfig(), null);

    shouldFail = false;
    await loader.ensureLoaded();

    assertEquals(loader.getSecurityConfig()?.csrf, true);
  });
});
