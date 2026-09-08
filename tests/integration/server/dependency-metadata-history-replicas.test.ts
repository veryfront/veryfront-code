import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { getDevScripts } from "#veryfront/html/hydration-script-builder/dev-scripts.ts";
import {
  generateProdHydrationModule,
  getProdScriptsForPath,
} from "#veryfront/html/hydration-script-builder/prod-scripts.ts";
import { fileURLToPath } from "node:url";
import { PROVIDER_EGRESS_DENY_NET } from "../../../scripts/test/suites.ts";
import {
  captureBrowserDiagnostics,
  closeChromium,
  getBrowserDiagnosticMessages,
  launchChromium,
} from "../../_helpers/playwright.ts";

interface Replica {
  origin: string;
  pid: number;
}

interface ReplicaHarness {
  writebacks(): number;
  startReplica(): Promise<Replica>;
  request(
    origin: string,
    path: string,
  ): Promise<{ status: number; body: string }>;
  close(): Promise<void>;
}

type HydrationStyle = "inline preview" | "external production";

const PROD_RUNTIME_PATH = "/_veryfront/hydration-runtime.1a2b3c4d.js";

const REACT_MODULE = `
const contexts = new WeakMap();
export class Component {}
export const Children = { toArray(value) { return Array.isArray(value) ? value : [value]; } };
export function createElement(type, props, ...children) {
  return { type, props: props || {}, children };
}
export function createContext(value) {
  const context = { value, Provider: function Provider({ children }) { return children; } };
  contexts.set(context, value);
  return context;
}
export function useContext(context) { return contexts.get(context) ?? context.value ?? null; }
export function isValidElement(value) { return Boolean(value && value.type); }
const React = { Component, Children, createElement, createContext, useContext, isValidElement };
export default React;
`;

const REACT_DOM_CLIENT_MODULE = `
function markHydrated() {
  document.documentElement.dataset.hydrated = "yes";
  return { render: markHydrated };
}
export function createRoot() { return { render: markHydrated }; }
export function hydrateRoot() { return markHydrated(); }
`;

const ROUTER_MODULE = `
const store = {
  subscribe() { return () => {}; },
  getHref() { return location.pathname + location.search + location.hash; },
  notify() {},
  navigate(href) { location.assign(href); return Promise.resolve(); },
  setNavigator() {},
};
export function getNavigationStore() { return store; }
export function RouterProvider({ children }) { return children; }
export function useRouter() { return {}; }
`;

const CONTEXT_MODULE = `
export function PageContextProvider({ children }) { return children; }
`;

const PAGE_MODULE = `
import { useServerRenderContext } from "/historical-framework.js";
globalThis.__historicalFrameworkLoaded = typeof useServerRenderContext === "function";
export default function Page() { return null; }
`;

function javascript(source: string, status = 200): Response {
  return new Response(source, {
    status,
    headers: { "content-type": "application/javascript; charset=utf-8" },
  });
}

function scriptsFor(style: HydrationStyle): string {
  if (style === "external production") {
    return getProdScriptsForPath(PROD_RUNTIME_PATH);
  }
  return getDevScripts(
    "dependency-metadata-history",
    { dev: { hmr: false } } as VeryfrontConfig,
    undefined,
    undefined,
    undefined,
    { skipDevHMR: true, skipErrorLogger: true, skipDevFlag: true },
  );
}

function hydrationDocument(style: HydrationStyle, key: string): string {
  return `<!doctype html>
<html data-document-snapshot="${key}">
  <head>
    <script type="importmap">{"imports":{
      "react":"/react.js",
      "react-dom/client":"/react-dom-client.js",
      "veryfront/router":"/router.js",
      "veryfront/context":"/context.js"
    }}</script>
  </head>
  <body>
    <div id="root">Historical snapshot page</div>
    <script id="veryfront-hydration-data" type="application/json">{
      "pagePath":"pages/index.tsx",
      "params":{},
      "props":{},
      "dependencyPinningCacheKey":"${key}"
    }</script>
    ${scriptsFor(style)}
  </body>
</html>`;
}

