/**
 * Regression: a project that configures `security.csrf` must still be able to
 * publish a release asset manifest.
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
 * `security.auth` is the same failure with a different gate. `AuthHandler` runs
 * at priority 0 — ahead of `CsrfHandler` — and also matches every path, and the
 * credential it demands is one the platform structurally cannot hold: the
 * control plane sends a per-run service `Bearer` JWT the Basic branch can never
 * match and the Bearer branch compares against a project-authored secret. Both
 * gates are driven here against the real handler chain.
 *
 * @module release-assets/build-dispatch-security.test
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RouteRegistry } from "#veryfront/routing/registry/index.ts";
import { AuthHandler } from "#veryfront/security/http/auth.ts";
import { CsrfHandler } from "#veryfront/security/http/csrf/csrf-handler.ts";
import { deriveSecurityContext } from "#veryfront/security/http/config.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { SecurityConfig } from "#veryfront/types";
import {
  ProjectRunExecuteHandler,
  type ProjectRunExecuteHandlerDeps,
} from "#veryfront/server/handlers/request/project-run-execute.handler.ts";
import {
  createControlPlaneSignature,
  createCtx,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";

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
  auth?: SecurityConfig["auth"],
): Promise<DispatchOutcome> {
  const security: Record<string, unknown> = {};
  if (csrf !== undefined) security.csrf = csrf;
  if (auth !== undefined) security.auth = auth;
  const config = { security } as VeryfrontConfig;
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
    headers: {
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
  registry.registerAll([
    new AuthHandler(),
    new CsrfHandler(),
    new ProjectRunExecuteHandler(deps),
  ]);

  const response = await registry.execute(request, ctx);
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

  it("builds a manifest when the project puts the site behind basic auth", async () => {
    // The platform cannot hold a project-authored Basic credential. It sends a
    // per-run service `Bearer` JWT and the signed envelope, so `checkBasicAuth`
    // could only ever answer 401 — and 401 is not retryable, so the run dies
    // and the manifest row is never created.
    const outcome = await dispatchReleaseAssetBuild(undefined, {
      basic: { username: "admin", password: "secret" },
    });
    assertEquals(
      outcome.begun,
      true,
      `release asset build never started; runtime answered ${outcome.status}: ${outcome.body}`,
    );
    assertEquals(outcome.status, 200);
  });

  it("builds a manifest when the project puts the site behind bearer auth", async () => {
    const outcome = await dispatchReleaseAssetBuild(undefined, {
      bearer: { token: "project-authored-token" },
    });
    assertEquals(
      outcome.begun,
      true,
      `release asset build never started; runtime answered ${outcome.status}: ${outcome.body}`,
    );
    assertEquals(outcome.status, 200);
  });

  it("builds a manifest when the project enables both gates at once", async () => {
    const outcome = await dispatchReleaseAssetBuild(true, {
      basic: { username: "admin", password: "secret" },
    });
    assertEquals(
      outcome.begun,
      true,
      `release asset build never started; runtime answered ${outcome.status}: ${outcome.body}`,
    );
    assertEquals(outcome.status, 200);
  });
});
