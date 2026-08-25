import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_CACHE_TTL_MILLISECONDS } from "#veryfront/cache/backends/ttl.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { MAX_SOURCE_INTEGRATION_POLICY_TOOL_IDS } from "#veryfront/integrations/limits.ts";
import { csrfHttpTokenCookieName, csrfNamesCookieName } from "#veryfront/security/csrf/names.ts";
import {
  MAX_CORS_ORIGIN_COUNT,
  MAX_CORS_ORIGIN_LENGTH,
  MAX_CORS_TOKEN_COUNT,
  MAX_CORS_TOKEN_LENGTH,
} from "#veryfront/utils/cors-policy-limits.ts";
import {
  MAX_REMOTE_HOST_COUNT,
  MAX_REMOTE_HOST_URL_LENGTH,
} from "#veryfront/utils/remote-host-policy-limits.ts";
import {
  MAX_FILE_LOG_FILES,
  MAX_GITHUB_FILESYSTEM_ATTEMPTS,
  MAX_VERYFRONT_FILESYSTEM_RETRIES,
} from "#veryfront/utils/config-resource-limits.ts";
import { CSS_OPTIMIZATION } from "#veryfront/utils/constants/build.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import type { AuthConfig } from "#veryfront/security/http/middleware/types.ts";
import { validateVeryfrontConfig, type VeryfrontConfig } from "./config.schema.ts";

/** Derived from the schema so the test tracks it instead of restating the union. */
type ImageFormat = NonNullable<
  NonNullable<NonNullable<VeryfrontConfig["assetPipeline"]>["images"]>["formats"]
>[number];

const VALID_OIDC_AUTH = {
  oidc: {
    issuerEnvVar: "OIDC_ISSUER",
    clientIdEnvVar: "OIDC_CLIENT_ID",
    clientSecretEnvVar: "OIDC_CLIENT_SECRET",
    sessionSecretEnvVar: "VERYFRONT_AUTH_SESSION_SECRET",
    scopes: ["openid", "profile", "email", "groups"],
    claims: {
      email: "email",
      name: "name",
      groups: "groups",
      roles: "roles",
    },
  },
} satisfies AuthConfig;

const VALID_TRUSTED_PROXY_AUTH = {
  trustedProxy: {
    trustedPeers: ["127.0.0.1", "::1"],
    headers: {
      subject: "x-auth-subject",
      email: "x-auth-email",
      name: "x-auth-name",
      groups: "x-auth-groups",
      roles: "x-auth-roles",
    },
  },
} satisfies AuthConfig;

