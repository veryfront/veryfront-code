import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { verifyDispatchJwsSignature } from "#veryfront/channels/control-plane.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { FSAdapterWrapper } from "#veryfront/platform/adapters/fs/wrapper.ts";
import type { ContextualFSAdapter } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { prepareDeclarativeConfigContext } from "#veryfront/config/declarative-evaluator.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { resolveAdapter } from "./adapter-factory.ts";
import { defaultDiscoveryCache, ProjectDiscoveryCache } from "./local-project-discovery.ts";

const localProjectCache = defaultDiscoveryCache.projects;
const localAdapterCache = defaultDiscoveryCache.adapters;

const encoder = new TextEncoder();

async function prepareEmptyHostedConfigContext() {
  return {
    sourceContext: {
      productionMode: false,
      branch: null,
    } as const,
    preparedContext: await prepareDeclarativeConfigContext({
      environmentName: "preview",
      environment: {},
    }),
  };
}

async function preparePreviewHostedConfigContext(
  environment: Record<string, string> = {},
) {
  return {
    sourceContext: {
      productionMode: false,
      branch: "feature",
    } as const,
    preparedContext: await prepareDeclarativeConfigContext({
      environmentName: "preview",
      environment,
    }),
  };
}

async function prepareProductionHostedConfigContext(
  environment: Record<string, string> = {},
) {
  return {
    sourceContext: {
      productionMode: true,
      releaseId: "rel-1",
      environmentName: "staging",
    } as const,
    preparedContext: await prepareDeclarativeConfigContext({
      environmentName: "staging",
      environment,
    }),
  };
}

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

// Shared Ed25519 key pair and PEM-encoded public half. Lazily generated on the
// first makeReq({ dispatchJws: "valid" }) call so tests that don't need a valid JWS
// pay nothing for the key material.
let signingKeyPair: CryptoKeyPair | undefined;
let trustedPublicKeyPem: string | undefined;

async function ensureKeyMaterial(): Promise<void> {
  if (signingKeyPair && trustedPublicKeyPem) return;
  signingKeyPair = (await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = await crypto.subtle.exportKey("spki", signingKeyPair.publicKey);
  trustedPublicKeyPem = encodePem("PUBLIC KEY", der);
}

async function mintTrustedDispatchJws(): Promise<string> {
  await ensureKeyMaterial();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", typ: "JWT" };
  const claims = {
    iss: "veryfront-api",
    aud: "demo-project",
    sub: "dispatch-adapter-test",
    project_id: "proj_123",
    platform: "slack",
    body_sha256: "n/a",
    iat: now,
    exp: now + 60,
  };
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(claims));
  const signingInput = encoder.encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign("Ed25519", signingKeyPair!.privateKey, signingInput);
  return `${encodedHeader}.${encodedPayload}.${base64urlEncodeBytes(new Uint8Array(signature))}`;
}

/**
 * Build a Request suitable for resolveAdapter tests.
 *
 * @param options.projectPath Value for the `x-project-path` header (if provided)
 * @param options.dispatchJws Attach a valid or deliberately bogus dispatch JWS.
 *                            Signature authenticity must not grant routing
 *                            authority to `x-project-path`.
 */
async function makeReq(
  options: { projectPath?: string; dispatchJws?: "valid" | "bogus" } = {},
): Promise<Request> {
  const headers = new Headers();
  if (options.projectPath !== undefined) {
    headers.set("x-project-path", options.projectPath);
  }
  if (options.dispatchJws === "valid") {
    headers.set("x-veryfront-dispatch-jws", await mintTrustedDispatchJws());
  } else if (options.dispatchJws === "bogus") {
    headers.set("x-veryfront-dispatch-jws", "eyJhbGciOi.fake.value");
  }
  return new Request("http://example.com/", { headers });
}

function createMockAdapter(
  files: Record<string, { isDirectory: boolean; isFile?: boolean }>,
): RuntimeAdapter {
  return {
    id: "memory",
    name: "Memory",
    capabilities: {
      typescript: true,
      jsx: true,
      http2: false,
      websocket: true,
      workers: false,
      fileWatching: false,
      shell: false,
      kvStore: false,
      writableFs: true,
    },
    fs: {
      readFile: async (path: string) => {
        const entry = files[path];
        if (entry?.isFile ?? (entry !== undefined && !entry.isDirectory)) {
          return "";
        }
        throw new Deno.errors.NotFound(`Not found: ${path}`);
      },
      writeFile: async () => {},
      exists: async (path: string) => path in files,
      readDir: async function* () {},
      stat: async (path: string) => {
        const entry = files[path];
        if (!entry) throw new Error(`Not found: ${path}`);
        return {
          size: 0,
          isFile: entry.isFile ?? !entry.isDirectory,
          isDirectory: entry.isDirectory,
          isSymlink: false,
          mtime: null,
        };
      },
      mkdir: async () => {},
      remove: async () => {},
      makeTempDir: async () => "/tmp/vf-test",
      watch: () => ({ close: () => {}, [Symbol.asyncIterator]: async function* () {} }),
    },
    env: {
      get: () => undefined,
      set: () => {},
      toObject: () => ({}),
    },
    server: {
      upgradeWebSocket: () => {
        throw new Error("Not implemented");
      },
    },
    serve: async () => ({
      stop: async () => {},
      addr: { hostname: "127.0.0.1", port: 0 },
    }),
  };
}

