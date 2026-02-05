/**
 * E2E Test Setup - Main Entry Point
 *
 * Re-exports all setup utilities for compiled binary E2E tests.
 */

// Binary management
export { BINARY_PATH, ensureBinaryCompiled } from "./binary.ts";

// Server management
export {
  fetchJson,
  fetchPage,
  type ServerOptions,
  startServer,
  type TestServer,
  withServer,
} from "./binary-server.ts";

// Project fixtures
export {
  apiRoutes,
  appProviders,
  components,
  createApiProject,
  createAppProject,
  createComponentImportProject,
  createDynamicRouteProject,
  createLayoutProject,
  createMdxProject,
  createNestedLayoutProject,
  createProject,
  layouts,
  mdxContent,
  pages,
  type ProjectOptions,
} from "./fixtures.ts";

// Assertions
export {
  assertAppProviderRendered,
  assertContextWorks,
  assertHasClass,
  assertHasElement,
  assertHasText,
  assertHeadWorks,
  assertJsonContentType,
  assertLayoutFooterRendered,
  assertLayoutHeaderRendered,
  assertLayoutRendered,
  assertNoCriticalErrors,
  assertNoModuleErrors,
  assertNoReactErrors,
  assertNoServerErrors,
  assertNoServerModuleErrors,
  assertNoServerReactErrors,
  assertNoText,
  assertNotFound,
  assertOk,
  assertPageContentRendered,
  assertRedirect,
  assertRouterWorks,
  assertStatus,
  expectApi,
  expectPage,
  expectServer,
} from "./assertions.ts";
