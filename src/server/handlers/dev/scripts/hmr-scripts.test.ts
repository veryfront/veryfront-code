import "#veryfront/schemas/_test-setup.ts";
import { JSDOM } from "npm:jsdom@28.0.0";
import { PROJECT_STYLESHEET_IDS } from "#veryfront/html";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getHMRScript } from "./hmr-scripts.ts";

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
    const sockets: FakeWebSocket[] = [];

    class FakeWebSocket {
      static readonly OPEN = 1;
      readonly readyState = 0;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(_url: string) {
        sockets.push(this);
      }

      close(): void {}
      send(_data: string): void {}
    }

    const dom = new JSDOM(
      '<!doctype html><html><head><link id="vf-project-css" rel="stylesheet" href="/styles/original.css"></head><body></body></html>',
      { url: "http://localhost/", runScripts: "dangerously" },
    );

    try {
      Object.defineProperty(dom.window, "WebSocket", {
        configurable: true,
        value: FakeWebSocket,
      });
      dom.window.eval(getHMRScript(3000));

      const socket = sockets[0];
      assertExists(socket);
      assertExists(socket.onmessage);
      socket.onmessage({
        data: JSON.stringify({
          type: "update",
          path: "styles/first.css",
          styleHref: "/styles/first.css",
        }),
      });
      socket.onmessage({
        data: JSON.stringify({
          type: "update",
          path: "styles/second.css",
          styleHref: "/styles/second.css",
        }),
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

  it("falls back to full reload when CSS hot-swap cannot find a stylesheet", () => {
    const script = getHMRScript(3000);
    assertStringIncludes(
      script,
      "const didRefresh = await applyStyleUpdate(update.path, update.styleHref);",
    );
    assertStringIncludes(script, "notifyStudioAndReload('css-update-no-stylesheet');");
  });

  it("threads the latest stylesheet href through batched JS updates", () => {
    const script = getHMRScript(3000);
    assertStringIncludes(script, "let pendingStyleHref = null;");
    assertStringIncludes(script, "if (typeof update.styleHref === 'string') {");
    assertStringIncludes(script, "await updateJS(paths[0], styleHref);");
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
    assertStringIncludes(script, "vfStudioTargetOrigin(),");
    assertStringIncludes(script, '"https://veryfront.com"');
    assertEquals(script.includes('"https://studio.veryfront.com"'), false);
    assertEquals(script.includes("endsWith('.veryfront"), false);
    assertEquals(script.includes("}, '*')"), false);
  });
});
