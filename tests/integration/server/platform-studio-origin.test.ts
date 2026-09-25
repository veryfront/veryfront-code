import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const root = "verified-0924.127.0.0.1.sslip.io";
const origin = `https://${root}:58443`;

async function runWithOperatorOrigin<T = Record<string, unknown>>(code: string): Promise<T> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["eval", "--no-check", code],
    cwd: Deno.cwd(),
    env: { PLATFORM_DOMAIN_SUFFIXES: root, PLATFORM_STUDIO_ORIGIN: origin },
  }).output();
  assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
  return JSON.parse(new TextDecoder().decode(result.stdout)) as T;
}

function frameAncestors(policy: string): string[] {
  const directive = policy.split(";").map((part) => part.trim()).find((part) =>
    part.startsWith("frame-ancestors ")
  );
  return directive?.split(/\s+/).slice(1) ?? [];
}

describe("host-owned Studio origin", () => {
  it("captures the operator origin before later host environment changes", async () => {
    const observed = await runWithOperatorOrigin(`
      import { buildCSP } from "#veryfront/security/http/response/security-handler.ts";
      const first = buildCSP(false, "n", null, undefined, true);
      Deno.env.set("PLATFORM_STUDIO_ORIGIN", "https://evil.example.test");
      const second = buildCSP(false, "n", null, undefined, true);
      console.log(JSON.stringify({first, second}));
    `);
    assertEquals(observed.first, observed.second);
  });

  it("adds only the exact operator origin to managed pages", async () => {
    const observed = await runWithOperatorOrigin(`
      import { buildCSP } from "#veryfront/security/http/response/security-handler.ts";
      console.log(JSON.stringify({
        managed: buildCSP(false, "n", null, undefined, true),
        managedWithProjectEnv: buildCSP(false, "n", null,
          {env: {get: (key) => key === "PLATFORM_STUDIO_ORIGIN"
            ? "https://evil.example.test" : undefined}}, true),
        custom: buildCSP(false, "n", null, undefined, false),
      }));
    `);
    assertEquals(frameAncestors(observed.managed as string), [
      "'self'",
      "https://veryfront.com",
      "https://veryfront.org",
      origin,
    ]);
    assertEquals(frameAncestors(observed.custom as string), ["'none'"]);
    assertEquals(observed.managedWithProjectEnv, observed.managed);
  });

  it("serves a bridge script bound to the same host-owned Studio origin", async () => {
    const observed = await runWithOperatorOrigin(`
      import { StudioBridgeModulesHandler } from "#veryfront/server/handlers/studio/bridge-modules.handler.ts";
      const result = await new StudioBridgeModulesHandler().handle(
        new Request("https://app.preview.example.test/_veryfront/studio-bridge.js"), {});
      const script = await result.response.text();
      const resolve = new Function(
        "window", "globalThis", script + "\\nreturn resolveTrustedStudioOrigin;",
      )({location: {search: ""}}, {__VF_BRIDGE_CONFIG__: {debugSkipInit: true}});
      const origin = ${JSON.stringify(origin)};
      console.log(JSON.stringify({
        status: result.response.status,
        hasOrigin: script.includes(JSON.stringify(origin)),
        hasMarker: script.includes("__VF_OPERATOR_STUDIO_ORIGIN__"),
        hasEvil: script.includes("https://evil.example.test"),
        exactAccepted: resolve(origin) === origin,
        tenantRefused: resolve("https://app.preview.${root}:58443") === null,
        wrongPortRefused: resolve("https://${root}:58444") === null,
      }));
    `);
    assertEquals(observed, {
      status: 200,
      hasOrigin: true,
      hasMarker: false,
      hasEvil: false,
      exactAccepted: true,
      tenantRefused: true,
      wrongPortRefused: true,
    });
  });

  it("delivers preview HMR and error-page messages to the operator Studio parent", async () => {
    const observed = await runWithOperatorOrigin<
      Array<{
        action: string;
        targetOrigin: string;
        initial: boolean;
      }>
    >(`
      import { JSDOM } from "npm:jsdom@28.0.0";
      import { getPreviewHMRScript } from "#veryfront/server/handlers/dev/scripts/hmr-scripts.ts";
      import { generateErrorHtml } from "#veryfront/server/utils/error-html.ts";
      const calls = [];
      const preview = "https://app.preview.${root}:58443/page";
      const studio = ${JSON.stringify(origin)};
      const options = {
        url: preview,
        referrer: studio + "/project",
        runScripts: "dangerously",
        beforeParse(window) {
          Object.defineProperty(window, "parent", {
            configurable: true,
            value: {postMessage(message, targetOrigin) {
              calls.push({action: message.action, targetOrigin,
                initial: message.isInitialLoad === true});
            }},
          });
        },
      };
      const dom = new JSDOM(
        '<!doctype html><link rel="stylesheet" href="/styles.css">', options);
      class FakeWebSocket {
        constructor() { FakeWebSocket.instance = this; }
        close() {}
        send() {}
      }
      dom.window.WebSocket = FakeWebSocket;
      dom.window.eval(getPreviewHMRScript());
      FakeWebSocket.instance.onmessage({data: JSON.stringify({
        type: "update", path: "styles.css",
      })});
      await new Promise((resolve) => setTimeout(resolve, 0));
      dom.window.close();

      const errorHtml = generateErrorHtml({
        statusCode: 500, title: "Error", message: "failure",
      });
      const errorDom = new JSDOM(errorHtml, options);
      errorDom.window.close();
      console.log(JSON.stringify(calls));
    `);
    assertEquals(observed, [
      { action: "appUpdated", targetOrigin: origin, initial: true },
      { action: "appUpdated", targetOrigin: origin, initial: false },
      { action: "appUpdated", targetOrigin: origin, initial: true },
    ]);
  });
});
