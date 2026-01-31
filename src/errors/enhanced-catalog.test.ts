import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  BUILD_ERROR_CATALOG,
  CONFIG_ERROR_CATALOG,
  DEPLOYMENT_ERROR_CATALOG,
  DEV_ERROR_CATALOG,
  ERROR_CATALOG,
  GENERAL_ERROR_CATALOG,
  getErrorSolution,
  MODULE_ERROR_CATALOG,
  ROUTE_ERROR_CATALOG,
  RSC_ERROR_CATALOG,
  RUNTIME_ERROR_CATALOG,
  searchErrors,
  SERVER_ERROR_CATALOG,
} from "./enhanced-catalog.ts";

describe("errors/enhanced-catalog", () => {
  it("should re-export ERROR_CATALOG", () => {
    assertEquals(typeof ERROR_CATALOG, "object");
    assertEquals(Object.keys(ERROR_CATALOG).length > 0, true);
  });

  it("should re-export getErrorSolution", () => {
    assertEquals(typeof getErrorSolution, "function");
  });

  it("should re-export searchErrors", () => {
    assertEquals(typeof searchErrors, "function");
  });

  it("should re-export all individual catalogs", () => {
    const catalogs = [
      BUILD_ERROR_CATALOG,
      CONFIG_ERROR_CATALOG,
      DEPLOYMENT_ERROR_CATALOG,
      DEV_ERROR_CATALOG,
      GENERAL_ERROR_CATALOG,
      MODULE_ERROR_CATALOG,
      ROUTE_ERROR_CATALOG,
      RSC_ERROR_CATALOG,
      RUNTIME_ERROR_CATALOG,
      SERVER_ERROR_CATALOG,
    ];

    for (const catalog of catalogs) {
      assertEquals(typeof catalog, "object");
    }
  });
});
