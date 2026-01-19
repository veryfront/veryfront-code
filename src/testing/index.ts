/**
 * Cross-runtime testing utilities.
 *
 * Provides portable test helpers that work across Deno, Node.js, and Bun:
 *
 * - **Assertions**: assertEquals, assertExists, assertThrows, etc.
 * - **BDD**: describe, it, beforeEach, afterEach, etc.
 * - **Deno compat**: makeTempDir, makeTempFile, withTempDir, etc.
 *
 * ## Usage
 *
 * ```typescript
 * // Instead of:
 * import { assertEquals } from "@std/assert";
 * import { describe, it } from "@std/testing/bdd";
 *
 * // Use:
 * import { assertEquals } from "@veryfront/testing/assert";
 * import { describe, it } from "@veryfront/testing/bdd";
 *
 * // Or import everything from the main module:
 * import { assertEquals, describe, it, makeTempDir } from "@veryfront/testing";
 * ```
 *
 * @module
 */

// Initialize test environment before any other imports
import "./init.ts";

// ============================================================================
// Assertions
// ============================================================================

export {
  assert,
  assertEquals,
  assertExists,
  assertGreater,
  assertGreaterOrEqual,
  assertInstanceOf,
  assertLess,
  assertLessOrEqual,
  assertMatch,
  assertNotEquals,
  assertNotStrictEquals,
  assertObjectMatch,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
  fail,
} from "./assert.ts";

// ============================================================================
// Shared Utilities
// ============================================================================

export { deepEquals, safeStringify } from "./utils.ts";

// ============================================================================
// BDD Testing
// ============================================================================

export { afterAll, afterEach, beforeAll, beforeEach, describe, it, test } from "./bdd.ts";

export type { BddTestContext, TestOptions } from "./bdd.ts";

// ============================================================================
// Test Isolation Helpers
// ============================================================================

export { registerTestCleanup } from "./isolation.ts";

// ============================================================================
// Deno Compatibility (Filesystem, Process, etc.)
// ============================================================================

export {
  chmod,
  createFileSystem,
  cwd,
  delay,
  deleteEnv,
  env,
  exists,
  exit,
  getArgs,
  getEnv,
  isAlreadyExistsError,
  isNotFoundError,
  makeTempDir,
  makeTempDirWithOptions,
  makeTempFile,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  setEnv,
  stat,
  waitFor,
  withEnv,
  withTempDir,
  withTempFile,
  writeFile,
  writeTextFile,
} from "./deno-compat.ts";

// ============================================================================
// Timing Helpers
// ============================================================================

export { getTestTimeScale, scaleMs, testDelay } from "./timing.ts";

// ============================================================================
// Runtime Detection (re-export for convenience)
// ============================================================================

export { isBun, isDeno, isNode } from "../platform/compat/runtime.ts";
