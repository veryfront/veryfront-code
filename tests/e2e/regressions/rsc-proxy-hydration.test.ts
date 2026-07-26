import { registerTailwindExtension } from "../../../src/html/styles-builder/__tests__/css-processor-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import "../../_helpers/log-guard.ts";
import { join } from "#veryfront/compat/path";
import { mkdir, readTextFile, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { withTestContext } from "../../_helpers/context.ts";
import {
  captureBrowserDiagnostics,
  findHydrationOrCspFailures,
  getBrowserDiagnosticMessages,
  launchChromium,
} from "../../_helpers/playwright.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { startProductionServer } from "../../../src/server/production-server.ts";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";

const ROOT_LAYOUT_SOURCE =
  `export default function RootLayout({ children }: { children: React.ReactNode }) {
            return <html><body>{children}</body></html>;
          }`;

const LOCAL_RSC_CONFIG_SOURCE = `export default { experimental: { rsc: true } };`;

const PROXY_MODE_CONFIG_SOURCE = `export default {
            experimental: { rsc: true },
            fs: {
              type: "veryfront-api",
              veryfront: {
                proxyMode: true,
                apiBaseUrl: "https://api.veryfront.com"
              }
            }
          };`;

const DISPATCH_PUBLIC_KEY_ENV = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const encoder = new TextEncoder();

let trustedSigningKeyPair: CryptoKeyPair | undefined;
let trustedPublicKeyPem: string | undefined;

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

async function ensureTrustedProxyKeyMaterial(): Promise<void> {
  if (trustedSigningKeyPair && trustedPublicKeyPem) return;

  trustedSigningKeyPair = (await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = await crypto.subtle.exportKey("spki", trustedSigningKeyPair.publicKey);
  trustedPublicKeyPem = encodePem("PUBLIC KEY", der);
}

async function mintTrustedDispatchJws(projectId: string): Promise<string> {
  await ensureTrustedProxyKeyMaterial();

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", typ: "JWT" };
  const claims = {
    iss: "veryfront-api",
    aud: projectId,
    sub: "rsc-proxy-hydration-test",
    project_id: projectId,
    platform: "browser",
    body_sha256: "n/a",
    iat: now,
    exp: now + 60,
  };
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(claims));
  const signingInput = encoder.encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign(
    "Ed25519",
    trustedSigningKeyPair!.privateKey,
    signingInput,
  );
  return `${encodedHeader}.${encodedPayload}.${base64urlEncodeBytes(new Uint8Array(signature))}`;
}

interface TestProjectContext {
  projectDir: string;
  projectId: string;
  allocatePort: () => Promise<number>;
}

interface ProxyBrowserFixture {
  readonly environment: "preview" | "production";
  readonly projectId: string;
  readonly projectSlug: string;
  readonly environmentId: string;
  readonly releaseId: string;
  readonly headers: Readonly<Record<string, string>>;
}

interface ProxyApiFile {
  readonly id: string;
  readonly version_id: string;
  readonly path: string;
  readonly content: string;
  readonly type: "file";
  readonly size: number;
  readonly updated_at: string;
}

async function waitForReady(port: number, timeoutMs = 5000): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`);
      try {
        if (response.status === 200) return;
      } finally {
        await response.body?.cancel();
      }
    } catch {
      // server is still starting
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Server reported not-ready via /readyz");
}

async function writeClientApp(
  projectDir: string,
  configSource: string,
  pageSource: string,
): Promise<void> {
  await writeTextFile(join(projectDir, "veryfront.config.js"), configSource);

  await remove(join(projectDir, "app"), { recursive: true });
  await remove(join(projectDir, "pages"), { recursive: true });

  await mkdir(join(projectDir, "app"), { recursive: true });
  await writeTextFile(join(projectDir, "app", "layout.tsx"), ROOT_LAYOUT_SOURCE);
  await writeTextFile(join(projectDir, "app", "page.tsx"), pageSource);
}

async function writeClientCounterApp(
  projectDir: string,
  configSource: string,
): Promise<void> {
  await writeClientApp(
    projectDir,
    configSource,
    `"use client";
import { useEffect, useState } from "react";

export default function Page() {
  const [count, setCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <button
      id="counter"
      data-hydrated={hydrated ? "yes" : "no"}
      onClick={() => setCount((value) => value + 1)}
    >
      Count: {count}
    </button>
  );
}
`,
  );
}

async function writePreviewChatApp(
  projectDir: string,
  configSource: string,
): Promise<void> {
  await writeClientApp(
    projectDir,
    configSource,
    `"use client";
import type { ChatMessage } from "veryfront/agent/react";
import { Chat } from "veryfront/chat";

const initialMessages: ChatMessage[] = [
  {
    id: "assistant-1",
    role: "assistant",
    metadata: {
      model: "anthropic/claude-sonnet-4-20250514",
    },
    parts: [
      {
        type: "text",
        text: "Styled preview assistant response",
      },
    ],
  },
];

export default function Page() {
  return (
    <main id="preview-chat-page">
      <Chat initialMessages={initialMessages} />
    </main>
  );
}
`,
  );
}

function createProxyBrowserFixture(
  environment: "preview" | "production",
): ProxyBrowserFixture {
  const projectSlug = environment === "preview"
    ? "browser-preview-project"
    : "browser-proxy-project";
  // Hosted control-plane identities are UUIDs. Each test context represents an
  // independent project, so fresh IDs prevent intentional tenant-cache sharing
  // from looking like cache corruption while preserving the production shape.
  const projectId = crypto.randomUUID();
  const environmentId = crypto.randomUUID();
  const releaseId = environment === "preview" ? "rel-browser-preview-test" : "rel-browser-test";

  return {
    environment,
    projectId,
    projectSlug,
    environmentId,
    releaseId,
    headers: {
      "x-environment": environment,
      "x-environment-id": environmentId,
      "x-forwarded-host": `${projectSlug}.${environment}.veryfront.com`,
      "x-project-slug": projectSlug,
      "x-release-id": releaseId,
      "x-token": "test-token",
    },
  };
}

function createProxyProjectEnvFetch(
  fixture: ProxyBrowserFixture,
): typeof globalThis.fetch {
  return (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const routingPrefix = "/projects/-/proxy-routing/";
    const routingIndex = url.pathname.indexOf(routingPrefix);
    if (routingIndex >= 0) {
      const projectSlug = decodeURIComponent(
        url.pathname.slice(routingIndex + routingPrefix.length),
      );
      if (projectSlug !== fixture.projectSlug) {
        return Promise.resolve(new Response("Not Found", { status: 404 }));
      }

      return Promise.resolve(Response.json({
        id: fixture.projectId,
        slug: fixture.projectSlug,
        name: "RSC proxy browser fixture",
        environments: [{
          id: fixture.environmentId,
          name: fixture.environment,
          active_release_id: fixture.environment === "production" ? fixture.releaseId : null,
        }],
      }));
    }

    if (url.pathname.endsWith("/environment-variables")) {
      return Promise.resolve(Response.json({ data: [] }));
    }

    return Promise.resolve(new Response("Not Found", { status: 404 }));
  };
}

async function loadProxyApiFiles(projectDir: string): Promise<ProxyApiFile[]> {
  const paths = [
    "veryfront.config.js",
    "app/layout.tsx",
    "app/page.tsx",
  ] as const;

  return await Promise.all(paths.map(async (path, index) => {
    const content = await readTextFile(join(projectDir, path));
    return {
      id: `file-${index + 1}`,
      version_id: `version-${index + 1}`,
      path,
      content,
      type: "file" as const,
      size: encoder.encode(content).byteLength,
      updated_at: "2026-01-01T00:00:00.000Z",
    };
  }));
}

function proxyApiPageInfo() {
  return {
    self: null,
    first: null,
    next: null,
    prev: null,
  };
}

function matchesProxyApiPattern(path: string, pattern: string): boolean {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
  const source = escaped.replaceAll("*", ".*");
  return new RegExp(`^${source}$`, "u").test(path);
}

function selectProxyApiFiles(files: readonly ProxyApiFile[], url: URL): ProxyApiFile[] {
  const requestedPath = url.searchParams.get("path");
  const pattern = url.searchParams.get("pattern");

  return files.filter((file) => {
    if (
      requestedPath &&
      file.path !== requestedPath &&
      !file.path.startsWith(`${requestedPath.replace(/\/+$/u, "")}/`)
    ) {
      return false;
    }
    return !pattern || matchesProxyApiPattern(file.path, pattern);
  });
}

function createProxyFilesystemFetch(
  fixture: ProxyBrowserFixture,
  files: readonly ProxyApiFile[],
  passthroughFetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "https://api.veryfront.com") {
      return await passthroughFetch(input, init);
    }

    if (request.headers.get("authorization") !== "Bearer test-token") {
      return Response.json({ detail: "Unauthorized" }, { status: 401 });
    }

    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const projectRef = segments[1];
    if (segments[0] !== "projects") {
      return Response.json({ detail: "Not Found" }, { status: 404 });
    }

    if (
      segments.length === 2 &&
      (projectRef === fixture.projectId || projectRef === fixture.projectSlug)
    ) {
      return Response.json({
        id: fixture.projectId,
        name: "RSC proxy browser fixture",
        slug: fixture.projectSlug,
      });
    }

    if (projectRef !== fixture.projectSlug) {
      return Response.json({ detail: "Not Found" }, { status: 404 });
    }

    const selectedFiles = selectProxyApiFiles(files, url);
    const findFile = (pathOrId: string | undefined): ProxyApiFile | undefined =>
      files.find((file) => file.path === pathOrId || file.id === pathOrId);

    if (segments[2] === "files") {
      if (segments.length === 3) {
        return Response.json({
          data: selectedFiles,
          page_info: proxyApiPageInfo(),
        });
      }
      const file = findFile(segments[3]);
      return file ? Response.json(file) : Response.json({ detail: "Not Found" }, { status: 404 });
    }

    if (
      (segments[2] === "releases" || segments[2] === "environments") &&
      segments[4] === "files"
    ) {
      const releaseMetadata = {
        release_id: fixture.releaseId,
        release_version: null,
      };
      const environmentMetadata = segments[2] === "environments"
        ? {
          environment_id: fixture.environmentId,
          environment_name: fixture.environment,
        }
        : {};

      if (segments.length === 5) {
        return Response.json({
          data: selectedFiles,
          page_info: proxyApiPageInfo(),
          ...releaseMetadata,
          ...environmentMetadata,
        });
      }
      const file = findFile(segments[5]);
      return file
        ? Response.json({
          ...file,
          ...releaseMetadata,
          ...environmentMetadata,
        })
        : Response.json({ detail: "Not Found" }, { status: 404 });
    }

    if (segments[2] === "style-artifacts" && segments[3] === "current") {
      if (request.method === "GET") {
        return Response.json({ status: "missing" });
      }
      if (request.method === "POST") {
        return Response.json({
          status: "building",
          build_run_id: "rsc-proxy-browser-fixture",
        });
      }
      if (request.method === "PUT") {
        return Response.json({ status: "ready" });
      }
    }

    if (
      segments[2] === "releases" &&
      segments[4] === "asset-manifest" &&
      request.method === "GET"
    ) {
      return Response.json({
        state: "ready",
        manifest_version: 1,
        manifest: null,
      });
    }

    return Response.json({ detail: "Not Found" }, { status: 404 });
  };
}

class ProxyFixtureWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly protocol = "";
  readonly extensions = "";
  readonly bufferedAmount = 0;
  binaryType: BinaryType = "blob";
  readyState = ProxyFixtureWebSocket.CONNECTING;
  onopen: ((this: WebSocket, event: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, event: MessageEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, event: Event) => unknown) | null = null;
  onclose: ((this: WebSocket, event: CloseEvent) => unknown) | null = null;

  constructor(url: string | URL, _protocols?: string | string[]) {
    this.url = String(url);
    queueMicrotask(() => {
      if (this.readyState !== ProxyFixtureWebSocket.CONNECTING) return;
      this.readyState = ProxyFixtureWebSocket.OPEN;
      this.onopen?.call(this as unknown as WebSocket, new Event("open"));
    });
  }

  send(_data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== ProxyFixtureWebSocket.OPEN) {
      throw new DOMException("WebSocket is not open", "InvalidStateError");
    }
  }

  close(): void {
    this.readyState = ProxyFixtureWebSocket.CLOSED;
  }
}

async function withProxyFixtureWebSocket<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  let operationFailed = false;
  let operationError: unknown;
  let result: T | undefined;

  Object.defineProperty(globalThis, "WebSocket", {
    value: ProxyFixtureWebSocket as unknown as typeof WebSocket,
    configurable: true,
    writable: true,
  });

  try {
    result = await operation();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  let restorationError: unknown;
  try {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "WebSocket", originalDescriptor);
    } else if (!Reflect.deleteProperty(globalThis, "WebSocket")) {
      throw new TypeError("Failed to remove the proxy fixture WebSocket");
    }
  } catch (error) {
    restorationError = error;
  }

  if (restorationError !== undefined) {
    if (operationFailed) {
      throw new AggregateError(
        [operationError, restorationError],
        "Proxy fixture operation and WebSocket restoration both failed",
      );
    }
    throw restorationError;
  }
  if (operationFailed) throw operationError;
  return result as T;
}

async function withProxyBrowserPage(
  browser: import("npm:playwright").Browser,
  context: TestProjectContext,
  fixture: ProxyBrowserFixture,
  run: (
    page: import("npm:playwright").Page,
    diagnostics: import("../../_helpers/playwright.ts").BrowserDiagnostics,
  ) => Promise<void>,
): Promise<void> {
  const port = await context.allocatePort();
  const controller = new AbortController();
  const previousDispatchPublicKey = Deno.env.get(DISPATCH_PUBLIC_KEY_ENV);
  const proxyTrustEnv = "VERYFRONT_TRUST_FORWARDED_HEADERS";
  const previousProxyTrust = Deno.env.get(proxyTrustEnv);

  let server: Awaited<ReturnType<typeof startProductionServer>> | undefined;

  try {
    await ensureTrustedProxyKeyMaterial();
    Deno.env.set(DISPATCH_PUBLIC_KEY_ENV, trustedPublicKeyPem!);
    Deno.env.set(proxyTrustEnv, "1");

    server = await startProductionServer({
      projectDir: context.projectDir,
      port,
      bindAddress: "127.0.0.1",
      signal: controller.signal,
      defaultProjectSlug: context.projectId,
      defaultProjectId: context.projectId,
      projectEnvFetch: createProxyProjectEnvFetch(fixture),
    });
    await server.ready;
    await registerTailwindExtension();
    await waitForReady(port);

    const files = await loadProxyApiFiles(context.projectDir);
    const passthroughFetch = globalThis.fetch;
    await withMockFetch(
      createProxyFilesystemFetch(fixture, files, passthroughFetch),
      () =>
        withProxyFixtureWebSocket(async () => {
          const browserContext = await browser.newContext({
            extraHTTPHeaders: {
              ...fixture.headers,
              "x-project-id": fixture.projectId,
              "x-veryfront-dispatch-jws": await mintTrustedDispatchJws(
                fixture.projectId,
              ),
            },
          });

          try {
            await installEsmShCorsShim(browserContext);
            const page = await browserContext.newPage();
            const diagnostics = captureBrowserDiagnostics(page);
            const response = await page.goto(`http://127.0.0.1:${port}/`);
            assertEquals(response?.status(), 200);
            await run(page, diagnostics);
          } finally {
            await browserContext.unrouteAll({ behavior: "ignoreErrors" });
            await browserContext.close();
          }
        }),
    );
  } finally {
    controller.abort();
    await server?.stop();
    if (previousDispatchPublicKey === undefined) {
      Deno.env.delete(DISPATCH_PUBLIC_KEY_ENV);
    } else {
      Deno.env.set(DISPATCH_PUBLIC_KEY_ENV, previousDispatchPublicKey);
    }
    if (previousProxyTrust === undefined) {
      Deno.env.delete(proxyTrustEnv);
    } else {
      Deno.env.set(proxyTrustEnv, previousProxyTrust);
    }
  }
}

