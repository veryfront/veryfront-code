import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { PageRouteMatcher } from "./matchers/index.ts";

type RouteDefinition = {
  pattern: string;
  page: string;
};

export function createRouterWithRoutes(routes: RouteDefinition[]): PageRouteMatcher {
  const router = new PageRouteMatcher();
  for (const route of routes) {
    router.addRoute(route.pattern, route.page);
  }
  return router;
}

export function expectRouteMatch(
  router: PageRouteMatcher,
  path: string,
  expected: {
    page?: string;
    params?: Record<string, unknown>;
  } = {},
) {
  const match = router.match(path);
  assertExists(match);
  if (expected.page !== undefined) {
    assertEquals(match.route.page, expected.page);
  }
  if (expected.params !== undefined) {
    assertEquals(match.params, expected.params);
  }
  return match;
}

export function expectNoRouteMatch(router: PageRouteMatcher, path: string): void {
  assertEquals(router.match(path), null);
}
