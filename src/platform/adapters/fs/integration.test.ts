import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  createEnhancedAdapter,
  createFSAdapterFromConfig,
  enhanceAdapterWithFS,
  getFSAdapterType,
  isFSAdapterConfigured,
} from "./integration.ts";
import { denoAdapter } from "../deno.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import type { RuntimeAdapter } from "../base.ts";
import type { FSAdapter } from "./veryfront/types.ts";
import { wrapFSAdapter } from "./wrapper.ts";
import { createSecureFs } from "#veryfront/security/secure-fs.ts";

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

  describe("remote filesystem reaches SecureFs", () => {
    // Two gates broke hosted preview in sequence: SecureFs rejected the Proxy
    // adapter, then rejected the wrapped fs because an unimplemented optional
    // capability was published as an own `undefined`.
    function bareRemoteFs(): FSAdapter {
      return {
        readFile: () => Promise.resolve(""),
        writeFile: () => Promise.resolve(),
        exists: () => Promise.resolve(true),
        mkdir: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        stat: () =>
          Promise.resolve({
            isSymlink: false,
            isDirectory: false,
            isFile: true,
            size: 0,
            mtime: null,
          }),
        // deno-lint-ignore require-yield
        async *readDir() {},
      } as unknown as FSAdapter;
    }

    it("produces an adapter SecureFs accepts", () => {
      const adapter = createEnhancedAdapter(
        denoAdapter,
        wrapFSAdapter(bareRemoteFs()) as unknown as RuntimeAdapter["fs"],
      );

      assertExists(createSecureFs({ baseDir: "/project", adapter }));
    });
  });

  describe("createEnhancedAdapter", () => {
    // SecureFs rejects Proxy adapters, so returning one here took hosted preview
    // rendering down with a 400 on every request.
    const stubFs = { symlinkSemantics: "none" } as unknown as RuntimeAdapter["fs"];

    it("returns a non-Proxy adapter so SecureFs can accept it", () => {
      const adapter = createEnhancedAdapter(denoAdapter, stubFs);

      assertEquals(isProxyWithoutHooks(adapter), false);
      assertExists(Object.getOwnPropertyDescriptor(adapter, "fs"));
    });

    it("overrides fs and keeps the rest of the adapter usable", () => {
      const adapter = createEnhancedAdapter(denoAdapter, stubFs);

      assertStrictEquals(adapter.fs, stubFs);
      assertEquals(typeof adapter.shutdown, "function");
      assertStrictEquals(adapter.capabilities, denoAdapter.capabilities);
    });
  });

  describe("enhanceAdapterWithFS error propagation", () => {
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

    it("should fail closed when GitHub repository identity is invalid", async () => {
      const error = await assertRejects(
        () =>
          enhanceAdapterWithFS(denoAdapter, {
            fs: {
              type: "github",
              github: { token: "test-token", owner: "team/other", repo: "repo" },
            },
          }),
        VeryfrontError,
        "GitHub owner",
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "config-validation-failed");
    });

    it("should fail closed when the GitHub adapter has no token", async () => {
      // token: "" is explicit so the GITHUB_TOKEN environment variable cannot
      // satisfy the requirement and mask the regression in CI.
      const error = await assertRejects(
        () =>
          enhanceAdapterWithFS(denoAdapter, {
            fs: {
              type: "github",
              github: { token: "", owner: "owner", repo: "repo" },
            },
          }),
        VeryfrontError,
        "token",
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "config-invalid");
    });

    it("should fail closed when the GitHub token contains only whitespace", async () => {
      let requests = 0;
      const error = await withMockFetch(
        () => {
          requests += 1;
          return Promise.resolve(new Response("Unauthorized", { status: 401 }));
        },
        () =>
          assertRejects(
            () =>
              enhanceAdapterWithFS(denoAdapter, {
                fs: {
                  type: "github",
                  github: { token: " ", owner: "owner", repo: "repo" },
                },
              }),
            VeryfrontError,
            "token",
          ),
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "config-invalid");
      assertEquals(requests, 0);
    });

    it("should propagate GitHub network initialization failures", async () => {
      const networkFailure = new Error("simulated GitHub outage");
      const error = await withMockFetch(
        () => Promise.reject(networkFailure),
        () =>
          assertRejects(() =>
            enhanceAdapterWithFS(denoAdapter, {
              fs: {
                type: "github",
                github: {
                  token: "test-token",
                  owner: "owner",
                  repo: "repo",
                  retry: { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
                },
              },
            })
          ),
      );
      assertStrictEquals(error, networkFailure);
    });

    it("should propagate GitHub authentication failures", async () => {
      const error = await withMockFetch(
        () => Promise.resolve(new Response("Unauthorized", { status: 401 })),
        () =>
          assertRejects(
            () =>
              enhanceAdapterWithFS(denoAdapter, {
                fs: {
                  type: "github",
                  github: {
                    token: "invalid-token",
                    owner: "owner",
                    repo: "repo",
                    retry: { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
                  },
                },
              }),
            Error,
            "authentication",
          ),
      );
      assertInstanceOf(error, Error);
    });

    it("should propagate unsupported adapter failures", async () => {
      await assertRejects(
        () =>
          enhanceAdapterWithFS(denoAdapter, {
            fs: { type: "unsupported-type" as any },
          }),
        Error,
        'FSAdapter type "unsupported-type" is not implemented',
      );
    });

    it("should fail closed for github type without config", async () => {
      await assertRejects(
        () =>
          enhanceAdapterWithFS(denoAdapter, {
            fs: { type: "github" },
          }),
        Error,
        "GitHub adapter requires github configuration",
      );
    });

    it("should not consult VeryfrontError Symbol.hasInstance while propagating", async () => {
      const originalHasInstance = Object.getOwnPropertyDescriptor(
        VeryfrontError,
        Symbol.hasInstance,
      );
      Object.defineProperty(VeryfrontError, Symbol.hasInstance, {
        configurable: true,
        value() {
          throw new Error("poisoned VeryfrontError Symbol.hasInstance was used");
        },
      });

      let caught: unknown;
      try {
        await enhanceAdapterWithFS(denoAdapter, {
          fs: {
            type: "github",
            github: { token: "test-token", owner: "team/other", repo: "repo" },
          },
        });
      } catch (error) {
        caught = error;
      } finally {
        if (originalHasInstance) {
          Object.defineProperty(VeryfrontError, Symbol.hasInstance, originalHasInstance);
        } else {
          Reflect.deleteProperty(VeryfrontError, Symbol.hasInstance);
        }
      }

      assertInstanceOf(caught, VeryfrontError);
      assertEquals(caught.slug, "config-validation-failed");
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
