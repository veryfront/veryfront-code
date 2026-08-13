import "#veryfront/schemas/_test-setup.ts";
/**
 * The platform's own liveness/readiness probes must survive a project's
 * `security.auth` gate.
 *
 * `AuthHandler` runs at priority 0 with `patterns: []`, so it sees every
 * request the registry executes — including the monitoring fast path in
 * `runtime-handler/index.ts`, which calls `registry.execute` with a context
 * carrying the project's `securityConfig`. The caller on that path is a kubelet
 * HTTP probe (operator `k8s-resources.ts`: readinessProbe GET /readyz,
 * livenessProbe + startupProbe GET /healthz). A kubelet probe sends no
 * `Authorization` header and cannot be handed a per-project secret.
 *
 * If the gate answers those probes with 401, the pod never becomes Ready, the
 * Service drops its only endpoint and the ingress answers every visitor request
 * with a bodiless 503 — while the liveness failures restart the container in a
 * loop. Local `veryfront dev` never shows this because the dev server answers
 * /healthz and /readyz ahead of the handler registry.
 *
 * @module server/runtime-handler/monitoring-probe-auth.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { SecurityConfig } from "#veryfront/types";
import { createHandlerRegistry } from "./index.ts";
import { buildMinimalContext } from "./handler-context-builder.ts";
import { setServerInitialized } from "#veryfront/server/handlers/monitoring/health.handler.ts";
import { isMonitoringPath } from "./request-utils.ts";

/** Kubelet probe paths, exactly as the operator manifest declares them. */
const KUBELET_PROBE_PATHS = ["/healthz", "/readyz"] as const;

/** Adapter whose project dir exists, so /readyz can answer "ready". */
function createAdapter(env: Record<string, string> = {}): RuntimeAdapter {
  return {
    id: "test",
    name: "test",
    capabilities: {},
    fs: {
      stat: (_path: string) => Promise.resolve({ isDirectory: true, isFile: false }),
    },
    env: {
      get: (key: string) => env[key],
      set: () => {},
      delete: () => {},
      has: (key: string) => key in env,
      toObject: () => ({ ...env }),
    },
    server: {},
    serve: () => Promise.resolve({ close: () => Promise.resolve() }),
  } as unknown as RuntimeAdapter;
}

/** Replays the monitoring fast path from `runtime-handler/index.ts`. */
async function probe(
  pathname: string,
  securityConfig: SecurityConfig | null,
  env: Record<string, string> = {},
): Promise<Response> {
  assertEquals(isMonitoringPath(pathname), true, `${pathname} must take the monitoring fast path`);

  const projectDir = "/tmp/monitoring-probe-auth";
  const adapter = createAdapter(env);
  const { registry } = createHandlerRegistry(projectDir, adapter);
  const ctx = buildMinimalContext(projectDir, adapter, securityConfig, false, undefined);

  // A kubelet probe: bare GET, no Authorization header, no cookies.
  const req = new Request(`http://10.42.0.17:3001${pathname}`, { method: "GET" });
  const response = await registry.execute(req, ctx);
  return response ?? new Response("Not Found", { status: 404 });
}

async function assertProbesAnswerOk(
  securityConfig: SecurityConfig | null,
  env: Record<string, string> = {},
): Promise<void> {
  setServerInitialized(true);
  try {
    for (const path of KUBELET_PROBE_PATHS) {
      const res = await probe(path, securityConfig, env);
      const challenge = res.headers.get("WWW-Authenticate") ?? "";
      await res.body?.cancel();
      assertEquals(
        res.status,
        200,
        `${path} must stay reachable for the kubelet probe (got ${res.status}${
          challenge ? ` WWW-Authenticate: ${challenge}` : ""
        })`,
      );
    }
  } finally {
    setServerInitialized(false);
  }
}

const BASIC_AUTH = { auth: { basic: { username: "admin", password: "s3cret" } } } as SecurityConfig;
const BEARER_AUTH = { auth: { bearer: { token: "project-secret" } } } as SecurityConfig;
const MALFORMED_AUTH = { auth: { basic: {} } } as unknown as SecurityConfig;

describe("kubelet probes vs the project auth gate", () => {
  it("answer 200 with no auth configured", async () => {
    await assertProbesAnswerOk(null);
  });

  it("answer 200 when the project configures security.auth.basic", async () => {
    await assertProbesAnswerOk(BASIC_AUTH);
  });

  it("answer 200 when the project configures security.auth.bearer", async () => {
    await assertProbesAnswerOk(BEARER_AUTH);
  });

  it("answer 200 when security.auth is malformed and fails closed", async () => {
    await assertProbesAnswerOk(MALFORMED_AUTH);
  });

  it("answer 200 when the auth gate comes from VERYFRONT_BASIC_USER/PASS", async () => {
    await assertProbesAnswerOk(null, {
      VERYFRONT_BASIC_USER: "ops",
      VERYFRONT_BASIC_PASS: "s3cret",
    });
  });

  it("answer 200 when the auth gate comes from VERYFRONT_BEARER_TOKEN", async () => {
    await assertProbesAnswerOk(null, { VERYFRONT_BEARER_TOKEN: "vf_probe_token" });
  });

  it("keeps gating a project page while basic auth is configured", async () => {
    const projectDir = "/tmp/monitoring-probe-auth";
    const adapter = createAdapter();
    const ctx = buildMinimalContext(projectDir, adapter, BASIC_AUTH, false, undefined);
    const { registry } = createHandlerRegistry(projectDir, adapter);
    const res = await registry.execute(new Request("http://site.example/"), ctx);
    await res?.body?.cancel();
    assertEquals(res?.status, 401);
    assertEquals(res?.headers.get("WWW-Authenticate"), 'Basic realm="Secure Area"');
  });
});