async function installEsmShCorsShim(
  browserContext: import("npm:playwright").BrowserContext,
): Promise<void> {
  await browserContext.route("https://esm.sh/**", async (route) => {
    const request = route.request();
    const corsHeaders = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": request.headers()["access-control-request-headers"] ?? "*",
    };

    try {
      if (request.method().toUpperCase() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: corsHeaders,
          body: "",
        });
        return;
      }

      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          ...corsHeaders,
        },
      });
    } catch (error) {
      if (isClosedRouteError(error)) {
        return;
      }
      throw error;
    }
  });
}

function isClosedRouteError(error: unknown): boolean {
  return error instanceof Error &&
    (error.message.includes("Target page, context or browser has been closed") ||
      error.message.includes("Route is already handled"));
}

async function assertCounterHydration(
  page: import("npm:playwright").Page,
  diagnostics: import("../../_helpers/playwright.ts").BrowserDiagnostics,
  options: { expectedStrategy: string; expectedModulePath: string },
): Promise<void> {
  try {
    await page.waitForSelector('#counter[data-hydrated="yes"]', {
      timeout: 60_000,
    });
  } catch (error) {
    const state = await page.evaluate(() => {
      const counter = document.querySelector("#counter");
      const hydrationData = document.querySelector("#veryfront-hydration-data");
      return {
        url: location.href,
        counterHtml: counter?.outerHTML ?? null,
        hydrationDataText: hydrationData?.textContent ?? null,
        scripts: [...document.scripts].map((script) => script.src).filter(Boolean),
        resources: performance.getEntriesByType("resource").map((entry) => entry.name),
      };
    });
    throw new Error(
      [
        "Counter did not hydrate before the timeout.",
        `Expected module path: ${options.expectedModulePath}`,
        `Page state: ${JSON.stringify(state, null, 2)}`,
        `Browser diagnostics: ${
          JSON.stringify(getBrowserDiagnosticMessages(diagnostics), null, 2)
        }`,
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
      ].join("\n"),
    );
  }

  const initialText = await page.textContent("#counter");
  assertEquals(initialText?.trim(), "Count: 0");

  const hydrationData = JSON.parse(
    (await page.textContent("#veryfront-hydration-data")) ?? "{}",
  ) as { clientModuleStrategy?: string; pagePath?: string };
  assertEquals(hydrationData.clientModuleStrategy, options.expectedStrategy);
  assertEquals(hydrationData.pagePath, "app/page.tsx");

  await page.click("#counter");
  await page.waitForFunction(
    () => document.querySelector("#counter")?.textContent?.trim() === "Count: 1",
  );

  const hydratedText = await page.textContent("#counter");
  assertEquals(hydratedText?.trim(), "Count: 1");

  const resources = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name)
  );
  assertEquals(
    resources.some((name) => name.includes(options.expectedModulePath)),
    true,
  );
}

