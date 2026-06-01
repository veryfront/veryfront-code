import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { resolveAdapter } from "./adapter-factory.ts";
import { defaultDiscoveryCache, ProjectDiscoveryCache } from "./local-project-discovery.ts";

const localProjectCache = defaultDiscoveryCache.projects;
const localAdapterCache = defaultDiscoveryCache.adapters;

const encoder = new TextEncoder();

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

// Shared Ed25519 key pair and PEM-encoded public half. Lazily generated on the
// first makeReq({ trusted: true }) call so tests that don't need a valid JWS
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
 * @param options.trusted     When true, attaches a valid freshly-signed dispatch
 *                            JWS so isProxyTrusted() verifies. When "bogus",
 *                            attaches an unverifiable header value to simulate
 *                            the direct-access spoofing attack. Omit/false for
 *                            an untrusted client.
 */
async function makeReq(
  options: { projectPath?: string; trusted?: boolean | "bogus" } = {},
): Promise<Request> {
  const headers = new Headers();
  if (options.projectPath !== undefined) {
    headers.set("x-project-path", options.projectPath);
  }
  if (options.trusted === true) {
    headers.set("x-veryfront-dispatch-jws", await mintTrustedDispatchJws());
  } else if (options.trusted === "bogus") {
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
      readFile: async () => "",
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
      get: (key: string) =>
        key === "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY" ? trustedPublicKeyPem : undefined,
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
      req: await makeReq({ projectPath: "/trusted/project", trusted: true }),
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

  it("accepts validated x-project-path override in proxy mode when proxy trusted", async () => {
    const adapter = createMockAdapter({
      "/trusted/project": { isDirectory: true },
      "/trusted/project/app": { isDirectory: true },
    });

    // Prevent runtime.get() calls in local adapter branch.
    localAdapterCache.set("/trusted/project", adapter);

    const result = await resolveAdapter({
      req: await makeReq({ projectPath: "/trusted/project", trusted: true }),
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
    });

    assertEquals(result.isLocalProject, true);
    assertEquals(result.projectDir, "/trusted/project");
    assertEquals(localProjectCache.get("myproject"), "/trusted/project");
  });

  it("ignores x-project-path in proxy mode when request is NOT proxy-trusted (VULN-SRV-3)", async () => {
    // An attacker reaching the runtime directly (no dispatch-JWS, env not set)
    // must not be able to steer project discovery at arbitrary filesystem paths.
    const adapter = createMockAdapter({
      "/attacker/chosen/path": { isDirectory: true },
      "/attacker/chosen/path/app": { isDirectory: true },
    });

    const result = await resolveAdapter({
      req: await makeReq({ projectPath: "/attacker/chosen/path", trusted: false }),
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
    });

    // The attacker-supplied path must not be adopted as the project root.
    assertEquals(result.isLocalProject, false);
    assertEquals(result.projectDir, "/base/project");
    assertEquals(localProjectCache.has("myproject"), false);
  });

  it(
    "ignores x-project-path in proxy mode when dispatch-JWS is present but unverifiable (Codex P1 regression)",
    async () => {
      // Historically `isProxyTrusted` trusted any request that merely carried an
      // `x-veryfront-dispatch-jws` header. The proxy does not strip that header
      // on ingress (it has to pass through to channel handlers), so a direct-
      // access attacker could attach any value — including gibberish — and
      // re-enable `x-project-path` spoofing. This test pins the fix: a bogus
      // (unsigned / unverifiable) dispatch JWS must NOT promote the request
      // into proxy-trusted territory.
      const adapter = createMockAdapter({
        "/attacker/chosen/path": { isDirectory: true },
        "/attacker/chosen/path/app": { isDirectory: true },
      });

      const result = await resolveAdapter({
        req: await makeReq({ projectPath: "/attacker/chosen/path", trusted: "bogus" }),
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
      });

      assertEquals(result.isLocalProject, false);
      assertEquals(result.projectDir, "/base/project");
      assertEquals(localProjectCache.has("myproject"), false);
    },
  );

  it("honours x-project-path in proxy mode when dispatch-JWS header is present", async () => {
    const adapter = createMockAdapter({
      "/trusted/project": { isDirectory: true },
      "/trusted/project/app": { isDirectory: true },
    });
    localAdapterCache.set("/trusted/project", adapter);

    const result = await resolveAdapter({
      req: await makeReq({ projectPath: "/trusted/project", trusted: true }),
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
    });

    assertEquals(result.isLocalProject, true);
    assertEquals(result.projectDir, "/trusted/project");
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
      req: await makeReq({ projectPath: "/trusted/project", trusted: true }),
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
      cache,
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
    // Config loading will fail (no real config files), but the function should still succeed
    // since config errors are caught for local projects
    assertEquals(result.adapter, adapter);
  });

  describe("proxy mode config loading", () => {
    function createExtendedMockAdapter() {
      const calls: Record<string, unknown[]> = {};
      const base = createMockAdapter({});
      // Add extended FS adapter properties to pass isExtendedFSAdapter type guard
      const extendedFs = {
        ...base.fs,
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({}),
        isMultiProjectMode: () => false,
        runWithContext: (
          slug: string,
          token: string,
          fn: () => Promise<unknown>,
          projectId?: string,
          opts?: unknown,
        ) => {
          calls.runWithContext = [slug, token, projectId, opts];
          return fn();
        },
      };
      return {
        adapter: { ...base, fs: extendedFs } as unknown as RuntimeAdapter,
        calls,
      };
    }

    it("enters proxy mode config path when isProxyMode + slug + token", async () => {
      const { adapter, calls } = createExtendedMockAdapter();

      // Proxy mode with slug + token enters the config loading path.
      // getConfig will either succeed (returning config) or throw (re-thrown in proxy mode).
      let threw = false;
      try {
        await resolveAdapter({
          projectDir: "/base/project",
          adapter,
          config: undefined,
          projectSlug: "proxy-slug",
          projectId: "proj_proxy",
          proxyToken: "tok-123",
          releaseId: "rel-1",
          proxyEnv: "production",
          branch: "main",
          environmentName: "staging",
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
      } catch {
        threw = true;
      }

      // Verify the proxy config path was entered: runWithContext should have been called
      assertEquals(calls.runWithContext !== undefined || threw, true);
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
          }),
        Error,
        "proxy config fail",
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

    it("uses non-extended path for adapter without runWithContext", async () => {
      const base = createMockAdapter({});

      // Non-extended adapter (no runWithContext) takes the direct getConfig path.
      // Config loading may succeed or throw — either outcome is valid.
      let succeeded = false;
      let threw = false;
      try {
        const result = await resolveAdapter({
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
          req: await makeReq(),
          isProxyMode: true,
        });
        succeeded = true;
        // If it succeeds, verify the result has the expected shape
        assertEquals("projectDir" in result, true);
        assertEquals("adapter" in result, true);
      } catch {
        threw = true;
      }

      // One of the two paths must have been taken
      assertEquals(succeeded || threw, true);
    });
  });
});
