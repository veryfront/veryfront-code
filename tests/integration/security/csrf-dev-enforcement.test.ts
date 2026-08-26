/**
 * CSRF parity in `veryfront dev`, driven through the real dev pipeline.
 *
 * The unit suites pin the handler and the derived config. This one answers the
 * question those cannot: with enforcement on locally, does the dev server the
 * developer actually runs still work? It drives the same `RequestHandler` the
 * dev server serves, over a request stamped with a loopback peer, so the
 * framework-owned routes are admitted exactly as a browser on 127.0.0.1 is.
 *
 * Every case puts the process in the development posture first. The test
 * runner exports `NODE_ENV=production`, and a developer running `veryfront dev`
 * exports nothing, so without this the harness would resolve the production
 * security posture and prove nothing about local development.
 */

import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { withInProcessProject } from "../../_helpers/in-process-project.ts";

const API_ROUTE = `export const GET = () => Response.json({ ok: true });
export const POST = () => Response.json({ created: true });
`;

const PAGE = `export default function Home() {
  return "home";
}
`;

const FILES = {
  "pages/api/cases.ts": API_ROUTE,
  "pages/index.tsx": PAGE,
} as const;

function readCsrfToken(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  return /__Host-vf_csrf=([^;]+)/.exec(setCookie)?.[1] ?? "";
}

/** Put the process in the posture a developer's own machine has. */
function useDevelopmentPosture(project: { context: { setEnv(v: Record<string, string>): void } }) {
  project.context.setEnv({ NODE_ENV: "development", VERYFRONT_ENV: "development" });
}

describe("CSRF enforcement in local development", () => {
  it("issues the token cookie, rejects a token-less mutation, and accepts the echoed one", async () => {
    await withInProcessProject("csrf-dev-parity", { files: FILES }, async (project) => {
      useDevelopmentPosture(project);

      const page = await project.handle("/", {
        headers: { accept: "text/html" },
      });
      await page.body?.cancel();
      const token = readCsrfToken(page);

      assert(
        token.length > 0,
        "the dev server must issue __Host-vf_csrf on an HTML document response",
      );

      const rejected = await project.handle("/api/cases", { method: "POST" });
      const rejectedBody = await rejected.text();

      assertEquals(
        rejected.status,
        403,
        "a token-less mutation must fail in dev, not only after deploy",
      );
      assertStringIncludes(rejectedBody, "__Host-vf_csrf");
      assertStringIncludes(rejectedBody, "x-csrf-token");
      assertStringIncludes(rejectedBody, "csrfMutationHeaders");
      assertStringIncludes(rejectedBody, "veryfront/index.client");

      const accepted = await project.handle("/api/cases", {
        method: "POST",
        headers: {
          cookie: `__Host-vf_csrf=${token}`,
          "x-csrf-token": token,
        },
      });

      assertEquals(
        accepted.status,
        200,
        "echoing the issued cookie must reach the project's own route",
      );
      assertEquals(await accepted.json(), { created: true });
    });
  });

  it("leaves the framework's own local control mutations working", async () => {
    await withInProcessProject("csrf-dev-framework-routes", { files: FILES }, async (project) => {
      useDevelopmentPosture(project);

      // The inline dev error logger posts this on every page load and carries
      // no token. Enforcing CSRF on it would fill the console with 403s.
      const clientLog = await project.handle("/_veryfront/log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: "info", message: "Page loaded" }),
      });
      await clientLog.body?.cancel();

      assertEquals(
        clientLog.status,
        200,
        "the development client logger must keep accepting posts from the page",
      );

      // The dashboard API answers its own session gate, not the CSRF gate. A
      // 403 here must come from the dashboard's missing session, which proves
      // the CSRF handler let the request reach it.
      const dashboard = await project.handle("/_dev/api/execute-tool", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolId: "none", args: {} }),
      });
      const dashboardBody = await dashboard.text();

      assertEquals(dashboard.status, 403);
      assertStringIncludes(
        dashboardBody,
        "Dashboard mutation requires a valid session",
        "the dashboard's own session gate must be what rejects this, not the CSRF gate",
      );
    });
  });

  it("leaves every read-method development surface untouched", async () => {
    await withInProcessProject("csrf-dev-reads", { files: FILES }, async (project) => {
      useDevelopmentPosture(project);

      // GET, HEAD and OPTIONS never reach the token check, so the HMR client,
      // the dashboard's read API and the project's own reads are unaffected.
      for (const path of ["/_veryfront/hmr.js", "/_dev/api/stats", "/api/cases"]) {
        const response = await project.handle(path);
        await response.body?.cancel();

        assertEquals(response.status, 200, `${path} must still answer a read`);
      }
    });
  });

  it("keeps a cross-site post to a framework route rejected", async () => {
    await withInProcessProject("csrf-dev-cross-site", { files: FILES }, async (project) => {
      useDevelopmentPosture(project);

      const response = await project.handle("/_veryfront/log", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ level: "info", message: "from elsewhere" }),
      });
      await response.body?.cancel();

      assertEquals(
        response.status,
        403,
        "a page on another origin must not reach a framework local control route",
      );
    });
  });

  it("honours security.csrf false as the documented local opt-out", async () => {
    await withInProcessProject(
      "csrf-dev-opt-out",
      { files: FILES, config: { security: { csrf: false } } },
      async (project) => {
        useDevelopmentPosture(project);

        const page = await project.handle("/", { headers: { accept: "text/html" } });
        await page.body?.cancel();

        assertEquals(
          readCsrfToken(page),
          "",
          "the opt-out must suppress the token cookie as well as the check",
        );

        const response = await project.handle("/api/cases", { method: "POST" });

        assertEquals(
          response.status,
          200,
          "an opted-out project must keep its hand-rolled local mutations working",
        );
        assertEquals(await response.json(), { created: true });
      },
    );
  });
});
