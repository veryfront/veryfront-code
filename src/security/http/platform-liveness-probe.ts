/**
 * The platform's own liveness and readiness probes.
 *
 * The paths are declared here, on the side both the security gates and the
 * monitoring handler can depend on, because the two have to agree. The
 * orchestrator's HTTP probes are the only caller: the operator gives every
 * project server a `readinessProbe` on `/readyz` and a `livenessProbe` plus
 * `startupProbe` on `/healthz`.
 *
 * @module security/http/platform-liveness-probe
 */

/** Paths the orchestrator probes over HTTP, exactly as the operator declares them. */
export const PLATFORM_LIVENESS_PROBE_PATHS: readonly string[] = Object.freeze([
  "/healthz",
  "/readyz",
]);

const PROBE_PATHS = new Set(PLATFORM_LIVENESS_PROBE_PATHS);

/**
 * Whether a request is one of the orchestrator's HTTP probes.
 *
 * The auth gate runs ahead of every handler and refuses these: a kubelet probe
 * sends no `Authorization` header and there is nowhere to hand it a per-project
 * secret. Left alone, a project that sets `security.auth` fails its own
 * readiness probe, the Service drops its only endpoint, and the ingress answers
 * every visitor with a bodiless 503, while the liveness failures restart the
 * container underneath. The gate the project asked for takes its site offline
 * instead of protecting it, and nothing in the response names auth. Local
 * `veryfront dev` never shows it: the dev server answers both paths ahead of
 * the handler registry.
 *
 * Exempting them discloses nothing the gate exists to protect. `HealthHandler`
 * owns both paths as exact patterns, so a project route can never be what
 * answers here, and what it returns is fixed platform text: `{"service":
 * "veryfront-server","status":"ok"}` and `ready`/`not-ready`. No project
 * content, no configuration, no credential. `/_health`, which reports the
 * runtime version and build mode and which nothing in the platform probes,
 * keeps its gate.
 *
 * Only GET and HEAD are exempt, the methods a probe uses; any other method on
 * these paths is a site visitor and stays gated.
 */
export function isPlatformLivenessProbe(method: string, pathname: string): boolean {
  const verb = method.toUpperCase();
  return (verb === "GET" || verb === "HEAD") && PROBE_PATHS.has(pathname);
}
