import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  captureBrowserDiagnostics,
  closeChromium,
  launchChromium,
  navigateBrowserPage,
} from "../_helpers/playwright.ts";

describe("compiled binary browser navigation diagnostics", () => {
  it("retains pending module, document and server evidence when load times out", async () => {
    let releaseModule: (response: Response) => void = () => {};
    const moduleResponse = new Promise<Response>((resolve) => releaseModule = resolve);
    const browser = await launchChromium();
    if (!browser) throw new Error("This integration test requires Chromium");
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen() {} },
      (request) =>
        new URL(request.url).pathname === "/blocked-module.js" ? moduleResponse : new Response(
          '<html><body>waiting<script type="module" src="/blocked-module.js"></script></body></html>',
          {
            headers: { "content-type": "text/html" },
          },
        ),
    );
    const url = `http://127.0.0.1:${server.addr.port}/`;
    try {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(250);
      const error = await assertRejects(() =>
        navigateBrowserPage(page, url, captureBrowserDiagnostics(page), [
          "synthetic server is ready",
        ])
      );
      if (!(error instanceof Error)) throw error;
      assertStringIncludes(error.message, "Timeout");
      assertStringIncludes(error.message, `${url}blocked-module.js`);
      assertStringIncludes(error.message, '"readyState": "interactive"');
      assertStringIncludes(error.message, "synthetic server is ready");
      assertStringIncludes(error.message, '"status": 200');
      assertStringIncludes(String(error.cause), "Timeout");
    } finally {
      releaseModule(new Response("export {};", { headers: { "content-type": "text/javascript" } }));
      await closeChromium(browser);
      await server.shutdown();
    }
  });

  it("preserves a successful response and browser feature assertions", async () => {
    const browser = await launchChromium();
    if (!browser) throw new Error("This integration test requires Chromium");
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen() {} },
      () =>
        new Response(
          '<html><body><button id="counter" onclick="this.textContent=\'1\'">0</button></body></html>',
          {
            headers: { "content-type": "text/html" },
          },
        ),
    );
    try {
      const page = await browser.newPage();
      const response = await navigateBrowserPage(
        page,
        `http://127.0.0.1:${server.addr.port}/`,
        captureBrowserDiagnostics(page),
        [],
      );
      assertEquals(response?.status(), 200);
      await page.click("#counter");
      assertEquals(await page.textContent("#counter"), "1");
    } finally {
      await closeChromium(browser);
      await server.shutdown();
    }
  });
});
