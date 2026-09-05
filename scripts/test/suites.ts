/**
 * Environment every Deno-run test process receives. This prefix used to be
 * retyped on roughly ten deno.json task lines and again as object literals in
 * run-test-file.ts and coverage-ci.ts; the copies had already started to
 * drift, so the runners now read this single constant and the task lines
 * carry no environment at all.
 */
export const DENO_TEST_ENV: Readonly<Record<string, string>> = Object.freeze({
  DENO_TESTING: "1",
  VF_DISABLE_LRU_INTERVAL: "1",
  SSR_TRANSFORM_PER_PROJECT_LIMIT: "0",
  REVALIDATION_PER_PROJECT_LIMIT: "0",
  NODE_ENV: "production",
  LOG_FORMAT: "text",
});

/** Unit-only environment enabling the first-party offline React transport. */
export const UNIT_DENO_TEST_ENV: Readonly<Record<string, string>> = Object
  .freeze({
    ...DENO_TEST_ENV,
    VERYFRONT_TEST_OFFLINE_REACT: "1",
  });

export const LOOPBACK_ALLOW_NET =
  "--allow-net=127.0.0.1,localhost,0.0.0.0,[::1],[::]";

export const LOOPBACK_TEST_PERMISSIONS: readonly string[] = Object.freeze([
  "--allow-read",
  "--allow-write",
  "--allow-env",
  // Unit tests are trusted code. Deno does not apply parent network grants to
  // spawned executables, so OS-level child-process egress isolation is a
  // separate boundary; provider credentials are still removed from child env.
  "--allow-run",
  "--allow-sys",
  "--allow-ffi",
  LOOPBACK_ALLOW_NET,
]);

const DENO_PERMISSION_SHORT_FLAGS = new Set([
  "-A",
  "-E",
  "-I",
  "-N",
  "-P",
  "-R",
  "-S",
  "-W",
]);

