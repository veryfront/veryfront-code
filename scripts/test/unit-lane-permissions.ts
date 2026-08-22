/**
 * The permission set every unit test lane runs under.
 *
 * Network access is an allow-list limited to loopback, not a deny-list of
 * provider hosts. A deny-list has to be maintained, and any host nobody
 * thought of is permitted by default; this way a destination nobody has heard
 * of yet is blocked by default and there is no list to keep current.
 *
 * Tests that need a real destination bind one on loopback. Tests that stub
 * their transport reach no resolver at all, because the stub also supplies the
 * egress guard's host resolver (`src/testing/mock-fetch.ts`) -- without that
 * the guard resolves the destination before the stub ever sees the request,
 * and a fully stubbed test dies on DNS it never meant to perform.
 *
 * A test that genuinely needs to reach the internet belongs in the integration
 * suite under `tests/`, where the dependency is visible. Do not widen this
 * list to accommodate one.
 *
 * @module scripts/test/unit-lane-permissions
 */

/** Loopback destinations, per family, plus the wildcard bind addresses. */
export const LOOPBACK_ONLY_NET = "--allow-net=127.0.0.1,localhost,0.0.0.0,[::1],[::]";

/** Everything `--allow-all` used to grant, minus unrestricted network access. */
export const UNIT_LANE_PERMISSIONS: readonly string[] = [
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-run",
  "--allow-sys",
  // Some npm dependencies in the build pipeline are Node-API addons.
  "--allow-ffi",
  LOOPBACK_ONLY_NET,
];