async function assertPreviewChatStyling(
  page: import("npm:playwright").Page,
): Promise<void> {
  await page.waitForSelector("#preview-chat-page [data-vf-chat]");
  await page.locator('link#vf-tailwind-css[href*="/_vf_styles/styles.css"]').waitFor({
    state: "attached",
  });
  await page.waitForSelector('svg path[d^="M17.3041"]');
  await page.waitForFunction(() => {
    const stylesheet = document.querySelector("link#vf-tailwind-css") as HTMLLinkElement | null;
    const avatarPath = document.querySelector('svg path[d^="M17.3041"]');
    const avatarSvg = avatarPath?.closest("svg");
    const avatarBox = avatarSvg?.getBoundingClientRect();

    return Boolean(
      stylesheet?.sheet &&
        avatarBox &&
        avatarBox.width > 0 &&
        avatarBox.width <= 24 &&
        avatarBox.height > 0 &&
        avatarBox.height <= 24,
    );
  });

  const previewState = await page.evaluate(() => {
    const stylesheet = document.querySelector("link#vf-tailwind-css") as HTMLLinkElement | null;
    const avatarPath = document.querySelector('svg path[d^="M17.3041"]');
    const avatarSvg = avatarPath?.closest("svg");
    const avatarBox = avatarSvg?.getBoundingClientRect();

    return {
      stylesheetHref: stylesheet?.getAttribute("href") ?? "",
      avatarWidth: avatarBox?.width ?? 0,
      avatarHeight: avatarBox?.height ?? 0,
    };
  });

  assertEquals(
    previewState.stylesheetHref.includes("/_vf_styles/styles.css"),
    true,
  );
  assertEquals(previewState.avatarWidth > 0 && previewState.avatarWidth <= 24, true);
  assertEquals(previewState.avatarHeight > 0 && previewState.avatarHeight <= 24, true);
}

