import "#veryfront/schemas/_test-setup.ts";
import { JSDOM, VirtualConsole } from "npm:jsdom@28.0.0";
import { PROJECT_STYLESHEET_IDS } from "#veryfront/html";
import { waitFor } from "#veryfront/testing";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getHMRScript } from "./hmr-scripts.ts";

interface FakeSocket {
  onmessage: ((event: { data: string }) => void) | null;
}

interface HMRDom {
  dom: JSDOM;
  sockets: FakeSocket[];
  /** Debug log lines emitted by the HMR client (VERYFRONT_DEBUG_HMR is enabled). */
  logs: string[];
  reloadCount(): number;
  send(message: Record<string, unknown>): void;
}

/**
 * Boots the HMR client inside a JSDOM window with a fake WebSocket.
 * jsdom's Location.reload is unforgeable, so reloads are observed through the
 * client's own "[HMR] Reloading page:" debug log line instead.
 */
function createHMRDom(html: string): HMRDom {
  const sockets: FakeSocket[] = [];
  const logs: string[] = [];

  class FakeWebSocket implements FakeSocket {
    static readonly OPEN = 1;
    readonly readyState = 0;
    onmessage: ((event: { data: string }) => void) | null = null;

    constructor(_url: string) {
      sockets.push(this);
    }

    close(): void {}
    send(_data: string): void {}
  }

  const virtualConsole = new VirtualConsole();
  virtualConsole.on("log", (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });

  const dom = new JSDOM(html, {
    url: "http://localhost/",
    runScripts: "dangerously",
    virtualConsole,
  });
  dom.window.localStorage.setItem("VERYFRONT_DEBUG_HMR", "1");
  Object.defineProperty(dom.window, "WebSocket", {
    configurable: true,
    value: FakeWebSocket,
  });

  return {
    dom,
    sockets,
    logs,
    reloadCount: () => logs.filter((line) => line.startsWith("[HMR] Reloading page:")).length,
    send(message) {
      const socket = sockets[0];
      assertExists(socket, "the HMR client must open a WebSocket on boot");
      assertExists(socket.onmessage, "the HMR client must install an onmessage handler");
      socket.onmessage({ data: JSON.stringify(message) });
    },
  };
}

