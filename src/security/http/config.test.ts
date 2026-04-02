import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SecurityConfigLoader } from "./config.ts";

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
});
