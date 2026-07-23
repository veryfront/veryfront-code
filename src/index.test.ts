import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as config from "#veryfront/config";
import * as data from "#veryfront/data";
import * as platform from "#veryfront/platform";
import * as routing from "#veryfront/routing";
import * as security from "#veryfront/security";
import * as server from "#veryfront/server";
import * as rootModule from "./index.ts";
import * as publicRootModule from "veryfront";

const expectedRuntimeExports = [
  "CommonSchemas",
  "INPUT_VALIDATION_FAILED",
  "apiNotFound",
  "apiRedirect",
  "badRequest",
  "createHandler",
  "createValidatedHandler",
  "createValidationError",
  "defineConfig",
  "defineConfigWithEnv",
  "forbidden",
  "getEnv",
  "json",
  "mergeConfigs",
  "notFound",
  "parseFormData",
  "parseJsonBody",
  "parseQueryParams",
  "redirect",
  "sanitizeData",
  "serverError",
  "startServer",
  "toNodeHandler",
  "unauthorized",
].sort();

describe("veryfront root public export surface", () => {
  it("preserves the intentional runtime export surface", () => {
    assertEquals(Object.keys(rootModule).sort(), expectedRuntimeExports);
    assertEquals(Object.keys(publicRootModule).sort(), expectedRuntimeExports);
  });

  it("keeps runtime re-exports wired to their source modules", () => {
    assertStrictEquals(rootModule.defineConfig, config.defineConfig);
    assertStrictEquals(rootModule.defineConfigWithEnv, config.defineConfigWithEnv);
    assertStrictEquals(rootModule.mergeConfigs, config.mergeConfigs);
    assertStrictEquals(rootModule.getEnv, platform.getEnv);

    assertStrictEquals(rootModule.createHandler, server.createHandler);
    assertStrictEquals(rootModule.startServer, server.startServer);
    assertStrictEquals(rootModule.toNodeHandler, server.toNodeHandler);

    assertStrictEquals(rootModule.apiNotFound, routing.notFound);
    assertStrictEquals(rootModule.apiRedirect, routing.redirect);
    assertStrictEquals(rootModule.badRequest, routing.badRequest);
    assertStrictEquals(rootModule.forbidden, routing.forbidden);
    assertStrictEquals(rootModule.json, routing.json);
    assertStrictEquals(rootModule.serverError, routing.serverError);
    assertStrictEquals(rootModule.unauthorized, routing.unauthorized);

    assertStrictEquals(rootModule.notFound, data.notFound);
    assertStrictEquals(rootModule.redirect, data.redirect);

    assertStrictEquals(rootModule.CommonSchemas, security.CommonSchemas);
    assertStrictEquals(rootModule.INPUT_VALIDATION_FAILED, security.INPUT_VALIDATION_FAILED);
    assertStrictEquals(rootModule.createValidatedHandler, security.createValidatedHandler);
    assertStrictEquals(rootModule.createValidationError, security.createValidationError);
    assertStrictEquals(rootModule.parseFormData, security.parseFormData);
    assertStrictEquals(rootModule.parseJsonBody, security.parseJsonBody);
    assertStrictEquals(rootModule.parseQueryParams, security.parseQueryParams);
    assertStrictEquals(rootModule.sanitizeData, security.sanitizeData);
  });

  it("keeps the package entrypoint aligned with the source barrel", () => {
    for (const exportName of expectedRuntimeExports) {
      assertStrictEquals(
        publicRootModule[exportName as keyof typeof publicRootModule],
        rootModule[exportName as keyof typeof rootModule],
      );
    }
  });
});