describe("server/handlers/dev/scripts/hmr-scripts", () => {
  it("atomically swaps the preview stylesheet when a hashed asset is ready", () => {
    const script = getHMRScript(3000);
    assertStringIncludes(script, "async function swapProjectStylesheet(nextHref)");
    assertStringIncludes(script, "pending.setAttribute('data-vf-stylesheet-pending', 'true');");
    assertStringIncludes(script, "pending.removeAttribute('data-vf-stylesheet-pending');");
    assertStringIncludes(script, "pending.id = current.id;");
    assertStringIncludes(script, "current.remove();");
  });

  it("serializes overlapping stylesheet swaps without duplicate live ids", async () => {
    const harness = createHMRDom(
      '<!doctype html><html><head><link id="vf-project-css" rel="stylesheet" href="/styles/original.css"></head><body></body></html>',
    );
    const { dom } = harness;

    try {
      dom.window.eval(getHMRScript(3000));

      harness.send({
        type: "update",
        path: "styles/first.css",
        styleHref: "/styles/first.css",
      });
      harness.send({
        type: "update",
        path: "styles/second.css",
        styleHref: "/styles/second.css",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const firstPending = dom.window.document.querySelector<HTMLLinkElement>(
        'link[data-vf-stylesheet-pending="true"]',
      );
      assertExists(firstPending);
      assertEquals(firstPending.getAttribute("href"), "/styles/first.css");
      assertEquals(dom.window.document.querySelectorAll('link[rel="stylesheet"]').length, 2);

      firstPending.dispatchEvent(new dom.window.Event("load"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const secondPending = dom.window.document.querySelector<HTMLLinkElement>(
        'link[data-vf-stylesheet-pending="true"]',
      );
      assertExists(secondPending);
      assertEquals(secondPending.getAttribute("href"), "/styles/second.css");
      assertEquals(dom.window.document.querySelectorAll('link[rel="stylesheet"]').length, 2);

      secondPending.dispatchEvent(new dom.window.Event("load"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const stylesheets = dom.window.document.querySelectorAll<HTMLLinkElement>(
        'link[rel="stylesheet"]',
      );
      assertEquals(stylesheets.length, 1);
      assertEquals(stylesheets[0]?.id, "vf-project-css");
      assertEquals(stylesheets[0]?.getAttribute("href"), "/styles/second.css");
      assertEquals(
        harness.reloadCount(),
        0,
        "a successful CSS hot-swap must never reload the page",
      );
    } finally {
      dom.window.close();
    }
  });

  it("supports both current and legacy preview stylesheet ids", () => {
    const script = getHMRScript(3000);
    assertStringIncludes(
      script,
      `const PROJECT_STYLESHEET_IDS = ${JSON.stringify(PROJECT_STYLESHEET_IDS)};`,
    );
    assertStringIncludes(script, "getProjectStylesheet()");
    assertStringIncludes(script, "document.getElementById(id)");
  });

  it("falls back to full reload when CSS hot-swap cannot find a stylesheet", async () => {
    const script = getHMRScript(3000);
    assertStringIncludes(
      script,
      "const didRefresh = await applyStyleUpdate(update.path, update.styleHref);",
    );
    assertStringIncludes(script, "notifyStudioAndReload('css-update-no-stylesheet');");

    const harness = createHMRDom("<!doctype html><html><head></head><body></body></html>");
    const { dom } = harness;

    try {
      dom.window.eval(script);
      harness.send({ type: "update", path: "styles/x.css", styleHref: "/styles/x.css" });
      await waitFor(() => harness.reloadCount() > 0, {
        message: "the CSS update never triggered a reload",
      });
      assertEquals(
        harness.reloadCount(),
        1,
        "a CSS update with no stylesheet to swap must fall back to a full reload",
      );
      assertEquals(
        harness.logs.includes("[HMR] Reloading page: css-update-no-stylesheet"),
        true,
        "the reload must be attributed to the missing stylesheet",
      );
    } finally {
      dom.window.close();
    }
  });

  it("threads the latest stylesheet href through batched JS updates", async () => {
    const script = getHMRScript(3000);
    assertStringIncludes(script, "let pendingStyleHref = null;");
    assertStringIncludes(script, "if (typeof update.styleHref === 'string') {");
    assertStringIncludes(script, "await updateJS(paths[0], styleHref);");

    const harness = createHMRDom(
      '<!doctype html><html><head><link id="vf-project-css" rel="stylesheet" href="/styles/original.css"></head><body></body></html>',
    );
    const { dom } = harness;

    try {
      (dom.window as unknown as { __veryfrontRenderPage: () => Promise<void> })
        .__veryfrontRenderPage = () => Promise.resolve();
      dom.window.eval(script);

      harness.send({ type: "update", path: "app/a.tsx", styleHref: "/styles/first.css" });
      harness.send({ type: "update", path: "app/b.tsx", styleHref: "/styles/second.css" });

      await waitFor(
        () => dom.window.document.querySelector('link[data-vf-stylesheet-pending="true"]') !== null,
        { message: "the batched JS update never started a stylesheet swap" },
      );
      const pending = dom.window.document.querySelector<HTMLLinkElement>(
        'link[data-vf-stylesheet-pending="true"]',
      );
      assertExists(pending);
      pending.dispatchEvent(new dom.window.Event("load"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      assertEquals(
        dom.window.document.querySelector("#vf-project-css")?.getAttribute("href"),
        "/styles/second.css",
        "a batched JS update must swap in the newest styleHref",
      );
      assertEquals(harness.reloadCount(), 0, "a batched JS update with a renderer must not reload");
    } finally {
      dom.window.close();
    }
  });

  it("responds to server ping keepalive messages", () => {
    const script = getHMRScript(3000);
    assertStringIncludes(script, "case 'ping':");
    assertStringIncludes(script, "type: 'pong'");
  });

  it("does not report routine page reloads as browser warnings", () => {
    const script = getHMRScript(3000);
    assertStringIncludes(script, "dlog('[HMR] Reloading page:', reason);");
    assertStringIncludes(script, "dlog('[HMR] Updating JS module:', path);");
    assertStringIncludes(script, "dlog('[HMR] Project stylesheet refreshed');");
    assertEquals(script.includes("console.warn('[HMR] Reloading page:'"), false);
    assertEquals(script.includes("console.log('[HMR] Reloading page:'"), false);
    assertEquals(script.includes("console.log('[HMR] Updating JS module:'"), false);
    assertEquals(script.includes("console.log('[HMR] Project stylesheet refreshed'"), false);
  });

  it("targets Studio notifications at a validated parent origin", () => {
    const script = getHMRScript(3000);
    assertStringIncludes(script, "function vfStudioTargetOrigin()");
    assertStringIncludes(
      script,
      "}, vfStudioTargetOrigin());",
      "initial-load Studio notification must target the validated origin",
    );
    assertStringIncludes(
      script,
      "vfStudioTargetOrigin(),",
      "notifyStudio must target the validated origin",
    );
    assertEquals(
      (script.match(/postMessage\(/g) ?? []).length,
      2,
      "every parent postMessage call site must be individually pinned to vfStudioTargetOrigin()",
    );
    assertStringIncludes(script, '"https://veryfront.com"');
    assertEquals(script.includes('"https://studio.veryfront.com"'), false);
    assertEquals(script.includes("endsWith('.veryfront"), false);
    assertEquals(
      /postMessage\([\s\S]*?,\s*['"]\*['"]\s*\)/.test(script),
      false,
      "the HMR client must never broadcast to a wildcard target origin",
    );
  });
});
