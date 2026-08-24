/**
 * The invariant every signed-dispatch exemption rests on.
 *
 * `isSignedControlPlaneDispatch` and `isSignedChannelDispatch` let a request
 * skip `security.auth`, `security.csrf` and the project's root `middleware.ts`.
 * That is only safe because of a fact about the handler chain, not about the
 * predicates: every route either predicate admits is owned by a platform
 * handler that is registered ahead of `ApiHandlerWrapper` and is instantiated
 * unconditionally. The exempted request therefore always terminates at a
 * handler that verifies its envelope, and can never fall through to a project's
 * App Router or Pages API route.
 *
 * That fact lives in the ordering of `HANDLER_NAMES`, and nothing else records
 * it. All seven handlers involved share `PRIORITY_MEDIUM_API`, so
 * `RouteRegistry`'s priority sort is a no-op between them and the chain order
 * is exactly the list order. Move `ApiHandlerWrapper` up the list, move one of
 * the owners down, or give an owner an `enabled` predicate, and each exemption
 * silently turns from "skip the browser-credential gate on the way to a
 * signature check" into "skip the browser-credential gate on the way to project
 * code" — an unauthenticated bypass of the project's own auth, CSRF and
 * middleware, reachable by anyone who sets a header.
 *
 * @module server/runtime-handler/dispatch-exemption-ordering.test
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { Handler, RoutePattern } from "#veryfront/types";
import { createHandlerRegistry } from "#veryfront/server/runtime-handler/index.ts";
import { CONTROL_PLANE_RUN_OPERATION_PATH } from "#veryfront/channels/control-plane-routes.ts";
import {
  CHANNEL_INVOKE_PATH,
  isChannelDispatchRoute,
  isControlPlaneSurfaceRoute,
} from "#veryfront/channels/control-plane.ts";

const RUN_ID = "run_ordering_1";

/**
 * Every route either dispatch predicate admits, and the handler that owns it.
 *
 * The owner column is what makes the exemption safe. It is checked below
 * against the handler's own declared patterns, so a route that quietly moves to
 * a different handler fails here rather than being taken on trust.
 */
const ADMITTED_ROUTES: ReadonlyArray<{
  readonly method: string;
  readonly path: string;
  readonly owner: string;
}> = [
  {
    method: "POST",
    path: "/api/control-plane/agents/list",
    owner: "InternalAgentsListHandler",
  },
  {
    method: "POST",
    path: `/api/control-plane/runs/${RUN_ID}/execute`,
    owner: "ProjectRunExecuteHandler",
  },
  {
    method: "POST",
    path: `/api/control-plane/runs/${RUN_ID}/stream`,
    owner: "AgentStreamHandler",
  },
  {
    method: "POST",
    path: `/api/control-plane/runs/${RUN_ID}/resume`,
    owner: "AgentRunResumeHandler",
  },
  {
    method: "DELETE",
    path: `/api/control-plane/runs/${RUN_ID}`,
    owner: "AgentRunCancelHandler",
  },
  {
    method: "POST",
    path: CHANNEL_INVOKE_PATH,
    owner: "ChannelInvokeHandler",
  },
];

const CONSEQUENCE =
  "Reordering HANDLER_NAMES turns the signed-dispatch exemptions into bypasses. " +
  "A request carrying only a header would skip the project's security.auth, " +
  "security.csrf and middleware.ts and reach project code, because nothing " +
  "downstream of ApiHandlerWrapper verifies a dispatch envelope. If you need to " +
  "move a handler, move it and keep every owner listed here ahead of " +
  "ApiHandlerWrapper.";

function createAdapter(): RuntimeAdapter {
  return {
    env: { get: () => undefined },
    fs: {},
  } as unknown as RuntimeAdapter;
}

function patternClaims(pattern: RoutePattern, method: string, path: string): boolean {
  const methods = pattern.method === undefined
    ? undefined
    : Array.isArray(pattern.method)
    ? pattern.method
    : [pattern.method];
  if (methods && !methods.some((value) => value.toUpperCase() === method)) return false;

  if (pattern.pattern instanceof RegExp) return pattern.pattern.test(path);
  if (pattern.exact) return path === pattern.pattern;
  if (pattern.prefix) return path.startsWith(pattern.pattern);
  return path === pattern.pattern;
}

function claimsRoute(handler: Handler, method: string, path: string): boolean {
  return (handler.metadata.patterns ?? []).some((pattern) => patternClaims(pattern, method, path));
}

