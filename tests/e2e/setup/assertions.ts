/**
 * E2E Test Assertions
 *
 * BDD-style assertion helpers for E2E tests:
 * - Page content assertions
 * - Response validation
 * - Error detection
 * - Component rendering validation
 */

import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import type { TestServer } from "./binary-server.ts";

// ============================================================================
// Response Assertions
// ============================================================================

/**
 * Assert the response status code.
 */
export function assertStatus(response: Response, expected: number, message?: string): void {
  assertEquals(
    response.status,
    expected,
    message ?? `Expected status ${expected}, got ${response.status}`,
  );
}

/**
 * Assert response is OK (200).
 */
export function assertOk(response: Response, message?: string): void {
  assertStatus(response, 200, message ?? "Expected 200 OK response");
}

/**
 * Assert response is Not Found (404).
 */
export function assertNotFound(response: Response, message?: string): void {
  assertStatus(response, 404, message ?? "Expected 404 Not Found response");
}

/**
 * Assert response is a redirect (3xx).
 */
export function assertRedirect(response: Response, message?: string): void {
  assert(
    response.status >= 300 && response.status < 400,
    message ?? `Expected redirect (3xx), got ${response.status}`,
  );
}

/**
 * Assert response has JSON content type.
 */
export function assertJsonContentType(response: Response): void {
  const contentType = response.headers.get("content-type");
  assert(
    contentType?.includes("application/json"),
    `Expected JSON content type, got ${contentType}`,
  );
}

// ============================================================================
// HTML Content Assertions
// ============================================================================

/**
 * Assert HTML contains a specific element by ID.
 */
export function assertHasElement(html: string, id: string, message?: string): void {
  assertStringIncludes(
    html,
    `id="${id}"`,
    message ?? `Expected element with id="${id}" to be present`,
  );
}

/**
 * Assert HTML contains specific text content.
 */
export function assertHasText(html: string, text: string, message?: string): void {
  assertStringIncludes(html, text, message ?? `Expected text "${text}" to be present`);
}

/**
 * Assert HTML does NOT contain specific text.
 */
export function assertNoText(html: string, text: string, message?: string): void {
  assert(!html.includes(text), message ?? `Expected text "${text}" to NOT be present`);
}

/**
 * Assert HTML contains a class name.
 */
export function assertHasClass(html: string, className: string, message?: string): void {
  assertStringIncludes(
    html,
    className,
    message ?? `Expected class "${className}" to be present`,
  );
}

// ============================================================================
// Layout & Component Assertions
// ============================================================================

/**
 * Assert layout wrapper is rendered.
 */
export function assertLayoutRendered(html: string, layoutId = "layout-wrapper"): void {
  assertHasElement(html, layoutId, "Layout wrapper should be rendered");
}

/**
 * Assert layout header is rendered.
 */
export function assertLayoutHeaderRendered(html: string, headerId = "layout-header"): void {
  assertHasElement(html, headerId, "Layout header should be rendered");
}

/**
 * Assert layout footer is rendered.
 */
export function assertLayoutFooterRendered(html: string, footerId = "layout-footer"): void {
  assertHasElement(html, footerId, "Layout footer should be rendered");
}

/**
 * Assert app provider wrapper is rendered.
 */
export function assertAppProviderRendered(html: string, appId = "app-wrapper"): void {
  assertHasElement(html, appId, "App provider wrapper should be rendered");
}

/**
 * Assert page content is rendered.
 */
export function assertPageContentRendered(html: string, contentId = "content"): void {
  assertHasElement(html, contentId, "Page content should be rendered");
}

// ============================================================================
// Error Detection Assertions
// ============================================================================

/**
 * Assert no module resolution errors in HTML.
 */
export function assertNoModuleErrors(html: string): void {
  assertNoText(html, "Module not found", "Should not have module resolution errors");
  assertNoText(html, "Missing module", "Should not have missing module errors");
  assertNoText(html, "esm.sh/_vf_modules", "Should not have esm.sh/_vf_modules errors");
}

/**
 * Assert no React hook errors in HTML.
 */
export function assertNoReactErrors(html: string): void {
  assertNoText(html, "Invalid hook call", "Should not have React hook errors");
  assertNoText(html, "more than one copy of React", "Should not have dual React errors");
}

/**
 * Assert no critical errors in HTML (combines module + React checks).
 */
