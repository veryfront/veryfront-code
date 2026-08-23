import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  captureBrowserDiagnostics,
  closeChromium,
  getBrowserDiagnosticMessages,
  launchChromium,
} from "../../_helpers/playwright.ts";
import {
  DEV_UI_BROWSER_BUNDLE,
  DEV_UI_BROWSER_BUNDLE_SHA256,
} from "../../../extensions/ext-dev-ui-react/src/dev-ui-bundle.generated.ts";
import {
  DEV_UI_STYLES,
  DEV_UI_STYLES_SHA256,
} from "../../../extensions/ext-dev-ui-react/src/dev-ui-styles.generated.ts";

const MAX_PRODUCTION_BUNDLE_BYTES = 512 * 1024;
const STYLE_IDENTITY_ATTRIBUTE = "data-veryfront-dev-ui-styles";

Deno.test("generated Dev UI bundle is self-contained and reproducibly identified", async () => {
  assert(DEV_UI_BROWSER_BUNDLE.length > 0);
  assert(
    new TextEncoder().encode(DEV_UI_BROWSER_BUNDLE).byteLength <=
      MAX_PRODUCTION_BUNDLE_BYTES,
  );
  assertFalse(/\besm\.sh\b/i.test(DEV_UI_BROWSER_BUNDLE));
  assertFalse(/(?:^|[;}])\s*import\s*(?:[({*]|[\w$])/m.test(DEV_UI_BROWSER_BUNDLE));
  assertFalse(
    /\b(?:react(?:-jsx-runtime)?|react-dom(?:-client)?|scheduler)\.development\.js\b/i
      .test(DEV_UI_BROWSER_BUNDLE),
  );
  assert(DEV_UI_BROWSER_BUNDLE.includes(STYLE_IDENTITY_ATTRIBUTE));
  assert(DEV_UI_BROWSER_BUNDLE.includes(".bg-vf-bg"));
  assert(DEV_UI_BROWSER_BUNDLE.includes(".border-blue-200"));

  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(DEV_UI_BROWSER_BUNDLE)),
  ).toHex();
  assertEquals(digest, DEV_UI_BROWSER_BUNDLE_SHA256);

  const styleDigest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(DEV_UI_STYLES)),
  ).toHex();
  assertEquals(styleDigest, DEV_UI_STYLES_SHA256);
});

function shell(kind: "dashboard" | "projects"): string {
  return `<!doctype html>
<html data-veryfront-dev-ui="${kind}">
  <body><div id="root"></div><script type="module" src="/dev-ui.js"></script></body>
</html>`;
}

Deno.test("one offline bundle mounts both shells without external requests", async () => {
  const browser = await launchChromium();
  if (!browser) return;

  const context = await browser.newContext();
  const unexpectedRequests: string[] = [];
  let projectsRequestCount = 0;
  try {
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://localhost") {
        unexpectedRequests.push(url.href);
        await route.abort();
        return;
      }
      if (url.pathname === "/dashboard" || url.pathname === "/projects") {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: shell(url.pathname === "/dashboard" ? "dashboard" : "projects"),
        });
        return;
      }
      if (url.pathname === "/dev-ui.js") {
        await route.fulfill({
          status: 200,
          contentType: "text/javascript; charset=utf-8",
          body: DEV_UI_BROWSER_BUNDLE,
        });
        return;
      }
      if (url.pathname === "/_projects/api/config") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ domain: "localhost", port: "", hasToken: false }),
        });
        return;
      }
      if (url.pathname === "/_vf/api/projects") {
        projectsRequestCount += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [] }),
        });
        return;
      }
      if (url.pathname.startsWith("/_dev/api/")) {
        const key = url.pathname.slice("/_dev/api/".length);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ [key]: [] }),
        });
        return;
      }
      unexpectedRequests.push(url.href);
      await route.abort();
    });

    for (
      const [path, visibleText] of [
        ["/dashboard", "Dev"],
        ["/projects", "No projects yet"],
      ] as const
    ) {
      const page = await context.newPage();
      const diagnostics = captureBrowserDiagnostics(page);
      assertEquals((await page.goto(`http://localhost${path}`))?.status(), 200);
      await page.getByText(visibleText, { exact: true }).waitFor({ timeout: 5_000 });
      await page.waitForLoadState("networkidle");
      if (path === "/projects") {
        assertEquals(projectsRequestCount, 1);
      }
      const style = page.locator(
        `style[${STYLE_IDENTITY_ATTRIBUTE}="${DEV_UI_STYLES_SHA256}"]`,
      );
      assertEquals(await style.count(), 1);
      assertEquals(await style.textContent(), DEV_UI_STYLES);
      assertEquals(getBrowserDiagnosticMessages(diagnostics), []);
      await page.close();
    }
    assertEquals(unexpectedRequests, []);
  } finally {
    await context.unrouteAll({ behavior: "ignoreErrors" });
    await context.close();
    await closeChromium(browser);
  }
});
