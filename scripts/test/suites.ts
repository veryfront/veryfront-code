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
    runner: "playwright",
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
    for (const selector of suite.pathSelectors) {
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