describe(
  "RSC Hydration Browser Tests",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      await cleanupBundler();
    });

    it("hydrates a local-production client page and becomes interactive", async () => {
      const browser = await launchChromium();
      if (!browser) return;

      try {
        await withTestContext("rsc-local-browser-hydration", async (context) => {
          await writeClientCounterApp(
            context.projectDir,
            LOCAL_RSC_CONFIG_SOURCE,
          );

          // Explicitly register the test project as local so the `fs`
          // client-module strategy and the `/_veryfront/fs/` module loader
          // are unlocked. Post-VULN-SRV-1/2 these strictly gate on
          // `isLocalProject`, and the test context writes its sources
          // outside of the `standardProjectDirs` (`data/projects/`,
          // `projects/`) discovery roots.
          const port = await context.allocatePort();
          const controller = new AbortController();
          const server = await startProductionServer({
            projectDir: context.projectDir,
            port,
            bindAddress: "127.0.0.1",
            signal: controller.signal,
            defaultProjectSlug: context.projectId,
            defaultProjectId: context.projectId,
            localProjects: { [context.projectId]: context.projectDir },
          });
          context.trackResource(server);
          await server.ready;
          await registerTailwindExtension();
          await waitForReady(port);

          const browserContext = await browser.newContext();
          const page = await browserContext.newPage();
          const diagnostics = captureBrowserDiagnostics(page);

          try {
            const response = await page.goto(`http://127.0.0.1:${port}/`);
            assertEquals(response?.status(), 200);

            await assertCounterHydration(page, diagnostics, {
              expectedStrategy: "fs",
              expectedModulePath: "/_veryfront/fs/",
            });

            const hydrationErrors = findHydrationOrCspFailures(
              getBrowserDiagnosticMessages(diagnostics),
            );
            assertEquals(hydrationErrors.length, 0);
          } finally {
            await browserContext.close();
          }
        });
      } finally {
        await browser.close();
      }
    });

    it("hydrates a remote-production client page and becomes interactive", async () => {
      const browser = await launchChromium();
      if (!browser) return;

      try {
        await withTestContext("rsc-proxy-browser-hydration", async (context) => {
          await writeClientCounterApp(
            context.projectDir,
            PROXY_MODE_CONFIG_SOURCE,
          );

          await withProxyBrowserPage(
            browser,
            context,
            createProxyBrowserFixture("production"),
            async (page, diagnostics) => {
              await assertCounterHydration(page, diagnostics, {
                expectedStrategy: "rsc-module",
                expectedModulePath: "/_veryfront/rsc/module?",
              });

              const hydrationErrors = findHydrationOrCspFailures(
                getBrowserDiagnosticMessages(diagnostics),
              );
              assertEquals(hydrationErrors.length, 0);
            },
          );
        });
      } finally {
        await browser.close();
      }
    });

    it("hydrates a preview client page and becomes interactive", async () => {
      const browser = await launchChromium();
      if (!browser) return;

      try {
        await withTestContext("rsc-preview-browser-hydration", async (context) => {
          await writeClientCounterApp(
            context.projectDir,
            PROXY_MODE_CONFIG_SOURCE,
          );

          await withProxyBrowserPage(
            browser,
            context,
            createProxyBrowserFixture("preview"),
            async (page, diagnostics) => {
              // Preview pods hydrate via the RSC module endpoint, same as
              // production. The `fs` strategy + `/_veryfront/fs/` module
              // loader are dev-only surfaces gated on `isLocalProject` under
              // VULN-SRV-1/2 — a trusted `x-environment: preview` header
              // cannot unlock them because they serve raw project source.
              await assertCounterHydration(page, diagnostics, {
                expectedStrategy: "rsc-module",
                expectedModulePath: "/_veryfront/rsc/module?",
              });

              const hydrationErrors = findHydrationOrCspFailures(
                getBrowserDiagnosticMessages(diagnostics),
              );
              assertEquals(hydrationErrors.length, 0);
            },
          );
        });
      } finally {
        await browser.close();
      }
    });

    it("keeps preview chat pages styled after hydration", async () => {
      const browser = await launchChromium();
      if (!browser) return;

      try {
        await withTestContext("rsc-preview-chat-browser-styling", async (context) => {
          await writePreviewChatApp(
            context.projectDir,
            PROXY_MODE_CONFIG_SOURCE,
          );

          await withProxyBrowserPage(
            browser,
            context,
            createProxyBrowserFixture("preview"),
            async (page, diagnostics) => {
              await assertPreviewChatStyling(page);

              const hydrationErrors = findHydrationOrCspFailures(
                getBrowserDiagnosticMessages(diagnostics),
              );
              assertEquals(hydrationErrors.length, 0);
            },
          );
        });
      } finally {
        await browser.close();
      }
    });
  },
);
