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
  createFSAdapterFromConfig,
  enhanceAdapterWithFS,
  getFSAdapterType,
  isFSAdapterConfigured,
} from "./integration.ts";
import { denoAdapter } from "../deno.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { createSecureFs } from "#veryfront/security/secure-fs.ts";
import type { RuntimeAdapter } from "../base.ts";

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

  describe("enhanced adapter shape", () => {
    function enhanceWithRemoteFs() {
      // The GitHub adapter fetches and schema-validates a repository tree at
      // construction, so the mock has to satisfy that shape.
      return withMockFetch(
        () =>
          Promise.resolve(
            new Response(
              JSON.stringify({ sha: "deadbeef", tree: [], truncated: false }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
        () =>
          enhanceAdapterWithFS(denoAdapter, {
            fs: {
              type: "github",
              github: { token: "test-token", owner: "owner", repo: "repo" },
            },
          }),
      );
    }

    it("is not a Proxy, because security consumers refuse one outright", async () => {
      // A Proxy here failed every hosted render using a remote filesystem with
      // "SecureFs runtime adapter cannot be a Proxy".
      const enhanced = await enhanceWithRemoteFs();
      assertEquals(enhanced === denoAdapter, false);
      assertEquals(isProxyWithoutHooks(enhanced), false);
    });

    it("exposes the remote filesystem as an own data property", async () => {
      // SecureFs resolves the filesystem through getOwnPropertyDescriptor. A
      // Proxy carrying only a get trap forwarded that to the target and handed
      // back the host filesystem, silently serving the wrong source.
      const enhanced = await enhanceWithRemoteFs();
      const descriptor = Object.getOwnPropertyDescriptor(enhanced, "fs");
      assertExists(descriptor);
      assertEquals("value" in descriptor, true);
      assertEquals(typeof descriptor.value, "object");
      assertEquals(descriptor.value === denoAdapter.fs, false);
    });

    it("produces an adapter SecureFs accepts end to end", async () => {
      // The composed path is what broke in production, twice: SecureFs first
      // rejected the Proxy adapter, then rejected the wrapped filesystem
      // because an unimplemented optional capability was published as an own
      // `undefined`. Each gate had a unit test, but nothing asserted the two
      // together, so the second only surfaced after the first was deployed.
      const enhanced = await enhanceWithRemoteFs();
      const secureFs = createSecureFs({
        baseDir: "/project",
        adapter: enhanced as unknown as RuntimeAdapter,
      });
      assertExists(secureFs);
    });

    it("keeps the rest of the adapter, with methods bound to the original", async () => {
      const enhanced = await enhanceWithRemoteFs();
      assertEquals(enhanced.id, denoAdapter.id);
      assertEquals(enhanced.name, denoAdapter.name);
      assertEquals(enhanced.capabilities, denoAdapter.capabilities);
      // `shutdown` lives on the prototype and closes over instance state, so it
      // must survive materialization already bound to the source adapter.
      assertEquals(typeof enhanced.shutdown, "function");
    });
  });
});
