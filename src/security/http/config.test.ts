import "#veryfront/schemas/_test-setup.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { clearConfigCache, type VeryfrontConfig } from "#veryfront/config";
import {
  deriveSecurityContext,
  isValidSecurityConfig,
  loadSecurityConfig,
  SecurityConfigLoader,
} from "./config.ts";

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
    clearConfigCache();
    if (originalNodeEnv === undefined) Deno.env.delete("NODE_ENV");
    else Deno.env.set("NODE_ENV", originalNodeEnv);
  });

  it("validates compatibility inputs through the canonical security schema", () => {
    assertEquals(
      isValidSecurityConfig({
        cors: { origin: "https://client.example", methods: ["GET"] },
        csrf: true,
      }),
      true,
    );
    assertEquals(isValidSecurityConfig({ csrf: "enabled" }), false);
    assertEquals(isValidSecurityConfig({ unknownPolicy: true }), false);

    let getterCalls = 0;
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, "csrf", {
      enumerable: true,
      get() {
        getterCalls++;
        return true;
      },
    });

    assertEquals(isValidSecurityConfig(hostile), false);
    assertEquals(getterCalls, 0);
  });

  it("loads a frozen compatibility snapshot and reserves null for absent policy", async () => {
    const configuredProject = await Deno.makeTempDir({ prefix: "vf-security-configured-" });
    const defaultProject = await Deno.makeTempDir({ prefix: "vf-security-default-" });

    try {
      await Deno.writeTextFile(
        `${configuredProject}/veryfront.config.js`,
        'export default { security: { csrf: true, cors: { methods: ["GET"] } } };',
      );

      const loaded = await loadSecurityConfig(configuredProject, new DenoAdapter());
      const absent = await loadSecurityConfig(defaultProject, new DenoAdapter());

      assertEquals(loaded?.csrf, true);
      assertEquals(
        (loaded?.cors as { methods?: string[] } | undefined)?.methods,
        ["GET"],
      );
      assertEquals(Object.isFrozen(loaded), true);
      assertEquals(Object.isFrozen((loaded?.cors as { methods?: string[] })?.methods), true);
      assertEquals(absent, null);
    } finally {
      await Deno.remove(configuredProject, { recursive: true });
      await Deno.remove(defaultProject, { recursive: true });
    }
  });

  it("propagates invalid project configuration instead of failing open", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-security-invalid-" });

    try {
      await Deno.writeTextFile(
        `${projectDir}/veryfront.config.js`,
        'export default { security: { csrf: "enabled" } };',
      );

      await assertRejects(
        () => loadSecurityConfig(projectDir, new DenoAdapter()),
        Error,
        "security.csrf",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("merges object CSP config into the policy the loader builds", async () => {
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

    const csp = loader.buildCsp(false, "abc123");
    assert(
      csp.includes("'nonce-abc123'"),
      "the {NONCE} placeholder is substituted in project sources",
    );
    assert(csp.includes("object-src 'none'"), "project config merges into the floor");
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

  it("does not expose a reset race after publishing security state", async () => {
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
    assertEquals(loader.getSecurityConfig()?.csp, { "default-src": ["'self'"] });

    assertEquals("reset" in loader, false);
    assertEquals(loader.getSecurityConfig()?.cors, true);
    assertEquals(loader.getSecurityConfig()?.csp, { "default-src": ["'self'"] });
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

  it("honors standalone production intent when process env is development", async () => {
    Deno.env.set("NODE_ENV", "development");
    const loader = new SecurityConfigLoader(
      "/project",
      createMockAdapter(),
      {
        security: {},
      },
      true,
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

  it("does not warn for the same-origin development default", async () => {
    Deno.env.set("NODE_ENV", "development");
    const { getOutput, restore } = captureConsoleLog();
    const loader = new SecurityConfigLoader(
      "/project",
      createMockAdapter(),
      { security: {} },
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
    const { getOutput, restore } = captureConsoleLog();
    const loader = new SecurityConfigLoader(
      "/project",
      createMockAdapter(),
      {
        security: { csrf: false },
      },
    );

    try {
      await loader.ensureLoaded();
    } finally {
      restore();
    }

    assertEquals(loader.getSecurityConfig()?.csrf, false);
    assertEquals(getOutput().includes("Neither CORS nor CSRF protection is configured"), true);
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
        redirects: {
          allowedOrigins: ["https://accounts.example.com"],
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
    assertEquals(Object.isFrozen(first.securityConfig.redirects), true);
    assertEquals(Object.isFrozen(first.securityConfig.redirects?.allowedOrigins), true);
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
    assertEquals(first.securityConfig.csp, { "default-src": ["'none'"] });

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

  it("rejects hostile configuration shapes without invoking accessors", () => {
    let configGetterCalls = 0;
    const config = {} as Record<string, unknown>;
    Object.defineProperty(config, "security", {
      enumerable: true,
      get() {
        configGetterCalls++;
        return { csrf: true };
      },
    });
    assertThrows(() => deriveSecurityContext(config as VeryfrontConfig), TypeError);
    assertEquals(configGetterCalls, 0);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assertThrows(
      () => deriveSecurityContext({ security: cyclic } as VeryfrontConfig),
      TypeError,
    );

    let optionGetterCalls = 0;
    const options = {} as Record<string, unknown>;
    Object.defineProperty(options, "productionDefaults", {
      enumerable: true,
      get() {
        optionGetterCalls++;
        return true;
      },
    });
    assertThrows(
      () => deriveSecurityContext(undefined, options as never),
      TypeError,
    );
    assertEquals(optionGetterCalls, 0);
  });

  it("rejects a failed load for the current caller and retries on the next call", async () => {
    let shouldFail = true;
    const config = new Proxy(
      { security: { csrf: true } },
      {
        getOwnPropertyDescriptor(target, property) {
          if (property === "security" && shouldFail) throw new Error("config load failed");
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      },
    );
    const loader = new SecurityConfigLoader("/project", createMockAdapter(), config);

    await assertRejects(
      () => loader.ensureLoaded(),
      TypeError,
      "Invalid security configuration",
    );
    assertEquals(loader.getSecurityConfig(), null);

    shouldFail = false;
    await loader.ensureLoaded();

    assertEquals(loader.getSecurityConfig()?.csrf, true);
  });
});