describe("configSchema", () => {
  it("validates valid config", () => {
    const cfg = validateVeryfrontConfig({
      router: "app",
      security: { cors: true, remoteHosts: ["https://esm.sh"] },
    });

    assertEquals(cfg.router, "app");
  });

  it("rejects opting out of ESM layouts with migration guidance", () => {
    const error = assertThrows(
      () => validateVeryfrontConfig({ experimental: { esmLayouts: false } }),
      Error,
      "experimental.esmLayouts",
    ) as Error;

    // The flag no longer controls behavior, so the rejection must tell the
    // user to remove it and where the migration is documented.
    assertStringIncludes(error.message, "Remove the setting");
    assertStringIncludes(error.message, "docs/guides/configuration.md");
    assertEquals(
      error.message.includes("—"),
      false,
      "public configuration guidance must use ASCII punctuation",
    );
  });

  it("keeps CSS asset-pipeline schema constraints aligned with runtime", () => {
    const projectDir = Deno.cwd();
    const css = {
      enabled: true,
      projectDir,
      inputFiles: ["styles/main.css"],
      browsers: ["defaults", "not IE 11"],
      purge: true,
      purgeContent: ["app/**/*.tsx"],
      purgeSafelist: ["dynamic"],
    };
    assertEquals(
      validateVeryfrontConfig({ assetPipeline: { css } }).assetPipeline?.css,
      css,
    );

    for (
      const invalid of [
        { projectDir: "relative/project" },
        { browsers: [] },
        { criticalCSS: true },
        { purge: true, sourceMap: true },
        { purge: true, purgeContent: [] },
        {
          purgeSafelist: Array.from(
            { length: CSS_OPTIMIZATION.MAX_PURGE_SAFELIST_ENTRIES + 1 },
            (_, index) => `selector-${index}`,
          ),
        },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ assetPipeline: { css: invalid } }),
        Error,
        "assetPipeline.css",
      );
    }
  });

  it("keeps image asset-pipeline schema constraints aligned with runtime", () => {
    const formats: ImageFormat[] = ["webp", "png"];
    const images = {
      projectDir: Deno.cwd(),
      formats,
      sizes: [320, 640],
      quality: 85,
      inputDir: "public",
      outputDir: ".veryfront/images",
      preserveOriginal: true,
    };
    assertEquals(
      validateVeryfrontConfig({ assetPipeline: { images } }).assetPipeline
        ?.images,
      images,
    );

    for (
      const invalid of [
        { projectDir: "relative/project" },
        { formats: [] },
        { formats: ["webp", "webp"] },
        { sizes: [320, 320] },
        { inputDir: "" },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ assetPipeline: { images: invalid } }),
        Error,
        "assetPipeline.images",
      );
    }
  });

  it("rejects unknown top-level keys through the public validator", () => {
    const error = assertThrows(() =>
      validateVeryfrontConfig({
        title: "Typo",
        buid: { outDir: "dist" },
      })
    );

    assertEquals(error instanceof VeryfrontError, true);
    assertEquals((error as VeryfrontError).slug, "config-validation-failed");
    assertEquals(
      (error as Error).message,
      'Invalid veryfront.config at <root>: Unrecognized key: "buid".',
    );
    assertEquals((error as VeryfrontError).context, {
      field: "<root>",
      expected: 'Unrecognized key: "buid"',
    });
  });

  it("rejects unknown keys in closed nested configuration objects", () => {
    const github = { token: "token", owner: "owner", repo: "repo" };
    for (
      const [config, path, key] of [
        [{ dev: { potr: 4444 } }, "dev", "potr"],
        [{ build: { outDri: "dist" } }, "build", "outDri"],
        [
          { fs: { type: "github", github: { ...github, cach: {} } } },
          "fs.github",
          "cach",
        ],
        [
          { ai: { tools: { discovery: { pahts: [] } } } },
          "ai.tools.discovery",
          "pahts",
        ],
      ] as const
    ) {
      const error = assertThrows(
        () => validateVeryfrontConfig(config),
        Error,
        `Invalid veryfront.config at ${path}:`,
      );
      assertEquals(error instanceof VeryfrontError, true);
      assertEquals((error as VeryfrontError).slug, "config-validation-failed");
      assertEquals((error as VeryfrontError).context, {
        field: path,
        expected: `Unrecognized key: "${key}"`,
      });
    }
  });

  it("rejects unsafe and unbounded AI discovery roots", () => {
    for (
      const path of [
        "",
        ".",
        "../tools",
        "tools/../outside",
        "tools//nested",
        "/absolute/tools",
        String.raw`C:\absolute\tools`,
        String.raw`C:relative\tools`,
        "file:///absolute/tools",
        "FILE:///absolute/tools",
      ]
    ) {
      assertThrows(
        () =>
          validateVeryfrontConfig({
            ai: {
              tools: {
                discovery: { paths: [path] },
              },
            },
          }),
        Error,
        "ai.tools.discovery.paths.0",
      );
    }
  });

  it("preserves values in intentional dynamic extension points", () => {
    const config = validateVeryfrontConfig({
      theme: { colors: { brand: "#123456" } },
      resolve: {
        importMap: {
          imports: { package: "https://example.com/package.ts" },
          scopes: { "/feature/": { package: "https://example.com/scoped.ts" } },
        },
      },
      ai: {
        providers: {
          custom: {
            apiKey: "key",
            providerSpecificOption: { mode: "strict" },
          },
        },
      },
    });

    assertEquals(config.theme?.colors?.brand, "#123456");
    assertEquals(
      config.resolve?.importMap?.scopes?.["/feature/"]?.package,
      "https://example.com/scoped.ts",
    );
    assertEquals(
      config.ai?.providers?.custom?.providerSpecificOption,
      { mode: "strict" },
    );
  });

  it("supports provider-neutral styles while retaining Tailwind authoring", () => {
    const config = validateVeryfrontConfig({
      styles: { stylesheet: "styles/global.css" },
      tailwind: { stylesheet: "globals.css", plugins: ["typography"] },
    });
    assertEquals(config.styles?.stylesheet, "styles/global.css");
    assertEquals(config.tailwind?.stylesheet, "globals.css");
    assertEquals(config.tailwind?.plugins, ["typography"]);
    assertThrows(
      () =>
        validateVeryfrontConfig({
          styles: { stylesheet: "globals.css", plugins: ["typography"] },
        } as never),
      Error,
      "plugins",
    );
    for (
      const stylesheet of [
        "/globals.css",
        "../globals.css",
        "styles/../globals.css",
        "styles\\globals.css",
        "styles//globals.css",
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ styles: { stylesheet } }),
        Error,
        "canonical project-relative stylesheet path",
      );
    }
  });

  it("rejects empty configured authentication credentials", () => {
    for (
      const auth of [
        { basic: { username: "", password: "password" } },
        { basic: { username: "user", password: "" } },
        { bearer: { token: "" } },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ security: { auth } }),
        Error,
        "Invalid veryfront.config at security.auth",
      );
    }
  });

  it("rejects ambiguous authentication modes", () => {
    assertThrows(
      () =>
        validateVeryfrontConfig({
          security: {
            auth: {
              basic: { username: "user", password: "password" },
              bearer: { token: "token" },
            },
          },
        }),
      Error,
      "Configure exactly one authentication mode",
    );
  });

  it("accepts declarative OIDC authentication data", () => {
    const config = validateVeryfrontConfig({
      security: { auth: VALID_OIDC_AUTH },
    });

    assertEquals(config.security?.auth, VALID_OIDC_AUTH);
  });

  it("accepts self-host trusted-proxy authentication data in the config schema", () => {
    const config = validateVeryfrontConfig({
      security: { auth: VALID_TRUSTED_PROXY_AUTH },
    });

    assertEquals(config.security?.auth, VALID_TRUSTED_PROXY_AUTH);
  });

  it("rejects invalid OIDC environment variable names", () => {
    for (
      const [field, value] of [
        ["issuerEnvVar", "OIDC-ISSUER"],
        ["clientIdEnvVar", "1_OIDC_CLIENT_ID"],
        ["clientSecretEnvVar", ""],
        ["sessionSecretEnvVar", "VERYFRONT AUTH SESSION SECRET"],
      ] as const
    ) {
      assertThrows(
        () =>
          validateVeryfrontConfig({
            security: {
              auth: {
                oidc: {
                  ...VALID_OIDC_AUTH.oidc,
                  [field]: value,
                },
              },
            },
          }),
        Error,
        `security.auth.oidc.${field}`,
      );
    }
  });

  it("requires exactly one OIDC openid scope and rejects unsafe scope tokens", () => {
    for (
      const [scopes, message] of [
        [["profile", "email"], "OIDC scopes must include openid"],
        [["openid", "openid"], "OIDC scopes must not contain duplicates"],
        [["openid", ""], "security.auth.oidc.scopes.1"],
        [["openid", "profile email"], "security.auth.oidc.scopes.1"],
        [["openid", "profile\nemail"], "security.auth.oidc.scopes.1"],
      ] as const
    ) {
      assertThrows(
        () =>
          validateVeryfrontConfig({
            security: {
              auth: {
                oidc: {
                  ...VALID_OIDC_AUTH.oidc,
                  scopes,
                },
              },
            },
          }),
        Error,
        message,
      );
    }
  });

  it("uses the runtime OIDC scope bounds", () => {
    for (
      const scopes of [
        ["openid", ...Array.from({ length: 32 }, (_, index) => `scope-${index}`)],
        ["openid", "s".repeat(129)],
      ]
    ) {
      assertThrows(
        () =>
          validateVeryfrontConfig({
            security: {
              auth: {
                oidc: {
                  ...VALID_OIDC_AUTH.oidc,
                  scopes,
                },
              },
            },
          }),
        Error,
        "security.auth.oidc.scopes",
      );
    }
  });

  it("bounds OIDC claim names, lifetimes, endpoint origins, and cookie names", () => {
    for (
      const [oidc, message] of [
        [{ claims: { email: "" } }, "security.auth.oidc.claims.email"],
        [{ claims: { name: "user\u0000name" } }, "security.auth.oidc.claims.name"],
        [{ claims: { groups: "group\u007Fname" } }, "security.auth.oidc.claims.groups"],
        [{ claims: { roles: "roles\u00A0claim" } }, "security.auth.oidc.claims.roles"],
        [{ claims: { roles: "roles\nheader" } }, "security.auth.oidc.claims.roles"],
        [{ sessionTtlSeconds: 0 }, "security.auth.oidc.sessionTtlSeconds"],
        [{ discoveryCacheTtlSeconds: 0 }, "security.auth.oidc.discoveryCacheTtlSeconds"],
        [{ cookieName: "vf auth" }, "security.auth.oidc.cookieName"],
        [{ trustedEndpointOrigins: [] }, "security.auth.oidc.trustedEndpointOrigins"],
        [
          { trustedEndpointOrigins: ["http://idp.example.com"] },
          "security.auth.oidc.trustedEndpointOrigins.0",
        ],
        [
          { trustedEndpointOrigins: ["https://idp.example.com/"] },
          "security.auth.oidc.trustedEndpointOrigins.0",
        ],
      ] as const
    ) {
      assertThrows(
        () =>
          validateVeryfrontConfig({
            security: {
              auth: {
                oidc: {
                  ...VALID_OIDC_AUTH.oidc,
                  ...oidc,
                },
              },
            },
          }),
        Error,
        message,
      );
    }
  });

  it("bounds trusted-proxy peer addresses and identity header names", () => {
    for (
      const [trustedProxy, message] of [
        [{ trustedPeers: [] }, "security.auth.trustedProxy.trustedPeers"],
        [{ trustedPeers: ["proxy.internal"] }, "security.auth.trustedProxy.trustedPeers.0"],
        [{ trustedPeers: ["::192.0.2.1"] }, "security.auth.trustedProxy.trustedPeers.0"],
        [{ trustedPeers: ["2001:db8::192.0.2.1"] }, "security.auth.trustedProxy.trustedPeers.0"],
        [{ trustedPeers: ["127.0.0.1", "127.0.0.1"] }, "Trusted proxy peers must be unique"],
        [
          { trustedPeers: ["192.0.2.1", "::ffff:192.0.2.1"] },
          "Trusted proxy peers must be unique",
        ],
        [
          { headers: { ...VALID_TRUSTED_PROXY_AUTH.trustedProxy.headers, subject: "" } },
          "security.auth.trustedProxy.headers.subject",
        ],
        [
          { headers: { ...VALID_TRUSTED_PROXY_AUTH.trustedProxy.headers, roles: "x roles" } },
          "security.auth.trustedProxy.headers.roles",
        ],
      ] as const
    ) {
      assertThrows(
        () =>
          validateVeryfrontConfig({
            security: {
              auth: {
                trustedProxy: {
                  ...VALID_TRUSTED_PROXY_AUTH.trustedProxy,
                  ...trustedProxy,
                },
              },
            },
          }),
        Error,
        message,
      );
    }
  });

  it("rejects trusted-proxy identity headers reserved by the runtime", () => {
    for (const subject of ["host", "forwarded", "via", "x-real-ip", "X-Forwarded-User"]) {
      assertThrows(
        () =>
          validateVeryfrontConfig({
            security: {
              auth: {
                trustedProxy: {
                  ...VALID_TRUSTED_PROXY_AUTH.trustedProxy,
                  headers: {
                    ...VALID_TRUSTED_PROXY_AUTH.trustedProxy.headers,
                    subject,
                  },
                },
              },
            },
          }),
        Error,
        "security.auth.trustedProxy.headers.subject",
      );
    }
  });

  it("rejects unknown authentication config keys", () => {
    for (
      const [auth, message] of [
        [{ ...VALID_OIDC_AUTH, provider: "oidc" }, `Unrecognized key: "provider"`],
        [
          {
            oidc: {
              ...VALID_OIDC_AUTH.oidc,
              providerFactory: "factory",
            },
          },
          `Unrecognized key: "providerFactory"`,
        ],
        [
          {
            trustedProxy: {
              ...VALID_TRUSTED_PROXY_AUTH.trustedProxy,
              factory: "headers",
            },
          },
          `Unrecognized key: "factory"`,
        ],
      ] as const
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ security: { auth } }),
        Error,
        message,
      );
    }
  });

  it("rejects every combination of mutually exclusive auth modes", () => {
    const modes = {
      basic: { basic: { username: "user", password: "password" } },
      bearer: { bearer: { token: "token" } },
      oidc: VALID_OIDC_AUTH,
      trustedProxy: VALID_TRUSTED_PROXY_AUTH,
    } as const;
    const combinations = [
      [modes.basic, modes.bearer],
      [modes.basic, modes.oidc],
      [modes.basic, modes.trustedProxy],
      [modes.bearer, modes.oidc],
      [modes.bearer, modes.trustedProxy],
      [modes.oidc, modes.trustedProxy],
      [modes.basic, modes.bearer, modes.oidc, modes.trustedProxy],
    ] as const;

    for (const combination of combinations) {
      const auth = Object.assign({}, ...combination);
      assertThrows(
        () => validateVeryfrontConfig({ security: { auth } }),
        Error,
        "Configure exactly one authentication mode",
      );
    }
  });

  it("rejects filesystem options that do not match the selected backend", () => {
    const github = { token: "token", owner: "owner", repo: "repo" };
    const veryfront = { apiBaseUrl: "https://api.veryfront.com" };

    for (
      const fs of [
        { github },
        { type: "local", github },
        { type: "github" },
        { type: "github", github, local: { baseDir: "/tmp" } },
        { type: "veryfront-api" },
        { type: "veryfront-api", veryfront, memory: { files: {} } },
        { type: "memory", veryfront },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ fs }),
        Error,
        "Filesystem options must belong to the selected backend type",
      );
    }

    assertEquals(
      validateVeryfrontConfig({ fs: { type: "github", github } }).fs?.type,
      "github",
    );
    assertEquals(
      validateVeryfrontConfig({ fs: { type: "veryfront-api", veryfront } }).fs?.type,
      "veryfront-api",
    );
  });

  it("bounds filesystem retry delays to the portable timer domain", () => {
    const validRetry = {
      maxRetries: 3,
      initialDelay: 0,
      maxDelay: MAX_TIMER_DELAY_MS,
    };
    assertEquals(
      validateVeryfrontConfig({
        fs: {
          type: "veryfront-api",
          veryfront: {
            apiBaseUrl: "https://api.example.com",
            retry: validRetry,
          },
        },
      }).fs?.veryfront?.retry,
      validRetry,
    );
    assertEquals(
      validateVeryfrontConfig({
        fs: {
          type: "github",
          github: {
            token: "token",
            owner: "owner",
            repo: "repo",
            retry: validRetry,
          },
        },
      }).fs?.github?.retry,
      validRetry,
    );

    for (
      const retry of [
        { initialDelay: MAX_TIMER_DELAY_MS + 1 },
        { maxDelay: MAX_TIMER_DELAY_MS + 1 },
        { initialDelay: 1_000, maxDelay: 500 },
      ]
    ) {
      for (
        const fs of [
          {
            type: "veryfront-api",
            veryfront: {
              apiBaseUrl: "https://api.example.com",
              retry,
            },
          },
          {
            type: "github",
            github: {
              token: "token",
              owner: "owner",
              repo: "repo",
              retry,
            },
          },
        ]
      ) {
        assertThrows(
          () => validateVeryfrontConfig({ fs }),
          Error,
          "Invalid veryfront.config at fs",
        );
      }
    }
  });

  it("bounds each filesystem backend without changing its retry-count contract", () => {
    const accepted = [
      {
        type: "veryfront-api",
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          retry: { maxRetries: MAX_VERYFRONT_FILESYSTEM_RETRIES },
        },
      },
      {
        type: "github",
        github: {
          token: "token",
          owner: "owner",
          repo: "repo",
          retry: { maxRetries: MAX_GITHUB_FILESYSTEM_ATTEMPTS },
        },
      },
    ];
    for (const fs of accepted) {
      assertEquals(validateVeryfrontConfig({ fs }).fs?.type, fs.type);
    }

    const rejected = [
      {
        type: "veryfront-api",
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          retry: { maxRetries: MAX_VERYFRONT_FILESYSTEM_RETRIES + 1 },
        },
      },
      {
        type: "github",
        github: {
          token: "token",
          owner: "owner",
          repo: "repo",
          retry: { maxRetries: MAX_GITHUB_FILESYSTEM_ATTEMPTS + 1 },
        },
      },
    ];
    for (const fs of rejected) {
      assertThrows(
        () => validateVeryfrontConfig({ fs }),
        Error,
        "Invalid veryfront.config at fs",
      );
    }
  });

  it("bounds file log retention before rotation work is scheduled", () => {
    assertEquals(
      validateVeryfrontConfig({
        observability: {
          logging: {
            file: { maxFiles: MAX_FILE_LOG_FILES },
          },
        },
      }).observability?.logging?.file?.maxFiles,
      MAX_FILE_LOG_FILES,
    );

    assertThrows(
      () =>
        validateVeryfrontConfig({
          observability: {
            logging: {
              file: { maxFiles: MAX_FILE_LOG_FILES + 1 },
            },
          },
        }),
      Error,
      "Invalid veryfront.config at observability.logging.file.maxFiles",
    );
  });

  it("accepts build.ssg as a boolean", () => {
    const enabled = validateVeryfrontConfig({ build: { ssg: true } });
    assertEquals(enabled.build?.ssg, true);

    const disabled = validateVeryfrontConfig({ build: { ssg: false } });
    assertEquals(disabled.build?.ssg, false);

    const omitted = validateVeryfrontConfig({ build: {} });
    assertEquals(omitted.build?.ssg, undefined);
  });

  it("rejects non-boolean build.ssg", () => {
    assertThrows(
      () => validateVeryfrontConfig({ build: { ssg: "yes" } }),
      Error,
      "Invalid veryfront.config at build.ssg:",
    );
  });

  it("accepts bare package names in build.serverExternalPackages", () => {
    const config = validateVeryfrontConfig({
      build: {
        serverExternalPackages: ["knex", "@prisma/client"],
      },
    });

    assertEquals(config.build?.serverExternalPackages, ["knex", "@prisma/client"]);
  });

  it("rejects versions, subpaths, duplicates, and empty server external packages", () => {
    for (
      const serverExternalPackages of [
        ["knex@3.1.0"],
        ["@prisma/client/runtime"],
        ["knex", "knex"],
        [],
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ build: { serverExternalPackages } }),
        Error,
        "Invalid veryfront.config at build.serverExternalPackages",
      );
    }
  });

  it("returns registered validation errors without retaining the full config", () => {
    const input = {
      dev: { port: "invalid" },
      security: { auth: { bearer: { token: "secret-token" } } },
    };

    const error = assertThrows(() => validateVeryfrontConfig(input));

    assertEquals(error instanceof VeryfrontError, true);
    assertEquals((error as VeryfrontError).slug, "config-validation-failed");
    assertEquals((error as VeryfrontError).context, {
      field: "dev.port",
      expected: "Invalid input: expected number, received string",
    });
  });

  it("bounds every configured server port", () => {
    for (
      const input of [
        { dev: { port: 0 } },
        { dev: { port: 65536 } },
        { dev: { hmrPort: 1.5 } },
        { dev: { hmrPort: 65536 } },
        { ai: { mcp: { port: 0 } } },
        { ai: { mcp: { port: 65536 } } },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig(input),
        Error,
        "Invalid veryfront.config at",
      );
    }

    const config = validateVeryfrontConfig({
      dev: { port: 1, hmrPort: 65535 },
      ai: { mcp: { port: 3001 } },
    });
    assertEquals(config.dev?.port, 1);
    assertEquals(config.dev?.hmrPort, 65535);
    assertEquals(config.ai?.mcp?.port, 3001);
  });

  it("accepts remote host policies at their exact count and URL length limits", () => {
    const prefix = "https://example.com/";
    const exactLengthUrl = prefix + "a".repeat(MAX_REMOTE_HOST_URL_LENGTH - prefix.length);
    const remoteHosts = Array.from(
      { length: MAX_REMOTE_HOST_COUNT },
      (_, index) => `https://host-${index}.example`,
    );
    remoteHosts[0] = exactLengthUrl;

    const config = validateVeryfrontConfig({ security: { remoteHosts } });

    assertEquals(config.security?.remoteHosts?.length, MAX_REMOTE_HOST_COUNT);
    assertEquals(config.security?.remoteHosts?.[0], exactLengthUrl);
    assertEquals(
      validateVeryfrontConfig({ security: { remoteHosts: [] } }).security?.remoteHosts,
      [],
    );
  });

  it("rejects remote host policies above their count or URL length limits", () => {
    const prefix = "https://example.com/";
    const overLengthUrl = prefix +
      "a".repeat(MAX_REMOTE_HOST_URL_LENGTH + 1 - prefix.length);
    const overCountHosts = Array.from(
      { length: MAX_REMOTE_HOST_COUNT + 1 },
      (_, index) => `https://host-${index}.example`,
    );

    for (const remoteHosts of [overCountHosts, [overLengthUrl]]) {
      assertThrows(
        () => validateVeryfrontConfig({ security: { remoteHosts } }),
        Error,
        "Invalid veryfront.config at security.remoteHosts",
      );
    }
  });

  it("accepts bounded canonical redirect origin policies", () => {
    const allowedOrigins = [
      "https://accounts.example.com",
      "http://localhost:3000",
    ];

    assertEquals(
      validateVeryfrontConfig({ security: { redirects: { allowedOrigins } } }).security
        ?.redirects,
      { allowedOrigins },
    );
    assertEquals(
      validateVeryfrontConfig({ security: { redirects: { allowedOrigins: [] } } }).security
        ?.redirects,
      { allowedOrigins: [] },
    );
  });

  it("rejects malformed redirect origin policies", () => {
    for (
      const redirects of [
        {},
        { allowedOrigins: ["https://accounts.example.com/path"] },
        { allowedOrigins: ["https://accounts.example.com?tenant=one"] },
        { allowedOrigins: ["https://user:password@accounts.example.com"] },
        { allowedOrigins: ["javascript:"] },
        { allowedOrigins: ["//accounts.example.com"] },
        { allowedOrigins: ["https://accounts.example.com", "https://accounts.example.com"] },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ security: { redirects } }),
        Error,
        "Invalid veryfront.config at security.redirects",
      );
    }
  });

  it("accepts CSP directives in either spelling, including null", () => {
    const csp = {
      styleSrc: ["https://fonts.googleapis.com"],
      "font-src": ["https://fonts.gstatic.com"],
      scriptSrcAttr: null,
    };

    assertEquals(validateVeryfrontConfig({ security: { csp } }).security?.csp, csp);
  });

  it("rejects an unknown CSP directive and names the offending key", () => {
    // Browsers ignore unrecognized directives, so a typo would otherwise read
    // as configured and protect nothing.
    const error = assertThrows(
      () => validateVeryfrontConfig({ security: { csp: { fontSource: ["https://a.example"] } } }),
      Error,
      "Invalid veryfront.config at security.csp",
    ) as Error;

    assertStringIncludes(
      error.message,
      'Unknown Content-Security-Policy directive "fontSource"',
    );
    // The refinement runs on `security.csp`, so its path is relative to it.
    // A "csp" prefix here would report `security.csp.csp.fontSource`.
    assertEquals(error.message.includes("security.csp.csp"), false);
  });

  it("gives helpful error for invalid cors", () => {
    const error = assertThrows(
      () => validateVeryfrontConfig({ security: { cors: { origin: 123 } } }),
      Error,
      "Invalid veryfront.config at security.cors:",
    ) as Error;
    assertStringIncludes(
      error.message,
      "Expected boolean or a CORS object with origin, credentials, methods, allowedHeaders, exposedHeaders, or maxAge.",
    );
  });

  it("accepts the complete runtime CORS configuration contract", () => {
    const origin = (requestOrigin: string) => requestOrigin === "https://example.com";
    const cors = {
      origin,
      credentials: true,
      methods: ["GET", "POST"],
      allowedHeaders: ["Authorization"],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 3600,
    };

    assertEquals(validateVeryfrontConfig({ security: { cors } }).security?.cors, cors);
    assertEquals(
      validateVeryfrontConfig({
        security: { cors: { origin: ["https://example.com"] } },
      }).security?.cors,
      { origin: ["https://example.com"] },
    );
  });

  it("rejects unsafe or malformed CORS configuration", () => {
    for (
      const cors of [
        { origin: "*", credentials: true },
        { origin: [] },
        { origin: [""] },
        { origin: "https://example.com\r\nX-Injected: yes" },
        { origin: "https://例.example" },
        { origin: " https://example.com" },
        { methods: [] },
        { methods: [""] },
        { methods: ["GET, POST"] },
        { methods: ["GET\nInjected"] },
        { allowedHeaders: [] },
        { allowedHeaders: ["X Invalid"] },
        { exposedHeaders: [] },
        { exposedHeaders: ["X-Valid\r\nInjected"] },
        { origin: "a".repeat(MAX_CORS_ORIGIN_LENGTH + 1) },
        {
          origin: Array.from(
            { length: MAX_CORS_ORIGIN_COUNT + 1 },
            (_, index) => `https://origin-${index}.example`,
          ),
        },
        {
          origin: Array.from(
            { length: 5 },
            (_, index) => `${index}${"a".repeat(MAX_CORS_ORIGIN_LENGTH - 1)}`,
          ),
        },
        {
          methods: Array.from(
            { length: MAX_CORS_TOKEN_COUNT + 1 },
            (_, index) => `M-${index}`,
          ),
        },
        { allowedHeaders: ["X".repeat(MAX_CORS_TOKEN_LENGTH + 1)] },
        {
          exposedHeaders: Array.from(
            { length: 17 },
            (_, index) =>
              `${"X".repeat(MAX_CORS_TOKEN_LENGTH - 3)}${String(index).padStart(3, "0")}`,
          ),
        },
        { maxAge: -1 },
        { maxAge: 1.5 },
        { maxAge: Number.NaN },
        { maxAge: Number.POSITIVE_INFINITY },
        { maxAge: Number.MAX_SAFE_INTEGER + 1 },
        { headers: ["Authorization"] },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ security: { cors } }),
        Error,
        "Invalid veryfront.config at security.cors",
      );
    }
  });

  it("accepts bounded canonical CSRF customization", () => {
    const csrf = {
      cookieName: "__Host-vf_csrf",
      headerName: "X-CSRF-Token",
      excludePaths: ["/api/webhooks", "/health%20check"],
      ttlSec: 3600,
    };

    assertEquals(
      validateVeryfrontConfig({ security: { csrf } }).security?.csrf,
      csrf,
    );
    const prefixedCompatibilityConfig = {
      ...csrf,
      cookieName: "vf_csrf_http_forbidden",
    };
    assertEquals(
      validateVeryfrontConfig({ security: { csrf: prefixedCompatibilityConfig } }).security?.csrf,
      prefixedCompatibilityConfig,
      "a pre-existing public prefix name remains valid when it cannot collide with a derived token",
    );
  });

  it("rejects CSRF names and exclusion paths that are unsafe or non-canonical", () => {
    for (
      const csrf of [
        { excludePaths: [""] },
        { excludePaths: ["relative/path"] },
        { excludePaths: ["//example.com/api"] },
        { excludePaths: ["/api/../admin"] },
        { excludePaths: ["/api/"] },
        { excludePaths: ["/api?public=true"] },
        { excludePaths: ["/api#public"] },
        { excludePaths: ["/api\npublic"] },
        { excludePaths: [`/${"a".repeat(4096)}`] },
        {
          excludePaths: Array.from(
            { length: 65 },
            (_, index) => `/excluded-${index}`,
          ),
        },
        {
          excludePaths: Array.from(
            { length: 64 },
            (_, index) => `/excluded-${index}-${"a".repeat(256)}`,
          ),
        },
        { cookieName: "" },
        { cookieName: "csrf cookie" },
        { cookieName: "csrf;SameSite=None" },
        { cookieName: "csrf\r\nInjected" },
        { cookieName: "vf_csrf_names" },
        { cookieName: csrfNamesCookieName("https://example.test") },
        { cookieName: csrfHttpTokenCookieName("vf_csrf", "http://example.test") },
        { cookieName: "x".repeat(257) },
        { headerName: "" },
        { headerName: "x csrf" },
        { headerName: "x-csrf\r\nInjected" },
        { headerName: "x".repeat(257) },
        { ttlSec: 0 },
        { ttlSec: 1.5 },
        { ttlSec: Number.POSITIVE_INFINITY },
        { ttlSec: Number.MAX_SAFE_INTEGER + 1 },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ security: { csrf } }),
        Error,
        "Invalid veryfront.config at security.csrf",
      );
    }
  });

  it("retains the supported bundle manifest backends", () => {
    for (const type of ["redis", "kv", "memory"] as const) {
      const config = validateVeryfrontConfig({ cache: { bundleManifest: { type } } });
      assertEquals(config.cache?.bundleManifest?.type, type);
    }
  });

  it("rejects unwired distributed render-cache configuration", () => {
    for (
      const render of [
        { type: "distributed" },
        { type: "distributed", keyPrefix: "vf:cache:tenant-render:" },
        { type: "memory", keyPrefix: "vf:cache:tenant-render:" },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ cache: { render } }),
        Error,
        "Invalid veryfront.config at cache.render",
      );
    }

    for (const maxEntries of [-1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assertThrows(
        () => validateVeryfrontConfig({ cache: { render: { maxEntries } } }),
        Error,
        "Invalid veryfront.config at cache.render.maxEntries:",
      );
    }
  });

  it("rejects unknown and cross-backend render cache options", () => {
    for (
      const render of [
        { type: "memory", endpoint: "https://cache.invalid" },
        { type: "memory", keyPrefix: "vf:cache:tenant-render:" },
        { type: "filesystem", kvPath: "/tmp/cache.sqlite" },
        { type: "kv", keyPrefix: "vf:cache:tenant-render:" },
        { type: "memory", typoMaxEntry: 100 },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ cache: { render } }),
        Error,
        "Invalid veryfront.config at cache.render",
      );
    }

    assertEquals(
      validateVeryfrontConfig({ cache: { render: { type: "memory", maxEntries: 100 } } })
        .cache?.render?.type,
      "memory",
    );
    assertEquals(
      validateVeryfrontConfig({ cache: { render: { type: "kv", kvPath: "/cache.sqlite" } } })
        .cache?.render?.type,
      "kv",
    );
  });

  it("enforces query parameter policy-specific configuration", () => {
    for (
      const queryParams of [
        { policy: "ignore-all", params: ["page"] },
        { policy: "include-all", params: ["page"] },
        { policy: "include-list" },
        { policy: "include-list", params: [] },
        { policy: "exclude-list", params: [""] },
        { policy: "exclude-list", unknown: true },
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ cache: { queryParams } }),
        Error,
        "Invalid veryfront.config at cache.queryParams",
      );
    }

    for (
      const queryParams of [
        {},
        { policy: "ignore-all" },
        { policy: "include-all" },
        { policy: "include-list", params: ["page", "sort"] },
        { policy: "exclude-list", params: ["utm_source"] },
        { params: ["utm_source"] },
      ]
    ) {
      assertEquals(
        validateVeryfrontConfig({ cache: { queryParams } }).cache?.queryParams !== undefined,
        true,
      );
    }
  });

  it("aligns cache TTL validation with each runtime contract", () => {
    const valid = validateVeryfrontConfig({
      cache: {
        bundleManifest: { ttl: 0 },
        render: { ttl: 0.5 },
      },
      fs: {
        type: "veryfront-api",
        veryfront: { cache: { ttl: 1, maxSize: 2, maxMemory: 3 } },
      },
    });
    const validGithub = validateVeryfrontConfig({
      fs: {
        type: "github",
        github: {
          token: "token",
          owner: "owner",
          repo: "repo",
          cache: { ttl: 1 },
        },
      },
    });
    assertEquals(valid.cache?.bundleManifest?.ttl, 0);
    assertEquals(valid.cache?.render?.ttl, 0.5);
    assertEquals(valid.fs?.veryfront?.cache?.maxMemory, 3);
    assertEquals(validGithub.fs?.github?.cache?.ttl, 1);

    for (const ttl of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assertThrows(
        () => validateVeryfrontConfig({ cache: { bundleManifest: { ttl } } }),
        Error,
        "Invalid veryfront.config at cache.bundleManifest.ttl:",
      );
    }

    for (
      const ttl of [
        0,
        -1,
        Number.POSITIVE_INFINITY,
        MAX_CACHE_TTL_MILLISECONDS + 1,
      ]
    ) {
      assertThrows(
        () => validateVeryfrontConfig({ cache: { render: { ttl } } }),
        Error,
        "Invalid veryfront.config at cache.render.ttl:",
      );
    }

    for (const ttl of [0, -1, 0.5, MAX_CACHE_TTL_MILLISECONDS + 1]) {
      assertThrows(
        () =>
          validateVeryfrontConfig({
            fs: { type: "veryfront-api", veryfront: { cache: { ttl } } },
          }),
        Error,
        "Invalid veryfront.config at fs.veryfront.cache.ttl:",
      );
      assertThrows(
        () =>
          validateVeryfrontConfig({
            fs: {
              type: "github",
              github: { token: "token", owner: "owner", repo: "repo", cache: { ttl } },
            },
          }),
        Error,
        "Invalid veryfront.config at fs.github.cache.ttl:",
      );
    }

    for (
      const cache of [
        { maxSize: Number.MAX_SAFE_INTEGER + 1 },
        { maxMemory: Number.MAX_SAFE_INTEGER + 1 },
      ]
    ) {
      assertThrows(
        () =>
          validateVeryfrontConfig({
            fs: { type: "veryfront-api", veryfront: { cache } },
          }),
        Error,
        "Invalid veryfront.config at fs.veryfront.cache.",
      );
      assertThrows(
        () =>
          validateVeryfrontConfig({
            fs: {
              type: "github",
              github: { token: "token", owner: "owner", repo: "repo", cache },
            },
          }),
        Error,
        "Invalid veryfront.config at fs.github.cache.",
      );
    }
  });

  it("accepts only the canonical source integration narrowing policy", () => {
    const cfg = validateVeryfrontConfig({
      integrations: {
        allow: {
          confluence: {},
          github: { allowedTools: ["list_repos"] },
        },
      },
    });

    assertEquals(cfg.integrations, {
      allow: {
        confluence: {},
        github: { allowedTools: ["list_repos"] },
      },
    });
    assertThrows(
      () =>
        validateVeryfrontConfig({
          integrations: {
            github: { tools: ["list_repos"], scope: "user" },
          },
        }),
      Error,
      "Invalid veryfront.config at integrations.allow:",
    );
    assertThrows(
      () =>
        validateVeryfrontConfig({
          integrations: {
            allow: {
              github: { allowedTools: ["list_repos"], scope: "user" },
            },
          },
        }),
      Error,
      "Invalid veryfront.config at integrations.allow.github:",
    );
    assertThrows(
      () =>
        validateVeryfrontConfig({
          integrations: {
            allow: { GitHub: {} },
          },
        }),
      Error,
      "Invalid veryfront.config at integrations.allow.GitHub: Invalid key in record.",
    );
    assertThrows(
      () =>
        validateVeryfrontConfig({
          integrations: {
            allow: { github: { allowedTools: ["github__list_repos"] } },
          },
        }),
      Error,
      "Expected a canonical connector-local tool ID",
    );
    const firstHalfCount = Math.floor(MAX_SOURCE_INTEGRATION_POLICY_TOOL_IDS / 2) + 1;
    const firstHalf = Array.from(
      { length: firstHalfCount },
      (_, index) => `tool_a_${index}`,
    );
    const secondHalf = Array.from(
      { length: MAX_SOURCE_INTEGRATION_POLICY_TOOL_IDS + 1 - firstHalfCount },
      (_, index) => `tool_b_${index}`,
    );
    assertThrows(
      () =>
        validateVeryfrontConfig({
          integrations: {
            allow: {
              github: { allowedTools: firstHalf },
              gmail: { allowedTools: secondHalf },
            },
          },
        }),
      Error,
      "Source integration allowlist exceeds resource limits",
    );
  });
});

const legacyBasicAuthConfig: AuthConfig = {
  basic: { username: "user", password: "password" },
};
const legacyBearerAuthConfig: AuthConfig = {
  bearer: { token: "token" },
};
const oidcAuthConfig: AuthConfig = VALID_OIDC_AUTH;
const trustedProxyAuthConfig: AuthConfig = VALID_TRUSTED_PROXY_AUTH;

void legacyBasicAuthConfig;
void legacyBearerAuthConfig;
void oidcAuthConfig;
void trustedProxyAuthConfig;

// @ts-expect-error Auth modes must be mutually exclusive.
const invalidBasicAndBearerAuthConfig: AuthConfig = {
  basic: { username: "user", password: "password" },
  bearer: { token: "token" },
};

// @ts-expect-error Auth modes must be mutually exclusive.
const invalidOidcAndTrustedProxyAuthConfig: AuthConfig = {
  oidc: VALID_OIDC_AUTH.oidc,
  trustedProxy: VALID_TRUSTED_PROXY_AUTH.trustedProxy,
};

void invalidBasicAndBearerAuthConfig;
void invalidOidcAndTrustedProxyAuthConfig;
