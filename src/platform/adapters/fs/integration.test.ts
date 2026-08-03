import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createFSAdapterFromConfig,
  enhanceAdapterWithFS,
  getFSAdapterType,
  isFSAdapterConfigured,
} from "./integration.ts";
import { denoAdapter } from "../deno.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";

describe("integration.ts", () => {
  it("should export enhanceAdapterWithFS function", () => {
    assertExists(enhanceAdapterWithFS);
    assertEquals(typeof enhanceAdapterWithFS, "function");
  });

  it("should return original adapter for local type", async () => {
    const adapter = await enhanceAdapterWithFS(denoAdapter, { fs: { type: "local" } });
    assertEquals(adapter, denoAdapter);
  });

  it("should return original adapter when no fs config", async () => {
    const adapter = await enhanceAdapterWithFS(denoAdapter, {});
    assertEquals(adapter, denoAdapter);
  });

  it("should return original adapter when fs.type is not set", async () => {
    const adapter = await enhanceAdapterWithFS(denoAdapter, { fs: {} });
    assertEquals(adapter, denoAdapter);
  });

  it("should export createFSAdapterFromConfig function", () => {
    assertExists(createFSAdapterFromConfig);
    assertEquals(typeof createFSAdapterFromConfig, "function");
  });

  it("should return null for local type", async () => {
    const adapter = await createFSAdapterFromConfig({ fs: { type: "local" } });
    assertEquals(adapter, null);
  });

  it("should return null when no fs config", async () => {
    const adapter = await createFSAdapterFromConfig({});
    assertEquals(adapter, null);
  });

  it("should return null when fs.type is not set", async () => {
    const adapter = await createFSAdapterFromConfig({ fs: {} });
    assertEquals(adapter, null);
  });

  it("should export isFSAdapterConfigured function", () => {
    assertExists(isFSAdapterConfigured);
    assertEquals(typeof isFSAdapterConfigured, "function");
  });

  it("should return false for local type", () => {
    assertEquals(isFSAdapterConfigured({ fs: { type: "local" } }), false);
  });

  it("should return false when no fs config", () => {
    assertEquals(isFSAdapterConfigured({}), false);
  });

  it("should return false when fs.type is not set", () => {
    assertEquals(isFSAdapterConfigured({ fs: {} }), false);
  });

  it("should return true for veryfront-api type", () => {
    assertEquals(isFSAdapterConfigured({ fs: { type: "veryfront-api" } }), true);
  });

  it("should return true for github type", () => {
    assertEquals(isFSAdapterConfigured({ fs: { type: "github" } }), true);
  });

  it("should export getFSAdapterType function", () => {
    assertExists(getFSAdapterType);
    assertEquals(typeof getFSAdapterType, "function");
  });

  it("should return local as default", () => {
    assertEquals(getFSAdapterType({}), "local");
  });

  it("should return fs.type when set", () => {
    assertEquals(getFSAdapterType({ fs: { type: "veryfront-api" } }), "veryfront-api");
    assertEquals(getFSAdapterType({ fs: { type: "github" } }), "github");
  });

  it("should return local when fs.type is not set", () => {
    assertEquals(getFSAdapterType({ fs: {} }), "local");
  });

  describe("enhanceAdapterWithFS error fallback", () => {
    it("should preserve invalid retry configuration instead of changing filesystems", async () => {
      let rejection: unknown;
      try {
        await enhanceAdapterWithFS(denoAdapter, {
          fs: {
            type: "veryfront-api",
            veryfront: { retry: { maxRetries: Number.MAX_SAFE_INTEGER } },
          },
        });
      } catch (error) {
        rejection = error;
      }
      assertInstanceOf(rejection, VeryfrontError);
      assertEquals(rejection.slug, "config-validation-failed");
    });

    it("should preserve invalid project scoping instead of falling back to local files", async () => {
      const error = await assertRejects(
        () =>
          enhanceAdapterWithFS(
            denoAdapter,
            {
              fs: {
                type: "veryfront-api",
                veryfront: {
                  apiBaseUrl: "https://api.example.com",
                  apiToken: "token",
                  projectSlug: "project",
                },
              },
            },
            "/project/../etc",
          ),
        VeryfrontError,
        "project directory must not contain",
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "config-validation-failed");
    });

    it("should fall back to original adapter for unsupported type", async () => {
      const adapter = await enhanceAdapterWithFS(denoAdapter, {
        fs: { type: "unsupported-type" as any },
      });
      assertEquals(adapter, denoAdapter);
    });

    it("should fall back to original adapter for github type without config", async () => {
      const adapter = await enhanceAdapterWithFS(denoAdapter, {
        fs: { type: "github" },
      });
      assertEquals(adapter, denoAdapter);
    });

    it("should pass projectDir to FSAdapter config", async () => {
      // With an unsupported type, it will fail and fall back, but the branch is exercised
      const adapter = await enhanceAdapterWithFS(
        denoAdapter,
        { fs: { type: "unknown-type" as any } },
        "/some/project/dir",
      );
      assertEquals(adapter, denoAdapter);
    });
  });

  describe("createFSAdapterFromConfig error propagation", () => {
    it("should propagate error for unsupported type", async () => {
      await assertRejects(
        () => createFSAdapterFromConfig({ fs: { type: "unsupported" as any } }),
        Error,
        'FSAdapter type "unsupported" is not implemented',
      );
    });
  });
});
