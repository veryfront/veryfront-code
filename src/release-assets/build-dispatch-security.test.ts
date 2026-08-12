/**
 * Regression: a project's own request gates must not block its release asset
 * manifest build. Two of them have: `security.csrf`, and a root `middleware.ts`.
 *
 * The release asset manifest is built by the project runtime, not by the CLI:
 * the control plane POSTs a signed operation envelope to
 * `/api/control-plane/runs/{runId}/execute` with `target:
 * "task:release-asset-build"`, and only that dispatch calls
 * `beginReleaseAssetManifestBuild`. Until it lands, the manifest does not
 * exist, and `veryfront deploy` reports
 * `Release assets were not ready within 120s (last state: missing)`.
 *
 * That dispatch is a POST, and it carries a JWS envelope rather than a CSRF
 * double-submit token. The control plane is not a browser and has no
 * `__Host-vf_csrf` cookie to echo. `CsrfHandler` runs at priority 5, ahead of
 * `ProjectRunExecuteHandler`, and matches every path, so a project whose
 * config enables CSRF at all turns its own release asset builds into 403s.
 * Nothing downstream can see it: the run fails before the manifest row is
 * created, and the deploy timeout names neither CSRF nor config.
 *
 * `projectMiddlewareRuntime.execute` wraps the entire handler chain, so a root
 * `middleware.ts` sits in front of the same dispatch and fails it the same way.
 * It has no way to pass: `createApplicationRequest` withholds every
 * `x-veryfront-*` header from project code, so the signature the platform
 * authenticates with is not visible to the middleware that would have to trust
 * it.
 *
 * @module release-assets/build-dispatch-security.test
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RouteRegistry } from "#veryfront/routing/registry/index.ts";
import { CsrfHandler } from "#veryfront/security/http/csrf/csrf-handler.ts";
import { deriveSecurityContext } from "#veryfront/security/http/config.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  ProjectRunExecuteHandler,
  type ProjectRunExecuteHandlerDeps,
} from "#veryfront/server/handlers/request/project-run-execute.handler.ts";
import {
  createControlPlaneSignature,
  createCtx,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import type { MiddlewareFunction } from "#veryfront/server/dev-server/middleware.ts";
import { ProjectMiddlewareRuntime } from "#veryfront/server/runtime-handler/project-middleware.ts";

const RUN_ID = "run_release_assets_1";
const EXECUTE_PATH = `/api/control-plane/runs/${RUN_ID}/execute`;

type CsrfSetting = VeryfrontConfig["security"] extends infer S
  ? S extends { csrf?: infer C } ? C : never
  : never;

interface DispatchOutcome {
  /** Whether the release asset build executor was reached at all. */
  readonly begun: boolean;
  readonly status: number;
  readonly body: string;
}

/**
 * Drive the real handler chain the runtime uses for a control-plane run
 * dispatch: the security handlers first, then the run executor.
 */
async function dispatchReleaseAssetBuild(
  csrf: CsrfSetting | undefined,
  options: { projectMiddleware?: MiddlewareFunction[]; unsigned?: boolean } = {},
): Promise<DispatchOutcome> {
  const config = {
    security: csrf === undefined ? {} : { csrf },
  } as VeryfrontConfig;
  const { securityConfig } = deriveSecurityContext(config, {
    // The task rail dispatches to the project's main-branch runtime, which
    // resolves as a preview environment. Production defaults are therefore off
    // and only an explicit `security.csrf` can enable the gate here.
    productionDefaults: false,
  });

  const body = {
    runId: RUN_ID,
    kind: "task",
    target: "task:release-asset-build",
    projectId: "proj-1",
    config: { release_id: "rel-1", release_version: 1 },
  };
  const rawBody = JSON.stringify(body);
  const { jws, publicKeyPem } = await createControlPlaneSignature(rawBody, {
    requestId: RUN_ID,
    projectId: "proj-1",
    requestMethod: "POST",
    requestPath: EXECUTE_PATH,
  });
  const request = new Request(`https://example-project.example.test${EXECUTE_PATH}`, {
    method: "POST",
    headers: options.unsigned ? { "content-type": "application/json" } : {
      "content-type": "application/json",
      "x-veryfront-control-plane-jws": jws,
    },
    body: rawBody,
  });

  let begun = false;
  const deps = {
    executeReleaseAssetBuild: () => {
      // Stands in for `runReleaseAssetBuild`, whose first act is
      // `beginReleaseAssetManifestBuild`. Reaching it is what moves the
      // manifest off `missing`.
      begun = true;
      return Promise.resolve({
        success: true,
        result: { state: "ready", moduleCount: 1, cssCount: 1, routeCount: 1 },
        logs: null,
        duration_ms: 10,
      });
    },
    now: () => 0,
  } as unknown as ProjectRunExecuteHandlerDeps;

  const ctx = createCtx(publicKeyPem);
  ctx.securityConfig = securityConfig;

  const registry = new RouteRegistry();
  registry.registerAll([new CsrfHandler(), new ProjectRunExecuteHandler(deps)]);

  // The runtime wraps the whole handler chain in the project's own root
  // middleware, so a dispatch meets `middleware.ts` before it meets any
  // handler.
  const middlewareRuntime = new ProjectMiddlewareRuntime({
    loadMiddleware: () => Promise.resolve(options.projectMiddleware ?? []),
  });
  const response = await middlewareRuntime.execute({
    request,
    handlerContext: ctx,
    isSharedProxy: false,
    next: async () => (await registry.execute(request, ctx)) ?? undefined,
  });
  return {
    begun,
    status: response?.status ?? 0,
    body: response ? await response.text() : "",
  };
}

