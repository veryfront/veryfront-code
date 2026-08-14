/**
 * The proxy's own WebSocket bridge hop, judged by the renderer gate that
 * actually answers it.
 *
 * `handleWebSocketUpgrade` terminates the browser socket and opens a second
 * socket to the shared renderer. That second request is the one the renderer's
 * `createProxyGuard` inspects, so these tests build it with the production
 * builder and hand it to the production guard rather than asserting on a
 * header list that could drift from what the guard demands.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { prepareProjectRequest } from "#veryfront/server/runtime-handler/project-runtime-context.ts";
import type { ProxyContext } from "./handler.ts";
import { buildRendererBridgeRequest } from "./websocket-bridge.ts";
import { parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";

/** The internal renderer service. It is not a project domain and carries no slug. */
const RENDERER_SERVER_URL = "http://veryfront-server";

/** Headers a browser sends to the proxy for `wss://<slug>.preview.veryfront.com/_ws`. */
function browserUpgradeHeaders(host: string): Headers {
  return new Headers({
    host,
    upgrade: "websocket",
    connection: "Upgrade",
    "sec-websocket-version": "13",
    "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
  });
}

/** The context the proxy resolved for the browser socket before bridging. */
function previewContext(overrides: Partial<ProxyContext> = {}): ProxyContext {
  const host = "support-agent-agodnc.preview.veryfront.com";
  return {
    token: "vf_proxy_minted_project_token",
    projectSlug: "support-agent-agodnc",
    projectId: "prj_01hzzz",
    environment: "preview",
    contentSourceId: "src_01hzzz",
    host,
    parsedDomain: parseProjectDomain(host),
    isLocalProject: false,
    ...overrides,
  };
}

/** Replay the bridge hop as the renderer receives it. */
function bridgeHopRequest(
  browserRequest: Request,
  context: ProxyContext,
): Request {
  const bridge = buildRendererBridgeRequest(
    browserRequest,
    new URL(browserRequest.url),
    context,
    RENDERER_SERVER_URL,
  );
  const headers = new Headers(bridge.headers);
  // Deno's client adds the handshake fields itself; the identity must survive.
  headers.set("host", new URL(bridge.url).host);
  headers.set("upgrade", "websocket");
  headers.set("connection", "Upgrade");
  headers.set("sec-websocket-version", "13");
  headers.set("sec-websocket-key", "AQIDBAUGBwgJCgsMDQ4PEC==");
  return new Request(bridge.url.toString().replace(/^ws/, "http"), { headers });
}

async function guardVerdict(
  request: Request,
  trusted: boolean,
): Promise<{ detail: string | null; projectSlug: string | undefined }> {
  const prepared = await prepareProjectRequest({
    req: request,
    url: new URL(request.url),
    isProxyMode: true,
    trustProxy: () => Promise.resolve(trusted),
  });
  return {
    detail: prepared.proxyGuard?.detail ?? null,
    projectSlug: prepared.headers.projectSlug,
  };
}

describe("proxy renderer WebSocket bridge identity", () => {
  it("is admitted by the renderer proxy guard", async () => {
    const browserRequest = new Request(
      "https://support-agent-agodnc.preview.veryfront.com/_ws",
      { headers: browserUpgradeHeaders("support-agent-agodnc.preview.veryfront.com") },
    );

    const verdict = await guardVerdict(
      bridgeHopRequest(browserRequest, previewContext()),
      true,
    );

    assertEquals(
      verdict.detail,
      null,
      "the platform's own preview HMR bridge is answered 502 by the renderer",
    );
    assertEquals(verdict.projectSlug, "support-agent-agodnc");
  });

  it("carries the proxy-minted project token the renderer needs upstream", () => {
    const browserRequest = new Request(
      "https://support-agent-agodnc.preview.veryfront.com/_ws",
      { headers: browserUpgradeHeaders("support-agent-agodnc.preview.veryfront.com") },
    );

    const bridge = buildRendererBridgeRequest(
      browserRequest,
      new URL(browserRequest.url),
      previewContext(),
      RENDERER_SERVER_URL,
    );

    assertEquals(bridge.headers.get("x-token"), "vf_proxy_minted_project_token");
    assertEquals(bridge.headers.get("x-project-slug"), "support-agent-agodnc");
    assertEquals(bridge.headers.get("x-environment"), "preview");
  });

  it("never lets the browser's query string name the tenant", async () => {
    // The browser chooses the whole query string of `/_ws`, and the bridge
    // forwards it. Identity must come from the proxy-resolved context only.
    const browserRequest = new Request(
      "https://support-agent-agodnc.preview.veryfront.com/_ws" +
        "?x-project-slug=victim-project&x-environment=production",
      { headers: browserUpgradeHeaders("support-agent-agodnc.preview.veryfront.com") },
    );

    const bridge = buildRendererBridgeRequest(
      browserRequest,
      new URL(browserRequest.url),
      previewContext(),
      RENDERER_SERVER_URL,
    );
    const verdict = await guardVerdict(bridgeHopRequest(browserRequest, previewContext()), true);

    assertEquals(bridge.url.searchParams.get("x-project-slug"), null);
    assertEquals(bridge.url.searchParams.get("x-environment"), null);
    assertEquals(verdict.projectSlug, "support-agent-agodnc");
    assertEquals(verdict.detail, null);
  });

  it("still rejects an unsigned look-alike hop that names itself in the query", async () => {
    // Anything that reaches the renderer directly and mimics the bridge URL
    // without the proxy-supplied identity headers must stay rejected.
    const forged = new Request(
      "http://veryfront-server/_ws?x-project-slug=support-agent-agodnc&x-environment=preview",
      { headers: browserUpgradeHeaders("veryfront-server") },
    );

    const verdict = await guardVerdict(forged, true);

    assertEquals(verdict.detail, "x-project-slug header is required in proxy mode");
    assertEquals(verdict.projectSlug, undefined);
  });

  it("still rejects a bridge-shaped hop with no upstream token", async () => {
    const browserRequest = new Request(
      "https://support-agent-agodnc.preview.veryfront.com/_ws",
      { headers: browserUpgradeHeaders("support-agent-agodnc.preview.veryfront.com") },
    );

    const verdict = await guardVerdict(
      bridgeHopRequest(browserRequest, previewContext({ token: undefined })),
      true,
    );

    assertEquals(verdict.detail, "x-token header is required in proxy mode");
  });

  it("still rejects the bridge hop when the proxy boundary is not operator-trusted", async () => {
    const browserRequest = new Request(
      "https://support-agent-agodnc.preview.veryfront.com/_ws",
      { headers: browserUpgradeHeaders("support-agent-agodnc.preview.veryfront.com") },
    );

    const verdict = await guardVerdict(
      bridgeHopRequest(browserRequest, previewContext({ projectId: "prj_01hzzz" })),
      false,
    );

    assert(verdict.detail !== null, "an untrusted boundary must not be admitted");
    assertEquals(
      verdict.detail,
      "project, environment, and branch identity headers require an operator-authenticated proxy boundary",
    );
  });
});