describe("signed-dispatch exemptions: handler ordering invariant", () => {
  const { registry } = createHandlerRegistry("/project", createAdapter());
  const order = registry.getHandlers().map((handler) => handler.metadata.name);
  const apiIndex = order.indexOf("ApiHandlerWrapper");

  /**
   * Resolve an owner, failing with the consequence rather than vacuously.
   *
   * Every assertion below reads a property off the owning handler. Reached
   * through an optional chain, a missing owner yields `undefined`, which is
   * also the value the `enabled` check expects, so the test would pass while
   * the invariant it names went unverified. A bare `!` instead throws a
   * `TypeError` that says nothing about why the chain matters. Fail here, once,
   * with the reason.
   */
  function requireOwner(owner: string, method: string, path: string): Handler {
    const handler = registry.getHandlers().find((h) => h.metadata.name === owner);
    assertEquals(
      handler !== undefined,
      true,
      `${owner} owns ${method} ${path}, which the signed-dispatch predicates admit, but it ` +
        `is not registered in the handler chain. ${CONSEQUENCE}`,
    );
    return handler as Handler;
  }

  it("registers ApiHandlerWrapper in the chain", () => {
    assertEquals(apiIndex >= 0, true, "ApiHandlerWrapper is not in the handler chain at all");
  });

  for (const route of ADMITTED_ROUTES) {
    it(`keeps ${route.owner} ahead of ApiHandlerWrapper for ${route.method} ${route.path}`, () => {
      const ownerIndex = order.indexOf(route.owner);
      assertEquals(
        ownerIndex >= 0,
        true,
        `${route.owner} owns ${route.method} ${route.path}, which the signed-dispatch ` +
          `predicates admit, but it is not registered in the handler chain. ${CONSEQUENCE}`,
      );
      assertEquals(
        ownerIndex < apiIndex,
        true,
        `${route.owner} (chain position ${ownerIndex}) now runs AFTER ApiHandlerWrapper ` +
          `(position ${apiIndex}), so an exempted ${route.method} ${route.path} reaches ` +
          `project code before it reaches the handler that verifies its signature. ` +
          CONSEQUENCE,
      );
    });

    it(`instantiates ${route.owner} unconditionally`, () => {
      const handler = requireOwner(route.owner, route.method, route.path);
      assertEquals(
        handler.metadata.enabled,
        undefined,
        `${route.owner} now declares an \`enabled\` predicate, so the runtime can skip it ` +
          `for some requests while the exemption in front of it still applies. On a request ` +
          `where it is skipped, ${route.method} ${route.path} falls through to ` +
          `ApiHandlerWrapper. ${CONSEQUENCE}`,
      );
    });

    it(`routes ${route.method} ${route.path} to ${route.owner} by its own patterns`, () => {
      assertEquals(
        claimsRoute(
          requireOwner(route.owner, route.method, route.path),
          route.method,
          route.path,
        ),
        true,
        `${route.owner} no longer declares a pattern covering ${route.method} ${route.path}. ` +
          `The route may have moved to another handler; check that its new owner is also ` +
          `ahead of ApiHandlerWrapper. ${CONSEQUENCE}`,
      );
    });
  }

  it("lists every route the dispatch predicates admit", () => {
    // The predicates are the source of truth for what is exempt. If either one
    // learns a new route, this catches the omission rather than leaving the new
    // route's ordering unchecked.
    const probes: ReadonlyArray<{ method: string; path: string }> = [
      { method: "POST", path: "/api/control-plane/agents/list" },
      { method: "POST", path: `/api/control-plane/runs/${RUN_ID}/execute` },
      { method: "POST", path: `/api/control-plane/runs/${RUN_ID}/stream` },
      { method: "POST", path: `/api/control-plane/runs/${RUN_ID}/resume` },
      { method: "DELETE", path: `/api/control-plane/runs/${RUN_ID}` },
      { method: "POST", path: CHANNEL_INVOKE_PATH },
      // Shapes the predicates must keep rejecting, so a widened predicate that
      // starts admitting them shows up as a missing row here.
      { method: "POST", path: "/api/control-plane/runs" },
      { method: "GET", path: `/api/control-plane/runs/${RUN_ID}/execute` },
      { method: "POST", path: "/api/control-plane/anything-else" },
      { method: "POST", path: `${CHANNEL_INVOKE_PATH}/application-route` },
      { method: "PUT", path: CHANNEL_INVOKE_PATH },
    ];

    const admitted = probes
      .filter(({ method, path }) =>
        isControlPlaneSurfaceRoute(method, path) || isChannelDispatchRoute(method, path)
      )
      .map(({ method, path }) => `${method} ${path}`);
    const listed = ADMITTED_ROUTES.map((route) => `${route.method} ${route.path}`);

    assertEquals(
      admitted,
      listed,
      `The set of routes the dispatch predicates admit no longer matches the table in this ` +
        `file. Add the new route and its owning handler to ADMITTED_ROUTES so its position ` +
        `relative to ApiHandlerWrapper is checked. ${CONSEQUENCE}`,
    );
  });

  it("lists every run operation verb the control-plane predicate admits", () => {
    // The probe list above can only catch a widened predicate for the shapes it
    // happens to contain. Read the verb alternation out of the predicate's own
    // pattern so a fourth run operation cannot be admitted without a row here.
    const alternation = CONTROL_PLANE_RUN_OPERATION_PATH.source.match(/\(\?:([^)]*)\)\$$/u);
    assertEquals(
      alternation !== null,
      true,
      "CONTROL_PLANE_RUN_OPERATION_PATH must keep its run operation verbs in a literal " +
        "alternation group so this inventory can read them",
    );
    const verbs = alternation![1]!.split("|").toSorted();

    const runOperationPrefix = `/api/control-plane/runs/${RUN_ID}/`;
    const listedVerbs = ADMITTED_ROUTES
      .filter((route) => route.method === "POST" && route.path.startsWith(runOperationPrefix))
      .map((route) => route.path.slice(runOperationPrefix.length))
      .toSorted();

    assertEquals(
      verbs,
      listedVerbs,
      `A new signed-dispatch run operation must be added to ADMITTED_ROUTES with its owning ` +
        `handler, which must sit ahead of ApiHandlerWrapper. ${CONSEQUENCE}`,
    );
  });
});