describe("release assets: control-plane build dispatch", () => {
  it("builds a manifest when the project leaves csrf unset", async () => {
    const outcome = await dispatchReleaseAssetBuild(undefined);
    assertEquals(outcome.status, 200);
    assertEquals(outcome.begun, true);
  });

  it("builds a manifest when the project disables csrf", async () => {
    const outcome = await dispatchReleaseAssetBuild(false);
    assertEquals(outcome.status, 200);
    assertEquals(outcome.begun, true);
  });

  it("builds a manifest when the project enables csrf with a boolean", async () => {
    const outcome = await dispatchReleaseAssetBuild(true);
    assertEquals(
      outcome.begun,
      true,
      `release asset build never started; runtime answered ${outcome.status}: ${outcome.body}`,
    );
    assertEquals(outcome.status, 200);
  });

  it("builds a manifest when the project's own middleware gates every request", async () => {
    // A root `middleware.ts` that authorizes traffic is ordinary project code,
    // and `projectMiddlewareRuntime.execute` wraps the entire handler chain, so
    // it stands in front of the build dispatch as well. It cannot authorize
    // that dispatch even in principle: `createApplicationRequest` strips every
    // `x-veryfront-*` header before project code sees the request, so the
    // signature the platform authenticates with is invisible to it.
    let middlewareCalls = 0;
    const outcome = await dispatchReleaseAssetBuild(undefined, {
      projectMiddleware: [
        (c, next) => {
          middlewareCalls++;
          if (!c.req.headers.get("authorization")) {
            return Promise.resolve(new Response("Unauthorized", { status: 401 }));
          }
          return next();
        },
      ],
    });

    assertEquals(
      outcome.begun,
      true,
      `release asset build never started; runtime answered ${outcome.status}: ${outcome.body}`,
    );
    assertEquals(outcome.status, 200);
    assertEquals(middlewareCalls, 0);
  });

  it("keeps project middleware in front of an unsigned request to the same path", async () => {
    // The bypass is keyed on a dispatch, not on a path. Without the signature
    // header the request is project traffic, and the project's middleware
    // answers it exactly as before.
    let middlewareCalls = 0;
    const outcome = await dispatchReleaseAssetBuild(undefined, {
      unsigned: true,
      projectMiddleware: [
        () => {
          middlewareCalls++;
          return new Response("Unauthorized", { status: 401 });
        },
      ],
    });

    assertEquals(outcome.status, 401);
    assertEquals(outcome.begun, false);
    assertEquals(middlewareCalls, 1);
  });

  it("builds a manifest when the project excludes a path from csrf", async () => {
    // The shape that first surfaced this: keep CSRF enforced everywhere except
    // the agent endpoint the chat client posts to.
    const outcome = await dispatchReleaseAssetBuild({ excludePaths: ["/api/ag-ui"] });
    assertEquals(
      outcome.begun,
      true,
      `release asset build never started; runtime answered ${outcome.status}: ${outcome.body}`,
    );
    assertEquals(outcome.status, 200);
  });
});
