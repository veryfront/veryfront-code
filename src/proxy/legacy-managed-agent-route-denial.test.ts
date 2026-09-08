import { assertEquals, assertThrows } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  isLegacyManagedAgentRoute,
  parseLegacyManagedAgentRouteDeny,
} from "./legacy-managed-agent-route-denial.ts";

describe("legacy managed agent route denial", () => {
  it("is dormant by default and strict when configured", () => {
    assertEquals(parseLegacyManagedAgentRouteDeny(undefined), false);
    assertEquals(parseLegacyManagedAgentRouteDeny(""), false);
    assertEquals(parseLegacyManagedAgentRouteDeny("false"), false);
    assertEquals(parseLegacyManagedAgentRouteDeny("true"), true);
    assertThrows(
      () => parseLegacyManagedAgentRouteDeny("TRUE"),
      TypeError,
      "must be exactly true or false",
    );
  });

  it("matches only registered managed route shapes", () => {
    const managedRoutes = [
      ["POST", "/api/ag-ui"],
      ["POST", "/api/runs"],
      ["POST", "/api/runs/run_1/resume"],
      ["DELETE", "/api/runs/run_1"],
      ["POST", "/api/control-plane/agents/list"],
      ["POST", "/api/control-plane/runs/run_1/execute"],
      ["POST", "/api/control-plane/runs/run_1/stream"],
      ["POST", "/api/control-plane/runs/run_1/resume"],
      ["DELETE", "/api/control-plane/runs/run_1"],
      ["POST", "//api/ag-ui"],
      ["POST", "///api/runs"],
      ["POST", "//api/runs/run_1/resume"],
      ["DELETE", "//api/control-plane/runs/run_1"],
    ] as const;

    for (const [method, pathname] of managedRoutes) {
      assertEquals(isLegacyManagedAgentRoute(method, pathname), true, `${method} ${pathname}`);
    }

    const applicationRoutes = [
      ["GET", "/api/ag-ui"],
      ["GET", "/api/runs"],
      ["POST", "/api/runs/run_1"],
      ["POST", "/api/runs/run_1/resume/extra"],
      ["DELETE", "/api/runs/run_1/extra"],
      ["POST", "/api/control-plane/application-route"],
      ["GET", "/api/control-plane/runs/run_1/stream"],
    ] as const;

    for (const [method, pathname] of applicationRoutes) {
      assertEquals(isLegacyManagedAgentRoute(method, pathname), false, method + " " + pathname);
    }
  });
});