describe("adapter-factory", () => {
  afterEach(() => {
    localProjectCache.clear();
    localAdapterCache.clear();
  });

  it("ignores x-project-path override outside proxy mode", async () => {
    const adapter = createMockAdapter({
      "/trusted/project": { isDirectory: true },
      "/trusted/project/app": { isDirectory: true },
    });

    const result = await resolveAdapter({
      req: await makeReq({ projectPath: "/trusted/project", dispatchJws: "valid" }),
      projectDir: "/base/project",
      adapter,
      config: undefined,
      projectSlug: "myproject",
      projectId: "proj_123",
      proxyToken: undefined,
      releaseId: undefined,
      proxyEnv: "preview",
      branch: null,
      environmentName: undefined,
      parsedDomain: {
        slug: null,
        branch: null,
        environment: null,
        isVeryfrontDomain: false,
        isDraft: false,
        allowIframeEmbed: false,
      },
      isProxyMode: false,
    });

    assertEquals(result.isLocalProject, false);
    assertEquals(result.projectDir, "/base/project");
    assertEquals(localProjectCache.has("myproject"), false);
  });

  it("accepts x-project-path when the operator trusts the private-edge topology", async () => {
    const adapter = createMockAdapter({
      "/trusted/project": { isDirectory: true },
      "/trusted/project/app": { isDirectory: true },
    });

    // Prevent runtime.get() calls in local adapter branch.
    localAdapterCache.set("/trusted/project", adapter);

    const result = await resolveAdapter({
      req: await makeReq({ projectPath: "/trusted/project" }),
      projectDir: "/base/project",
      adapter,
      config: undefined,
      projectSlug: "myproject",
      projectId: "proj_123",
      proxyToken: undefined,
      releaseId: undefined,
      proxyEnv: "preview",
      branch: null,
      environmentName: undefined,
      parsedDomain: {
        slug: null,
        branch: null,
        environment: null,
        isVeryfrontDomain: false,
        isDraft: false,
        allowIframeEmbed: false,
      },
      isProxyMode: true,
      proxyTopologyTrusted: true,
      prepareHostedConfigContext: prepareEmptyHostedConfigContext,
    });

    assertEquals(result.isLocalProject, true);
    assertEquals(result.projectDir, "/trusted/project");
    assertEquals(localProjectCache.get("myproject"), "/trusted/project");
  });

  it("ignores x-project-path when private-edge topology is untrusted (VULN-SRV-3)", async () => {
    // An attacker reaching the runtime directly (no dispatch-JWS, env not set)
    // must not be able to steer project discovery at arbitrary filesystem paths.
    const adapter = createMockAdapter({
      "/attacker/chosen/path": { isDirectory: true },
      "/attacker/chosen/path/app": { isDirectory: true },
    });

    const result = await resolveAdapter({
      req: await makeReq({ projectPath: "/attacker/chosen/path" }),
      projectDir: "/base/project",
      adapter,
      config: undefined,
      projectSlug: "myproject",
      projectId: "proj_123",
      proxyToken: undefined,
      releaseId: undefined,
      proxyEnv: "preview",
      branch: null,
      environmentName: undefined,
      parsedDomain: {
        slug: null,
        branch: null,
        environment: null,
        isVeryfrontDomain: false,
        isDraft: false,
        allowIframeEmbed: false,
      },
      isProxyMode: true,
      proxyTopologyTrusted: false,
    });

    // The attacker-supplied path must not be adopted as the project root.
    assertEquals(result.isLocalProject, false);
    assertEquals(result.projectDir, "/base/project");
    assertEquals(localProjectCache.has("myproject"), false);
  });

  it(
    "does not let an unverifiable dispatch JWS grant x-project-path authority",
    async () => {
      // Historically a composite proxy-trust signal trusted a request that carried an
      // `x-veryfront-dispatch-jws` header. The proxy does not strip that header
      // on ingress (it has to pass through to channel handlers), so a direct-
      // access attacker could attach any value — including gibberish — and
      // re-enable `x-project-path` spoofing. This test pins the fix: a bogus
      // (unsigned / unverifiable) dispatch JWS must not grant topology authority.
      const adapter = createMockAdapter({
        "/attacker/chosen/path": { isDirectory: true },
        "/attacker/chosen/path/app": { isDirectory: true },
      });

      const result = await resolveAdapter({
        req: await makeReq({
          projectPath: "/attacker/chosen/path",
          dispatchJws: "bogus",
        }),
        projectDir: "/base/project",
        adapter,
        config: undefined,
        projectSlug: "myproject",
        projectId: "proj_123",
        proxyToken: undefined,
        releaseId: undefined,
        proxyEnv: "preview",
        branch: null,
        environmentName: undefined,
        parsedDomain: {
          slug: null,
          branch: null,
          environment: null,
          isVeryfrontDomain: false,
          isDraft: false,
          allowIframeEmbed: false,
        },
        isProxyMode: true,
        proxyTopologyTrusted: false,
      });

      assertEquals(result.isLocalProject, false);
      assertEquals(result.projectDir, "/base/project");
      assertEquals(localProjectCache.has("myproject"), false);
    },
  );

  it("ignores x-project-path even when an unrelated dispatch JWS is valid", async () => {
    const adapter = createMockAdapter({
      "/trusted/project": { isDirectory: true },
      "/trusted/project/app": { isDirectory: true },
    });
    localAdapterCache.set("/trusted/project", adapter);
    const req = await makeReq({
      projectPath: "/trusted/project",
      dispatchJws: "valid",
    });
    const dispatchJws = req.headers.get("x-veryfront-dispatch-jws");
    assertExists(dispatchJws);
    assertExists(trustedPublicKeyPem);
    assertEquals(
      await verifyDispatchJwsSignature(dispatchJws, {
        publicKeyPem: trustedPublicKeyPem,
        maxAgeSeconds: 60,
      }),
      true,
    );

    const result = await resolveAdapter({
      req,
      projectDir: "/base/project",
      adapter,
      config: undefined,
      projectSlug: "myproject",
      projectId: "proj_123",
      proxyToken: undefined,
      releaseId: undefined,
      proxyEnv: "preview",
      branch: null,
      environmentName: undefined,
      parsedDomain: {
        slug: null,
        branch: null,
        environment: null,
        isVeryfrontDomain: false,
        isDraft: false,
        allowIframeEmbed: false,
      },
      isProxyMode: true,
      proxyTopologyTrusted: false,
    });

    assertEquals(result.isLocalProject, false);
    assertEquals(result.projectDir, "/base/project");
    assertEquals(localProjectCache.has("myproject"), false);
  });

  it("returns original adapter when no local project found and not proxy mode", async () => {
    const adapter = createMockAdapter({});
    const result = await resolveAdapter({
      projectDir: "/base/project",
      adapter,
      config: undefined,
      projectSlug: "nonexistent",
      projectId: "proj_123",
      proxyToken: undefined,
      releaseId: undefined,
      proxyEnv: "preview",
      branch: null,
      environmentName: undefined,
      parsedDomain: {
        slug: null,
        branch: null,
        environment: null,
        isVeryfrontDomain: false,
        isDraft: false,
        allowIframeEmbed: false,
      },
      req: await makeReq(),
      isProxyMode: false,
    });

    assertEquals(result.isLocalProject, false);
    assertEquals(result.projectDir, "/base/project");
    assertEquals(result.adapter, adapter);
    assertEquals(result.config, undefined);
  });

  it("skips local discovery in proxy mode when no x-project-path header is supplied", async () => {
    const adapter = createMockAdapter({
      "data/projects/myproject": { isDirectory: true },
      "data/projects/myproject/app": { isDirectory: true },
    });

    const result = await resolveAdapter({
      projectDir: "/base/project",
      adapter,
      config: undefined,
      projectSlug: "myproject",
      projectId: "proj_123",
      proxyToken: undefined,
      releaseId: undefined,
      proxyEnv: "preview",
      branch: null,
      environmentName: undefined,
      parsedDomain: {
        slug: null,
        branch: null,
        environment: null,
        isVeryfrontDomain: false,
        isDraft: false,
        allowIframeEmbed: false,
      },
      req: await makeReq(),
      isProxyMode: true,
    });

    // In proxy mode without header, local discovery is skipped
    assertEquals(result.isLocalProject, false);
    assertEquals(result.projectDir, "/base/project");
  });

  it("skips local discovery when projectSlug is undefined", async () => {
    const adapter = createMockAdapter({
      "data/projects/myproject": { isDirectory: true },
      "data/projects/myproject/app": { isDirectory: true },
    });

    const result = await resolveAdapter({
      projectDir: "/base/project",
      adapter,
      config: undefined,
      projectSlug: undefined,
      projectId: undefined,
      proxyToken: undefined,
      releaseId: undefined,
      proxyEnv: "preview",
      branch: null,
      environmentName: undefined,
      parsedDomain: {
        slug: null,
        branch: null,
        environment: null,
        isVeryfrontDomain: false,
        isDraft: false,
        allowIframeEmbed: false,
      },
      req: await makeReq(),
      isProxyMode: false,
    });

    assertEquals(result.isLocalProject, false);
  });

  it("preserves provided config when no local project is found", async () => {
    const adapter = createMockAdapter({});
    const existingConfig = { layout: "test-layout" } as any;

    const result = await resolveAdapter({
      projectDir: "/base/project",
      adapter,
      config: existingConfig,
      projectSlug: "missing",
      projectId: undefined,
      proxyToken: undefined,
      releaseId: undefined,
      proxyEnv: "preview",
      branch: null,
      environmentName: undefined,
      parsedDomain: {
        slug: null,
        branch: null,
        environment: null,
        isVeryfrontDomain: false,
        isDraft: false,
        allowIframeEmbed: false,
      },
      req: await makeReq(),
      isProxyMode: false,
    });

    assertEquals(result.config, existingConfig);
  });

  it("returns all expected fields in result structure", async () => {
    const adapter = createMockAdapter({});

    const result = await resolveAdapter({
      projectDir: "/base/project",
      adapter,
      config: undefined,
      projectSlug: "test",
      projectId: "p1",
      proxyToken: undefined,
      releaseId: undefined,
      proxyEnv: "preview",
      branch: null,
      environmentName: undefined,
      parsedDomain: {
        slug: null,
        branch: null,
        environment: null,
        isVeryfrontDomain: false,
        isDraft: false,
        allowIframeEmbed: false,
      },
      req: await makeReq(),
      isProxyMode: false,
    });

    assertEquals("projectDir" in result, true);
    assertEquals("adapter" in result, true);
    assertEquals("config" in result, true);
    assertEquals("isLocalProject" in result, true);
  });

  it("uses injected cache instead of default singleton", async () => {
    const cache = new ProjectDiscoveryCache();
    const adapter = createMockAdapter({
      "/trusted/project": { isDirectory: true },
      "/trusted/project/app": { isDirectory: true },
    });

    // Pre-populate the injected cache with an adapter to prevent runtime.get() calls
    cache.adapters.set("/trusted/project", adapter);

    const result = await resolveAdapter({
      req: await makeReq({ projectPath: "/trusted/project" }),
      projectDir: "/base/project",
      adapter,
      config: undefined,
      projectSlug: "myproject",
      projectId: "proj_123",
      proxyToken: undefined,
      releaseId: undefined,
      proxyEnv: "preview",
      branch: null,
      environmentName: undefined,
      parsedDomain: {
        slug: null,
        branch: null,
        environment: null,
        isVeryfrontDomain: false,
        isDraft: false,
        allowIframeEmbed: false,
      },
      isProxyMode: true,
      proxyTopologyTrusted: true,
      cache,
      prepareHostedConfigContext: prepareEmptyHostedConfigContext,
    });

    assertEquals(result.isLocalProject, true);
    assertEquals(result.projectDir, "/trusted/project");
    // Injected cache should have the project
    assertEquals(cache.projects.get("myproject"), "/trusted/project");
    // Default singleton should NOT be affected
    assertEquals(localProjectCache.has("myproject"), false);
  });

  it("loads config for local project (uses pre-cached adapter)", async () => {
    const cache = new ProjectDiscoveryCache();
    const adapter = createMockAdapter({
      "/local/project": { isDirectory: true },
      "/local/project/app": { isDirectory: true },
    });

    // Pre-populate both caches: project path + adapter
    cache.projects.set("localslug", "/local/project");
    cache.adapters.set("/local/project", adapter);

    const result = await resolveAdapter({
      projectDir: "/base/project",
      adapter,
      config: undefined,
      projectSlug: "localslug",
      projectId: "proj_loc",
      proxyToken: undefined,
      releaseId: undefined,
      proxyEnv: "preview",
      branch: null,
      environmentName: undefined,
      parsedDomain: {
        slug: null,
        branch: null,
        environment: null,
        isVeryfrontDomain: false,
        isDraft: false,
        allowIframeEmbed: false,
      },
      req: await makeReq(),
      isProxyMode: false,
      cache,
    });

    assertEquals(result.isLocalProject, true);
    assertEquals(result.projectDir, "/local/project");
    // A missing config file resolves to fresh defaults; malformed existing config fails closed.
    assertEquals(result.adapter, adapter);
  });

  it("rejects malformed existing config for a local project", async () => {
    const cache = new ProjectDiscoveryCache();
    const adapter = createMockAdapter({
      "/local/malformed-project": { isDirectory: true },
      "/local/malformed-project/app": { isDirectory: true },
      "/local/malformed-project/veryfront.config.ts": { isDirectory: false, isFile: true },
    });
    adapter.fs.readFile = (path: string) =>
      Promise.resolve(
        path.endsWith("veryfront.config.ts") ? "export default { integrations:" : "",
      );
    cache.projects.set("malformedslug", "/local/malformed-project");
    cache.adapters.set("/local/malformed-project", adapter);
    const req = await makeReq();

    await assertRejects(
      () =>
        resolveAdapter({
          projectDir: "/base/project",
          adapter,
          config: undefined,
          projectSlug: "malformedslug",
          projectId: "proj_loc",
          proxyToken: undefined,
          releaseId: undefined,
          proxyEnv: "preview",
          branch: null,
          environmentName: undefined,
          parsedDomain: {
            slug: null,
            branch: null,
            environment: null,
            isVeryfrontDomain: false,
            isDraft: false,
            allowIframeEmbed: false,
          },
          req,
          isProxyMode: false,
          cache,
        }),
    );
  });

  describe("proxy mode config loading", () => {
    function createExtendedMockAdapter(
      options: {
        files?: Record<string, { isDirectory: boolean; isFile?: boolean }>;
        configSource?: string;
      } = {},
    ) {
      const calls: Record<string, unknown[]> = {};
      const base = createMockAdapter(options.files ?? {});
      if (options.configSource !== undefined) {
        base.fs.readFile = async () => options.configSource!;
      }
      const styleConfigBinding = Object.freeze({
        projectSlug: "proxy-slug",
        sourceKey: "test-source",
        sourceRevision: 1,
      });
      const contextualFs: ContextualFSAdapter = {
        readFile: (path) => base.fs.readFile(path),
        exists: (path) => base.fs.exists(path),
        stat: (path) => base.fs.stat(path),
        createStyleConfigBinding: () => {
          calls.createStyleConfigBinding = [];
          return Promise.resolve(styleConfigBinding);
        },
        installStyleConfig: (binding: unknown, config: unknown) => {
          calls.installStyleConfig = [binding, config];
          return Promise.resolve(binding === styleConfigBinding);
        },
        runWithContext: <T>(
          slug: string,
          token: string,
          fn: () => Promise<T>,
          projectId?: string,
          opts?: {
            productionMode?: boolean;
            releaseId?: string | null;
            branch?: string | null;
            environmentName?: string | null;
            tokenProvenance?: "project-bound" | "untrusted";
          },
        ): Promise<T> => {
          calls.runWithContext = [slug, token, projectId, opts];
          return runWithRequestContext({
            projectSlug: slug,
            token,
            projectId,
            ...opts,
          }, fn);
        },
      };
      return {
        adapter: { ...base, fs: new FSAdapterWrapper(contextualFs) } as RuntimeAdapter,
        calls,
        styleConfigBinding,
      };
    }

    it("evaluates remote proxy config with a supported custom hosted adapter", async () => {
      const { adapter, calls, styleConfigBinding } = createExtendedMockAdapter({
        files: {
          "/veryfront.config.ts": { isDirectory: false, isFile: true },
        },
        configSource: `
          import { getEnv } from "veryfront";
          export default {
            title: getEnv("TENANT_NAME") ?? "missing",
            description: getEnv("HOST_ONLY_FOR_ADAPTER_FACTORY_TEST") ?? "not-visible",
          };
        `,
      });
      const preparedFor: boolean[] = [];

      const result = await resolveAdapter({
        projectDir: "/base/project",
        adapter,
        config: undefined,
        projectSlug: "proxy-slug",
        projectId: "proj_proxy",
        proxyToken: "tok-123",
        tokenProvenance: "project-bound",
        releaseId: "unbound-header-release",
        proxyEnv: "production",
        branch: "ignored-production-branch",
        environmentName: undefined,
        parsedDomain: {
          slug: "proxy-slug",
          branch: null,
          environment: "staging",
          isVeryfrontDomain: true,
          isDraft: false,
          allowIframeEmbed: false,
        },
        req: await makeReq(),
        isProxyMode: true,
        prepareHostedConfigContext: async (isLocalProject) => {
          preparedFor.push(isLocalProject);
          return await prepareProductionHostedConfigContext({
            TENANT_NAME: "remote-tenant",
          });
        },
      });

      assertEquals(preparedFor, [false]);
      assertEquals(result.config?.title, "remote-tenant");
      assertEquals(result.config?.description, "not-visible");
      assertEquals(calls.createStyleConfigBinding, []);
      assertEquals(calls.installStyleConfig, [styleConfigBinding, result.config]);
      assertEquals(calls.runWithContext, [
        "proxy-slug",
        "tok-123",
        "proj_proxy",
        {
          productionMode: true,
          releaseId: "rel-1",
          branch: undefined,
          environmentName: "staging",
          tokenProvenance: "project-bound",
        },
      ]);
    });

    it("reloads once when the content source revision changes during hosted config loading", async () => {
      const base = createMockAdapter({
        "/veryfront.config.ts": { isDirectory: false, isFile: true },
      });
      let sourceRevision = 1;
      let configReads = 0;
      const issuedRevisions: number[] = [];
      const installationResults: boolean[] = [];

      base.fs.readFile = async () => {
        configReads++;
        const revisionRead = sourceRevision;
        if (configReads === 1) sourceRevision++;
        const title = revisionRead === 1 ? "stale-config" : "fresh-config";
        return `export default { title: ${JSON.stringify(title)} };`;
      };

      const contextualFs: ContextualFSAdapter = {
        readFile: (path) => base.fs.readFile(path),
        exists: (path) => base.fs.exists(path),
        stat: (path) => base.fs.stat(path),
        createStyleConfigBinding: () => {
          issuedRevisions.push(sourceRevision);
          return {
            projectSlug: "proxy-slug",
            sourceKey: "preview:feature",
            sourceRevision,
          };
        },
        installStyleConfig: (binding) => {
          const installed = binding.sourceRevision === sourceRevision;
          installationResults.push(installed);
          return installed;
        },
        runWithContext: <T>(
          slug: string,
          token: string,
          fn: () => Promise<T>,
          projectId?: string,
          options?: {
            productionMode?: boolean;
            releaseId?: string | null;
            branch?: string | null;
            environmentName?: string | null;
            tokenProvenance?: "project-bound" | "untrusted";
          },
        ): Promise<T> =>
          runWithRequestContext({
            projectSlug: slug,
            token,
            projectId,
            ...options,
          }, fn),
      };
      const adapter = {
        ...base,
        fs: new FSAdapterWrapper(contextualFs),
      } as RuntimeAdapter;

      const result = await resolveAdapter({
        projectDir: "/base/project",
        adapter,
        config: undefined,
        projectSlug: "proxy-slug",
        projectId: "proj_proxy",
        proxyToken: "tok-123",
        tokenProvenance: "project-bound",
        releaseId: undefined,
        proxyEnv: "preview",
        branch: "feature",
        environmentName: undefined,
        parsedDomain: {
          slug: "proxy-slug",
          branch: "feature",
          environment: "preview",
          isVeryfrontDomain: true,
          isDraft: true,
          allowIframeEmbed: false,
        },
        req: await makeReq(),
        isProxyMode: true,
        prepareHostedConfigContext: () =>
          preparePreviewHostedConfigContext({
            TENANT_NAME: "remote-tenant",
          }),
      });

      assertEquals(result.config?.title, "fresh-config");
      assertEquals(configReads, 2);
      assertEquals(issuedRevisions, [1, 2]);
      assertEquals(installationResults, [false, true]);
    });

    it("fails retryably when the hosted source changes on both bounded attempts", async () => {
      const base = createMockAdapter({
        "/veryfront.config.ts": { isDirectory: false, isFile: true },
      });
      let configReads = 0;
      let sourceRevision = 0;

      base.fs.readFile = async () => {
        configReads++;
        return `export default { title: "revision-${configReads}" };`;
      };

      const contextualFs: ContextualFSAdapter = {
        readFile: (path) => base.fs.readFile(path),
        exists: (path) => base.fs.exists(path),
        stat: (path) => base.fs.stat(path),
        createStyleConfigBinding: () => ({
          projectSlug: "proxy-slug",
          sourceKey: "preview:feature",
          sourceRevision: sourceRevision++,
        }),
        installStyleConfig: () => false,
        runWithContext: <T>(
          slug: string,
          token: string,
          fn: () => Promise<T>,
          projectId?: string,
          options?: {
            productionMode?: boolean;
            releaseId?: string | null;
            branch?: string | null;
            environmentName?: string | null;
            tokenProvenance?: "project-bound" | "untrusted";
          },
        ): Promise<T> =>
          runWithRequestContext({
            projectSlug: slug,
            token,
            projectId,
            ...options,
          }, fn),
      };
      const adapter = {
        ...base,
        fs: new FSAdapterWrapper(contextualFs),
      } as RuntimeAdapter;
      const req = await makeReq();

      const error = await assertRejects(() =>
        resolveAdapter({
          projectDir: "/base/project",
          adapter,
          config: undefined,
          projectSlug: "proxy-slug",
          projectId: "proj_proxy",
          proxyToken: "tok-123",
          tokenProvenance: "project-bound",
          releaseId: undefined,
          proxyEnv: "preview",
          branch: "feature",
          environmentName: undefined,
          parsedDomain: {
            slug: "proxy-slug",
            branch: "feature",
            environment: "preview",
            isVeryfrontDomain: true,
            isDraft: true,
            allowIframeEmbed: false,
          },
          req,
          isProxyMode: true,
          prepareHostedConfigContext: () => preparePreviewHostedConfigContext(),
        })
      );

      assertEquals((error as { status?: number }).status, 503);
      assertEquals(
        (error as Error).message,
        "Hosted project source changed repeatedly while loading configuration; retry the request",
      );
      assertEquals(configReads, 2);
    });

    it("rejects a custom hosted adapter whose underlying adapter lacks style binding", async () => {
      const base = createMockAdapter({});
      let contextCalls = 0;
      const contextualFs: ContextualFSAdapter = {
        readFile: (path) => base.fs.readFile(path),
        exists: (path) => base.fs.exists(path),
        stat: (path) => base.fs.stat(path),
        runWithContext: <T>(
          slug: string,
          token: string,
          fn: () => Promise<T>,
          projectId?: string,
          options?: {
            productionMode?: boolean;
            releaseId?: string | null;
            branch?: string | null;
            environmentName?: string | null;
            tokenProvenance?: "project-bound" | "untrusted";
          },
        ): Promise<T> => {
          contextCalls++;
          return runWithRequestContext({
            projectSlug: slug,
            token,
            projectId,
            ...options,
          }, fn);
        },
      };
      const adapter = {
        ...base,
        fs: new FSAdapterWrapper(contextualFs),
      } as RuntimeAdapter;
      const req = await makeReq();

      const error = await assertRejects(
        () =>
          resolveAdapter({
            projectDir: "/base/project",
            adapter,
            config: undefined,
            projectSlug: "proxy-slug",
            projectId: "proj_proxy",
            proxyToken: "tok-123",
            releaseId: undefined,
            proxyEnv: "preview",
            branch: "feature",
            environmentName: undefined,
            parsedDomain: {
              slug: "proxy-slug",
              branch: "feature",
              environment: "preview",
              isVeryfrontDomain: true,
              isDraft: true,
              allowIframeEmbed: true,
            },
            req,
            isProxyMode: true,
            prepareHostedConfigContext: prepareEmptyHostedConfigContext,
          }),
        Error,
        "Multi-project hosted config requires source-qualified style config support",
      );

      assertEquals(
        (error as Error & { slug?: string }).slug,
        "cache-invariant-violation",
      );
      assertEquals(contextCalls, 0);
    });

    it("preserves non-hosted custom adapters without style-binding methods", async () => {
      const base = createMockAdapter({
        "/veryfront.config.ts": { isDirectory: false, isFile: true },
      });
      base.fs.readFile = async () => `export default { title: "legacy-custom-adapter" };`;
      const underlying: ContextualFSAdapter = {
        readFile: (path) => base.fs.readFile(path),
        exists: (path) => base.fs.exists(path),
        stat: (path) => base.fs.stat(path),
      };
      let contextCalls = 0;
      const extendedFs = {
        ...base.fs,
        getUnderlyingAdapter: () => underlying,
        isVeryfrontAdapter: () => false,
        isMultiProjectMode: () => false,
        runWithContext: <T>(
          slug: string,
          token: string,
          fn: () => Promise<T>,
          projectId?: string,
          options?: {
            productionMode?: boolean;
            releaseId?: string | null;
            branch?: string | null;
            environmentName?: string | null;
            tokenProvenance?: "project-bound" | "untrusted";
          },
        ): Promise<T> => {
          contextCalls++;
          return runWithRequestContext({
            projectSlug: slug,
            token,
            projectId,
            ...options,
          }, fn);
        },
      };
      const adapter = { ...base, fs: extendedFs } as unknown as RuntimeAdapter;

      const result = await resolveAdapter({
        projectDir: "/base/project",
        adapter,
        config: undefined,
        projectSlug: "proxy-slug",
        projectId: "proj_proxy",
        proxyToken: "tok-123",
        releaseId: undefined,
        proxyEnv: "preview",
        branch: "feature",
        environmentName: undefined,
        parsedDomain: {
          slug: "proxy-slug",
          branch: "feature",
          environment: "preview",
          isVeryfrontDomain: true,
          isDraft: true,
          allowIframeEmbed: true,
        },
        req: await makeReq(),
        isProxyMode: true,
        prepareHostedConfigContext: prepareEmptyHostedConfigContext,
      });

      assertEquals(result.config?.title, "legacy-custom-adapter");
      assertEquals(contextCalls, 1);
    });

    it("never executes remote proxy config in the host isolate", async () => {
      const executionKey = "__vf_remote_adapter_factory_config_executed";
      const hostGlobal = globalThis as unknown as Record<string, unknown>;
      delete hostGlobal[executionKey];
      const { adapter } = createExtendedMockAdapter({
        files: {
          "/veryfront.config.js": { isDirectory: false, isFile: true },
        },
        configSource: `
          globalThis.${executionKey} = true;
          export default { title: "must-not-load" };
        `,
      });
      const preparedFor: boolean[] = [];
      const req = await makeReq();

      try {
        await assertRejects(() =>
          resolveAdapter({
            projectDir: "/base/project",
            adapter,
            config: undefined,
            projectSlug: "proxy-slug",
            projectId: "proj_proxy",
            proxyToken: "tok-123",
            releaseId: undefined,
            proxyEnv: "preview",
            branch: "feature",
            environmentName: undefined,
            parsedDomain: {
              slug: "proxy-slug",
              branch: "domain-branch",
              environment: "preview",
              isVeryfrontDomain: true,
              isDraft: true,
              allowIframeEmbed: true,
            },
            req,
            isProxyMode: true,
            prepareHostedConfigContext: async (isLocalProject) => {
              preparedFor.push(isLocalProject);
              return await preparePreviewHostedConfigContext();
            },
          })
        );

        assertEquals(preparedFor, [false]);
        assertEquals(hostGlobal[executionKey], undefined);
      } finally {
        delete hostGlobal[executionKey];
      }
    });

    it("never imports proxy-local config into the host isolate", async () => {
      const executionKey = "__vf_local_adapter_factory_config_executed";
      const hostGlobal = globalThis as unknown as Record<string, unknown>;
      delete hostGlobal[executionKey];
      const adapter = createMockAdapter({
        "/trusted/project": { isDirectory: true },
        "/trusted/project/app": { isDirectory: true },
        "/trusted/project/veryfront.config.js": { isDirectory: false, isFile: true },
      });
      adapter.fs.readFile = async () => `
        globalThis.${executionKey} = true;
        export default { title: "must-not-load" };
      `;
      localAdapterCache.set("/trusted/project", adapter);
      const preparedFor: boolean[] = [];
      const req = await makeReq({ projectPath: "/trusted/project" });

      try {
        await assertRejects(() =>
          resolveAdapter({
            req,
            projectDir: "/base/project",
            adapter,
            config: undefined,
            projectSlug: "proxy-slug",
            projectId: "proj_proxy",
            proxyToken: "tok-123",
            releaseId: undefined,
            proxyEnv: "preview",
            branch: "feature",
            environmentName: undefined,
            parsedDomain: {
              slug: "proxy-slug",
              branch: "domain-branch",
              environment: "preview",
              isVeryfrontDomain: true,
              isDraft: true,
              allowIframeEmbed: true,
            },
            isProxyMode: true,
            proxyTopologyTrusted: true,
            prepareHostedConfigContext: async (isLocalProject) => {
              preparedFor.push(isLocalProject);
              return await preparePreviewHostedConfigContext();
            },
          })
        );

        assertEquals(preparedFor, [true]);
        assertEquals(hostGlobal[executionKey], undefined);
      } finally {
        delete hostGlobal[executionKey];
      }
    });

    it("refreshes mutable source before loading proxy config", async () => {
      let sourceFresh = false;
      const base = createMockAdapter({
        "/veryfront.config.js": { isDirectory: false, isFile: true },
      });
      const extendedFs = {
        ...base.fs,
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({}),
        isMultiProjectMode: () => false,
        runWithContext: <T>(
          slug: string,
          token: string,
          fn: () => Promise<T>,
          projectId?: string,
          options?: {
            productionMode?: boolean;
            releaseId?: string | null;
            branch?: string | null;
            environmentName?: string | null;
          },
        ) =>
          runWithRequestContext({
            projectSlug: slug,
            token,
            projectId,
            ...options,
          }, fn),
        ensureSourceSnapshotFresh: () => {
          sourceFresh = true;
          return Promise.resolve();
        },
        readFile: (path: string) => {
          if (path !== "/veryfront.config.js") {
            return Promise.reject(new Error(`Not found: ${path}`));
          }
          return Promise.resolve(
            `export default { router: "${sourceFresh ? "pages" : "app"}" };`,
          );
        },
      };
      const adapter = { ...base, fs: extendedFs } as unknown as RuntimeAdapter;

      const result = await resolveAdapter({
        projectDir: "/base/project",
        adapter,
        config: undefined,
        projectSlug: "mutable-config-project",
        projectId: "proj_mutable_config",
        proxyToken: "tok-123",
        releaseId: undefined,
        proxyEnv: "preview",
        branch: "main",
        environmentName: undefined,
        parsedDomain: {
          slug: null,
          branch: null,
          environment: null,
          isVeryfrontDomain: false,
          isDraft: false,
          allowIframeEmbed: false,
        },
        req: await makeReq(),
        isProxyMode: true,
        prepareHostedConfigContext: () => preparePreviewHostedConfigContext(),
      });

      assertEquals(sourceFresh, true);
      assertEquals(result.config?.router, "pages");
    });

    it("re-throws config loading errors in proxy mode", async () => {
      // Use an extended adapter whose runWithContext throws
      const base = createMockAdapter({});
      const extendedFs = {
        ...base.fs,
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({}),
        isMultiProjectMode: () => false,
        runWithContext: () => {
          throw new Error("proxy config fail");
        },
      };
      const adapter = { ...base, fs: extendedFs } as unknown as RuntimeAdapter;
      const req = await makeReq();

      await assertRejects(
        () =>
          resolveAdapter({
            projectDir: "/base/project",
            adapter,
            config: undefined,
            projectSlug: "proxy-slug",
            projectId: "proj_proxy",
            proxyToken: "tok-123",
            releaseId: undefined,
            proxyEnv: "preview",
            branch: null,
            environmentName: undefined,
            parsedDomain: {
              slug: null,
              branch: null,
              environment: null,
              isVeryfrontDomain: false,
              isDraft: false,
              allowIframeEmbed: false,
            },
            req,
            isProxyMode: true,
            prepareHostedConfigContext: prepareEmptyHostedConfigContext,
          }),
        Error,
        "proxy config fail",
      );
    });

    for (
      const { method, pathname } of [
        { method: "POST", pathname: "/api/control-plane/runs/run_1/stream" },
        { method: "POST", pathname: "/api/control-plane/runs/run_1/resume" },
        { method: "DELETE", pathname: "/api/control-plane/runs/run_1" },
      ]
    ) {
      it(`leaves ${method} ${pathname} config resolution to the exact-source handler`, async () => {
        const base = createMockAdapter({});
        let outerContextCalls = 0;
        const extendedFs = {
          ...base.fs,
          isVeryfrontAdapter: () => true,
          getUnderlyingAdapter: () => ({}),
          isMultiProjectMode: () => false,
          runWithContext: () => {
            outerContextCalls++;
            throw new Error("outer source must not be read");
          },
        };
        const adapter = { ...base, fs: extendedFs } as unknown as RuntimeAdapter;
        const req = new Request(`http://example.com${pathname}`, { method });

        const result = await resolveAdapter({
          projectDir: "/base/project",
          adapter,
          config: undefined,
          projectSlug: "proxy-slug",
          projectId: "proj_proxy",
          proxyToken: "tok-123",
          releaseId: undefined,
          proxyEnv: "production",
          branch: null,
          environmentName: "production",
          parsedDomain: {
            slug: null,
            branch: null,
            environment: null,
            isVeryfrontDomain: false,
            isDraft: false,
            allowIframeEmbed: false,
          },
          req,
          pathname,
          isProxyMode: true,
        });

        assertEquals(result.isLocalProject, false);
        assertEquals(result.config, undefined);
        assertEquals(outerContextCalls, 0);
      });
    }

    it("keeps config errors strict for control-plane execute requests", async () => {
      const base = createMockAdapter({});
      const extendedFs = {
        ...base.fs,
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({}),
        isMultiProjectMode: () => false,
        runWithContext: () => {
          throw new Error("execute config fail");
        },
      };
      const adapter = { ...base, fs: extendedFs } as unknown as RuntimeAdapter;
      const req = new Request("http://example.com/api/control-plane/runs/run_1/execute", {
        method: "POST",
      });

      await assertRejects(
        () =>
          resolveAdapter({
            projectDir: "/base/project",
            adapter,
            config: undefined,
            projectSlug: "proxy-slug",
            projectId: "proj_proxy",
            proxyToken: "tok-123",
            releaseId: "rel-stale",
            proxyEnv: "production",
            branch: null,
            environmentName: "production",
            parsedDomain: {
              slug: null,
              branch: null,
              environment: null,
              isVeryfrontDomain: false,
              isDraft: false,
              allowIframeEmbed: false,
            },
            req,
            pathname: "/api/control-plane/runs/run_1/execute",
            isProxyMode: true,
            prepareHostedConfigContext: prepareEmptyHostedConfigContext,
          }),
        Error,
        "execute config fail",
      );
    });

    it("skips proxy config path when token is missing", async () => {
      const { adapter } = createExtendedMockAdapter();

      const result = await resolveAdapter({
        projectDir: "/base/project",
        adapter,
        config: undefined,
        projectSlug: "proxy-slug",
        projectId: "proj_proxy",
        proxyToken: undefined, // no token
        releaseId: undefined,
        proxyEnv: "preview",
        branch: null,
        environmentName: undefined,
        parsedDomain: {
          slug: null,
          branch: null,
          environment: null,
          isVeryfrontDomain: false,
          isDraft: false,
          allowIframeEmbed: false,
        },
        req: await makeReq(),
        isProxyMode: true,
      });

      // Without token, proxy config path is skipped
      assertEquals(result.isLocalProject, false);
      assertEquals(result.config, undefined);
    });

    it("fails closed when proxy config context preparation is unavailable", async () => {
      const base = createMockAdapter({});
      const req = await makeReq();

      await assertRejects(
        () =>
          resolveAdapter({
            projectDir: "/base/project",
            adapter: base,
            config: undefined,
            projectSlug: "proxy-slug",
            projectId: "proj_proxy",
            proxyToken: "tok-123",
            releaseId: undefined,
            proxyEnv: "preview",
            branch: null,
            environmentName: undefined,
            parsedDomain: {
              slug: null,
              branch: null,
              environment: null,
              isVeryfrontDomain: false,
              isDraft: false,
              allowIframeEmbed: false,
            },
            req,
            isProxyMode: true,
          }),
        Error,
        "Proxy project config requires an authenticated declarative evaluation context",
      );
    });
  });
});