/** Return whether forwarded Deno arguments can alter process permissions. */
export function hasDenoPermissionFlag(args: readonly string[]): boolean {
  for (const arg of args) {
    if (arg === "--") return false;
    const name = arg.split("=", 1)[0]!;
    if (
      DENO_PERMISSION_SHORT_FLAGS.has(name) ||
      /^--(?:allow|deny)(?:-|$)/.test(name)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Live inference providers no test process may reach. Lanes that record
 * against live services on purpose (test:record, test:tool-search-live,
 * test:local-inference) do not run through the suite runner and stay exempt.
 */
export const PROVIDER_EGRESS_HOSTS: readonly string[] = Object.freeze([
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.mistral.ai",
  "api.groq.com",
  "api.deepseek.com",
  "openrouter.ai",
  "mcp.context7.com",
]);

export const PROVIDER_EGRESS_DENY_NET = `--deny-net=${
  PROVIDER_EGRESS_HOSTS.join(",")
}`;

/** Provider credentials and endpoint overrides ordinary test lanes must not inherit. */
export const PROVIDER_ENV_KEYS: readonly string[] = Object.freeze([
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_BASE_URL",
  "VERYFRONT_API_URL",
  "VERYFRONT_PUBLIC_API_BASE_URL",
  "VERYFRONT_PROJECT_SLUG",
  "AG_UI_EVAL_PROJECT_SLUG",
  "TENANT_PROJECT_SLUG",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_GEMINI_BASE_URL",
  "MISTRAL_API_KEY",
  "MISTRAL_BASE_URL",
  "GROQ_API_KEY",
  "GROQ_BASE_URL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "CONTEXT7_API_KEY",
]);

// Git's repository-local environment (git rev-parse --local-env-vars) must not
// follow a pre-push hook into the independent repositories created by tests.
const GIT_REPOSITORY_ENV_KEYS: readonly string[] = Object.freeze([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_DIR",
  "GIT_GRAFT_FILE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_INTERNAL_SUPER_PREFIX",
  "GIT_NAMESPACE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
  "GIT_WORK_TREE",
]);

export function buildTestProcessEnv(
  parentEnv: Readonly<Record<string, string>>,
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env = { ...parentEnv, ...overrides };
  // Windows environment names are case-insensitive, so a credential inherited
  // as OpenAI_Api_Key would survive an exact-case delete. Match by folded name.
  const scrubbed = new Set<string>([
    ...PROVIDER_ENV_KEYS,
    ...GIT_REPOSITORY_ENV_KEYS,
  ]);
  for (const key of Object.keys(env)) {
    const normalizedKey = key.toUpperCase();
    // Hooks export Git repository selectors. Fixture Git commands must discover
    // their own repository from cwd, never reconfigure the checkout being pushed.
    if (
      scrubbed.has(normalizedKey) ||
      /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(normalizedKey)
    ) {
      delete env[key];
    }
  }
  return env;
}

export type TestLevel = "unit" | "integration" | "e2e";

export type TestRunner = "deno" | "node" | "bun" | "playwright";

export type LeafTestSuiteId = "unit" | "integration" | "e2e" | "runtime";

export interface RuntimeVariant {
  readonly id: "node" | "bun";
  readonly runner: Exclude<TestRunner, "deno" | "playwright">;
  readonly owner: string;
}

export interface LeafTestSuite {
  readonly id: LeafTestSuiteId;
  readonly level: TestLevel;
  readonly pathSelectors: readonly string[];
  readonly runner: TestRunner;
  readonly prOwner: string;
  readonly scheduledOwner?: string;
  readonly supportExclusions: readonly string[];
  readonly runtimeVariants?: readonly RuntimeVariant[];
}

export interface ResolvedLeafSuiteOwner {
  readonly level: TestLevel;
  readonly suite: LeafTestSuiteId;
  readonly runner: TestRunner;
}

export const TEST_SUPPORT_EXCLUSIONS = Object.freeze([
  "tests/**/fixtures/**",
  "tests/**/support/**",
]);

export const LEAF_TEST_SUITES: readonly LeafTestSuite[] = Object.freeze([
  {
    id: "unit",
    level: "unit",
    pathSelectors: [
      "src/",
      "cli/",
      "extensions/",
      "templates/",
      "scripts/",
      "react/",
    ],
    runner: "deno",
    prOwner: "test-architecture",
    supportExclusions: TEST_SUPPORT_EXCLUSIONS,
  },
  {
    id: "integration",
    level: "integration",
    pathSelectors: ["tests/integration/"],
    runner: "deno",
    prOwner: "test-architecture",
    supportExclusions: TEST_SUPPORT_EXCLUSIONS,
  },
  {
    id: "e2e",
    level: "e2e",
    pathSelectors: ["tests/e2e/"],
    runner: "deno",
    prOwner: "test-architecture",
    supportExclusions: TEST_SUPPORT_EXCLUSIONS,
  },
  {
    id: "runtime",
    level: "unit",
    pathSelectors: [],
    runner: "deno",
    prOwner: "test-architecture",
    scheduledOwner: "runtime-compat",
    supportExclusions: TEST_SUPPORT_EXCLUSIONS,
    runtimeVariants: [
      { id: "node", runner: "node", owner: "runtime-compat" },
      { id: "bun", runner: "bun", owner: "runtime-compat" },
    ],
  },
]);

export function resolveLeafSuiteOwners(
  path: string,
  suites: readonly LeafTestSuite[] = LEAF_TEST_SUITES,
): ResolvedLeafSuiteOwner[] {
  const normalized = normalizeProjectPath(path);
  return suites.flatMap((suite) =>
    suite.pathSelectors
      .map(normalizeSelector)
      .filter((selector) => normalized.startsWith(selector))
      .map(() => ({
        level: suite.level,
        suite: suite.id,
        runner: suite.runner,
      }))
  );
}

export function validateLeafSuiteRegistry(
  suites: readonly LeafTestSuite[] = LEAF_TEST_SUITES,
): void {
  const seenSelectors = new Set<string>();

  for (const suite of suites) {
    readOwnDataProperty(suite, "id");
    readOwnDataProperty(suite, "level");
    readOwnDataProperty(suite, "runner");
    readOwnDataProperty(suite, "prOwner");
    const pathSelectors = readOwnDataProperty(suite, "pathSelectors");
    readOwnDataProperty(suite, "supportExclusions");

    for (const selector of pathSelectors) {
      const normalized = normalizeSelector(selector);
      if (seenSelectors.has(normalized)) {
        throw new Error(
          `Leaf suite registry has duplicate selector ${normalized}`,
        );
      }
      seenSelectors.add(normalized);

      const owners = resolveLeafSuiteOwners(
        `${normalized}owner-probe.test.ts`,
        suites,
      );
      if (owners.length > 1) {
        throw new Error(
          `Leaf suite registry has multiple canonical owners for ${normalized}: ${
            owners.map((owner) => owner.suite).join(", ")
          }`,
        );
      }
    }
  }
}

function readOwnDataProperty<K extends keyof LeafTestSuite>(
  suite: LeafTestSuite,
  key: K,
): LeafTestSuite[K] {
  const descriptor = Object.getOwnPropertyDescriptor(suite, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) {
    throw new Error(`Leaf suite record must own ${String(key)}`);
  }
  if (
    (key === "pathSelectors" || key === "supportExclusions") &&
    !Array.isArray(descriptor.value)
  ) {
    throw new Error(`Leaf suite record ${String(key)} must be an array`);
  }
  return descriptor.value as unknown as LeafTestSuite[K];
}

function normalizeSelector(selector: string): string {
  const normalized = normalizeProjectPath(selector);
  if (!normalized.endsWith("/")) {
    throw new Error(`Leaf suite selector must end with /: ${selector}`);
  }
  return normalized;
}

function normalizeProjectPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}