function createReplicaHarness(): ReplicaHarness {
  let content = '{"dependencies":{}}';
  let version = 1000;
  let writebackCount = 0;
  const history: Array<
    { dependencies: Record<string, string>; expiresAt: number }
  > = [];
  const shared = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/metadata-history") {
        return Response.json({
          version: 1,
          projectId: "synthetic-project",
          branch: null,
          entries: history,
        });
      }
      if (path !== "/metadata") return new Response(null, { status: 404 });
      if (request.method === "POST") {
        const values = await request.json();
        if (JSON.stringify(values) !== '["react"]') {
          return new Response(null, { status: 400 });
        }
        // Model the API's acknowledged preimage before the source changes.
        history.push({
          dependencies: JSON.parse(content).dependencies,
          expiresAt: Date.now() + 60_000,
        });
        content = '{"dependencies":{"react":"19.2.4"}}';
        version++;
        writebackCount++;
      }
      return Response.json({ content, version });
    },
  );
  const children: Deno.ChildProcess[] = [];
  const streams: Promise<unknown>[] = [];

  async function startReplica(): Promise<Replica> {
    const child = new Deno.Command(Deno.execPath(), {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      args: [
        "run",
        "--allow-all",
        PROVIDER_EGRESS_DENY_NET,
        "--config",
        fileURLToPath(new URL("../../../deno.json", import.meta.url)),
        fileURLToPath(
          new URL(
            "./fixtures/dependency-metadata-history-replica.ts",
            import.meta.url,
          ),
        ),
        `http://127.0.0.1:${shared.addr.port}`,
      ],
      clearEnv: true,
      env: {
        PATH: Deno.env.get("PATH") ?? "",
        VERYFRONT_DEPENDENCY_PINNING: "1",
        VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT: "100",
        VF_DISABLE_LRU_INTERVAL: "1",
        SENTRY_ENABLED: "false",
        LOG_LEVEL: "error",
        ...(Deno.env.get("DENO_DIR")
          ? { DENO_DIR: Deno.env.get("DENO_DIR")! }
          : {}),
      },
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    children.push(child);
    streams.push(child.stderr.pipeTo(new WritableStream({ write() {} })));
    const reader = child.stdout.getReader();
    const deadline = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch { /* Exited. */ }
    }, 30_000);
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) throw new Error("Replica exited before ready");
        buffer += new TextDecoder().decode(value);
        if (buffer.length > 65_536) {
          throw new Error("Replica readiness output exceeded its limit");
        }
        for (const line of buffer.split("\n").slice(0, -1)) {
          let ready: { port?: unknown };
          try {
            ready = JSON.parse(line);
          } catch {
            continue;
          }
          if (Number.isInteger(ready.port)) {
            return { origin: `http://127.0.0.1:${ready.port}`, pid: child.pid };
          }
        }
      }
    } finally {
      clearTimeout(deadline);
      reader.releaseLock();
      streams.push(child.stdout.pipeTo(new WritableStream({ write() {} })));
    }
  }

  async function request(
    origin: string,
    path: string,
  ): Promise<{ status: number; body: string }> {
    const response = await fetch(origin + path, {
      signal: AbortSignal.timeout(30_000),
    });
    return { status: response.status, body: await response.text() };
  }

  return {
    writebacks: () => writebackCount,
    startReplica,
    request,
    async close() {
      for (const child of children) {
        try {
          child.kill("SIGTERM");
        } catch { /* Already exited. */ }
      }
      await Promise.all(children.map((child) => child.status));
      await Promise.all(streams);
      await shared.shutdown();
    },
  };
}

async function prepareColdHistoricalReplica(harness: ReplicaHarness): Promise<{
  originalKey: string;
  currentKey: string;
  cold: Replica;
}> {
  const warm = await harness.startReplica();
  const document = await harness.request(warm.origin, "/document");
  assertEquals(document.status, 200);
  const originalKey = JSON.parse(document.body).key as string;
  assertEquals(
    (await harness.request(
      warm.origin,
      `/module?key=${encodeURIComponent(originalKey)}`,
    ))
      .status,
    200,
  );
  assertEquals((await harness.request(warm.origin, "/writeback")).status, 200);
  const cold = await harness.startReplica();
  assertEquals(cold.pid === warm.pid, false);
  const current = await harness.request(cold.origin, "/document");
  assertEquals(current.status, 200);
  return {
    originalKey,
    currentKey: JSON.parse(current.body).key as string,
    cold,
  };
}

