// Initialize test environment before any other imports
import "./init.ts";

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

export { deepEquals, safeStringify } from "./utils.ts";

export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
  test,
} from "#veryfront/testing/bdd.ts";
export type { BddTestContext, TestOptions } from "#veryfront/testing/bdd.ts";

export { registerTestCleanup, resetAllTestState } from "./isolation.ts";

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

export { getTestTimeScale, scaleMs, testDelay } from "./timing.ts";

export { isBun, isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