export function assertNoCriticalErrors(html: string): void {
  assertNoModuleErrors(html);
  assertNoReactErrors(html);
}

/**
 * Assert no error logs in server output.
 */
export function assertNoServerErrors(server: TestServer, message?: string): void {
  const errors = server.getErrors();
  assertEquals(errors.length, 0, message ?? `Should have no server errors:\n${errors.join("\n")}`);
}

/**
 * Assert no React errors in server logs.
 */
export function assertNoServerReactErrors(server: TestServer): void {
  const reactErrors = server.logs.filter(
    (l) => l.includes("Invalid hook call") || l.includes("more than one copy of React"),
  );
  assertEquals(
    reactErrors.length,
    0,
    `Should have no React errors in logs:\n${reactErrors.join("\n")}`,
  );
}

/**
 * Assert no module errors in server logs.
 */
export function assertNoServerModuleErrors(server: TestServer): void {
  const moduleErrors = server.logs.filter(
    (l) =>
      l.includes("Missing module") ||
      l.includes("Module not found") ||
      l.includes("esm.sh/_vf_modules"),
  );
  assertEquals(
    moduleErrors.length,
    0,
    `Should have no module errors in logs:\n${moduleErrors.join("\n")}`,
  );
}

// ============================================================================
// Framework Import Assertions
// ============================================================================

/**
 * Assert veryfront/head import works correctly.
 */
export function assertHeadWorks(html: string): void {
  assertNoCriticalErrors(html);
  // Head components typically inject title/meta which won't be visible in body
  // But we can check that the page renders without errors
}

/**
 * Assert veryfront/router import works correctly.
 */
export function assertRouterWorks(html: string): void {
  assertNoCriticalErrors(html);
  // Router should be functional - page should render
}

/**
 * Assert veryfront/context import works correctly.
 */
export function assertContextWorks(html: string): void {
  assertNoCriticalErrors(html);
}

// ============================================================================
// Compound Assertions (BDD-style)
// ============================================================================

/**
 * BDD-style assertion builder for pages.
 *
 * Usage:
 *   expectPage(html)
 *     .toRender()
 *     .withElement("my-component")
 *     .withText("Hello World")
 *     .withoutErrors()
 */
export function expectPage(html: string, response?: Response) {
  return {
    toRender() {
      if (response) {
        assertOk(response);
      }
      return this;
    },
    withElement(id: string) {
      assertHasElement(html, id);
      return this;
    },
    withText(text: string) {
      assertHasText(html, text);
      return this;
    },
    withoutText(text: string) {
      assertNoText(html, text);
      return this;
    },
    withLayout(id = "layout-wrapper") {
      assertLayoutRendered(html, id);
      return this;
    },
    withAppProvider(id = "app-wrapper") {
      assertAppProviderRendered(html, id);
      return this;
    },
    withoutErrors() {
      assertNoCriticalErrors(html);
      return this;
    },
    withoutModuleErrors() {
      assertNoModuleErrors(html);
      return this;
    },
    withoutReactErrors() {
      assertNoReactErrors(html);
      return this;
    },
  };
}

/**
 * BDD-style assertion builder for servers.
 *
 * Usage:
 *   expectServer(server)
 *     .withoutErrors()
 *     .withoutReactErrors()
 */
export function expectServer(server: TestServer) {
  return {
    withoutErrors() {
      assertNoServerErrors(server);
      return this;
    },
    withoutReactErrors() {
      assertNoServerReactErrors(server);
      return this;
    },
    withoutModuleErrors() {
      assertNoServerModuleErrors(server);
      return this;
    },
  };
}

/**
 * BDD-style assertion builder for API responses.
 *
 * Usage:
 *   expectApi(response, json)
 *     .toBeOk()
 *     .toBeJson()
 *     .toHaveProperty("message", "Hello")
 */
export function expectApi<T extends Record<string, unknown>>(response: Response, json: T) {
  return {
    toBeOk() {
      assertOk(response);
      return this;
    },
    toBeStatus(status: number) {
      assertStatus(response, status);
      return this;
    },
    toBeJson() {
      assertJsonContentType(response);
      return this;
    },
    toHaveProperty<K extends keyof T>(key: K, value?: T[K]) {
      assert(key in json, `Expected property "${String(key)}" to exist`);
      if (value !== undefined) {
        assertEquals(json[key], value, `Expected ${String(key)} to be ${String(value)}`);
      }
      return this;
    },
  };
}