async function verifyBrowserHydration(style: HydrationStyle): Promise<void> {
  const harness = createReplicaHarness();
  let pageServer: ReturnType<typeof Deno.serve> | undefined;
  const browser = await launchChromium();
  assertExists(
    browser,
    "This integration test requires the installed Playwright Chromium browser",
  );

  try {
    const { originalKey, currentKey, cold } =
      await prepareColdHistoricalReplica(harness);
    assertEquals(currentKey === originalKey, false);
    assertEquals(harness.writebacks(), 1);

    const requestedModuleUrls: string[] = [];
    let documentRequests = 0;
    let historicalLeafRequests = 0;
    pageServer = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen() {} },
      async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/") {
          documentRequests++;
          return new Response(hydrationDocument(style, originalKey), {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        if (url.pathname === PROD_RUNTIME_PATH) {
          return javascript(generateProdHydrationModule());
        }
        if (url.pathname === "/react.js") return javascript(REACT_MODULE);
        if (url.pathname === "/react-dom-client.js") {
          return javascript(REACT_DOM_CLIENT_MODULE);
        }
        if (url.pathname === "/router.js") return javascript(ROUTER_MODULE);
        if (url.pathname === "/context.js") return javascript(CONTEXT_MODULE);
        if (url.pathname === "/historical-framework.js") {
          historicalLeafRequests++;
          const result = await harness.request(
            cold.origin,
            `/module?key=${encodeURIComponent(originalKey)}`,
          );
          return javascript(result.body, result.status);
        }
        if (url.pathname.startsWith("/_vf_modules/")) {
          requestedModuleUrls.push(url.href);
          return javascript(PAGE_MODULE);
        }
        return new Response("Not found", { status: 404 });
      },
    );

    const context = await browser.newContext();
    await context.route("https://esm.sh/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript; charset=utf-8",
        body: REACT_MODULE,
      });
    });
    const page = await context.newPage();
    const diagnostics = captureBrowserDiagnostics(page);
    const { port } = pageServer.addr as Deno.NetAddr;
    const response = await page.goto(`http://127.0.0.1:${port}/`);
    assertEquals(response?.status(), 200);
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.hydrated === "yes" &&
        Reflect.get(globalThis, "__historicalFrameworkLoaded") === true &&
        typeof Reflect.get(globalThis, "__veryfrontRenderPage") === "function",
      undefined,
      { timeout: 5_000 },
    );
    await page.waitForLoadState("networkidle");

    assertEquals(
      documentRequests,
      1,
      "historical module hydration must not reload the document",
    );
    assertEquals(historicalLeafRequests, 1);
    assert(requestedModuleUrls.length > 0);
    assertEquals(
      requestedModuleUrls.every((url) => {
        const match = new URL(url).pathname.match(
          /^\/_vf_modules\/_pins\/([^/]+)\//,
        );
        return match !== null && decodeURIComponent(match[1]!) === originalKey;
      }),
      true,
      "the browser module graph must stay bound to the original document key",
    );
    assertEquals(
      requestedModuleUrls.some((url) =>
        url.includes(encodeURIComponent(currentKey))
      ),
      false,
      "the current dependency key must not mix into the historical document graph",
    );
    assertEquals(getBrowserDiagnosticMessages(diagnostics), []);
    await context.close();
  } finally {
    await closeChromium(browser);
    if (pageServer) {
      await pageServer.shutdown();
      await pageServer.finished;
    }
    await harness.close();
  }
}

describe("API-derived dependency metadata across renderer processes", () => {
  it("hydrates the original module on warm, cold, and replacement replicas", async () => {
    const harness = createReplicaHarness();
    try {
      const warm = await harness.startReplica();
      const document = await harness.request(warm.origin, "/document");
      assertEquals(document.status, 200);
      const key = JSON.parse(document.body).key;
      assertEquals(key, "on:54uvgwr2ih7p");
      assertEquals(
        (await harness.request(
          warm.origin,
          `/module?key=${encodeURIComponent(key)}`,
        )).status,
        200,
      );
      assertEquals(
        (await harness.request(warm.origin, "/writeback")).status,
        200,
      );
      assertEquals(harness.writebacks(), 1);
      const cold = await harness.startReplica();
      assertEquals(cold.pid === warm.pid, false);
      for (const replica of [warm, cold]) {
        const module = await harness.request(
          replica.origin,
          `/module?key=${encodeURIComponent(key)}`,
        );
        assertEquals(module.status, 200);
        assertStringIncludes(module.body, "useServerRenderContext");
      }
      const authority = await harness.request(
        cold.origin,
        `/authority?key=${encodeURIComponent(key)}`,
      );
      assertEquals(
        JSON.parse(authority.body).current,
        false,
        "history cannot authorize writeback",
      );
      const replacement = await harness.startReplica();
      assertEquals(
        (await harness.request(
          replacement.origin,
          `/module?key=${encodeURIComponent(key)}`,
        ))
          .status,
        200,
      );
      const current = await harness.request(cold.origin, "/document");
      assertEquals(current.status, 200);
      assertEquals(JSON.parse(current.body).key === key, false);
    } finally {
      await harness.close();
    }
  });

  for (const style of ["inline preview", "external production"] as const) {
    it(`hydrates the old-key graph in Chromium with the ${style} runtime`, async () => {
      await verifyBrowserHydration(style);
    });
  }
});
