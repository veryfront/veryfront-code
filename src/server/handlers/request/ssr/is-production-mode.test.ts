import { assertEquals } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { isProductionMode } from "./ssr-handler.ts";
import type { HandlerContext } from "../../types.ts";

function createContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/test",
    adapter: {} as HandlerContext["adapter"],
    mode: "production",
    securityConfig: null,
    cspUserHeader: null,
    ...overrides,
  };
}

const prodConfig = { fs: { veryfront: { apiBaseUrl: "http://test", productionMode: true } } };

Deno.test("isProductionMode", async (t) => {
  await t.step("returns true when config.productionMode is true", () => {
    const ctx = createContext({ config: prodConfig });
    assertEquals(isProductionMode(ctx), true);
  });

  await t.step("config.productionMode takes priority over domain", () => {
    const ctx = createContext({
      config: prodConfig,
      parsedDomain: {
        isVeryfrontDomain: true,
        isDraft: true,
        slug: "test",
        branch: null,
        environment: "preview",
      },
    });
    assertEquals(isProductionMode(ctx), true);
  });

  await t.step("returns true for veryfront domain when isDraft is false", () => {
    const ctx = createContext({
      parsedDomain: {
        isVeryfrontDomain: true,
        isDraft: false,
        slug: "test",
        branch: null,
        environment: "production",
      },
    });
    assertEquals(isProductionMode(ctx), true);
  });

  await t.step("returns false for veryfront domain when isDraft is true", () => {
    const ctx = createContext({
      parsedDomain: {
        isVeryfrontDomain: true,
        isDraft: true,
        slug: "test",
        branch: null,
        environment: "preview",
      },
    });
    assertEquals(isProductionMode(ctx), false);
  });

  await t.step("returns true for custom domain with production proxy environment", () => {
    const ctx = createContext({
      parsedDomain: {
        isVeryfrontDomain: false,
        isDraft: false,
        slug: null,
        branch: null,
        environment: null,
      },
      proxyEnvironment: "production",
    });
    assertEquals(isProductionMode(ctx), true);
  });

  await t.step("returns false for custom domain with preview proxy environment", () => {
    const ctx = createContext({
      parsedDomain: {
        isVeryfrontDomain: false,
        isDraft: false,
        slug: null,
        branch: null,
        environment: null,
      },
      proxyEnvironment: "preview",
    });
    assertEquals(isProductionMode(ctx), false);
  });

  await t.step("returns false when no indicators present", () => {
    const ctx = createContext({});
    assertEquals(isProductionMode(ctx), false);
  });

  await t.step("returns false when studio_embed=true regardless of other settings", () => {
    const ctx = createContext({
      config: prodConfig, // Would normally make it production
      parsedDomain: {
        isVeryfrontDomain: false,
        isDraft: false,
        slug: null,
        branch: null,
        environment: null,
      },
      proxyEnvironment: "production", // Would normally make it production
    });
    const url = new URL("https://example.com/?studio_embed=true");
    assertEquals(isProductionMode(ctx, url), false);
  });

  await t.step("studio_embed=true overrides config.productionMode", () => {
    const ctx = createContext({ config: prodConfig });
    const url = new URL("https://example.com/?studio_embed=true");
    assertEquals(isProductionMode(ctx, url), false);
  });

  await t.step("works without URL parameter (backward compatible)", () => {
    const ctx = createContext({
      parsedDomain: {
        isVeryfrontDomain: true,
        isDraft: false,
        slug: "test",
        branch: null,
        environment: "production",
      },
    });
    assertEquals(isProductionMode(ctx), true);
  });
});
