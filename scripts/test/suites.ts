export type TestLevel =
  | "unit"
  | "integration"
  | "e2e"
  | "runtime"
  | "validation"
  | "docs"
  | "build"
  | "tooling";

export type TestRunner = "deno" | "node" | "bun" | "playwright";

export interface LeafTestSuite {
  readonly id:
    | "unit"
    | "integration"
    | "e2e"
    | "runtime"
    | "validation"
    | "docs"
    | "build"
    | "scripts";
  readonly level: TestLevel;
  readonly pathPrefix: string;
  readonly runner: TestRunner;
  readonly variant?: "node" | "bun";
}

export interface ResolvedLeafSuiteOwner {
  readonly level: TestLevel;
  readonly suite: LeafTestSuite["id"];
  readonly runner: TestRunner;
  readonly variant?: LeafTestSuite["variant"];
}

export const LEAF_TEST_SUITES: readonly LeafTestSuite[] = Object.freeze([
  { id: "unit", level: "unit", pathPrefix: "tests/unit/", runner: "deno" },
  {
    id: "integration",
    level: "integration",
    pathPrefix: "tests/integration/",
    runner: "deno",
  },
  { id: "e2e", level: "e2e", pathPrefix: "tests/e2e/", runner: "playwright" },
  {
    id: "runtime",
    level: "runtime",
    pathPrefix: "tests/node/",
    runner: "node",
    variant: "node",
  },
  {
    id: "runtime",
    level: "runtime",
    pathPrefix: "tests/bun/",
    runner: "bun",
    variant: "bun",
  },
  {
    id: "validation",
    level: "validation",
    pathPrefix: "tests/validation/",
    runner: "deno",
  },
  { id: "docs", level: "docs", pathPrefix: "tests/docs/", runner: "deno" },
  { id: "build", level: "build", pathPrefix: "tests/build/", runner: "deno" },
  {
    id: "scripts",
    level: "tooling",
    pathPrefix: "scripts/test/",
    runner: "deno",
  },
]);

export function resolveLeafSuiteOwners(
  path: string,
  suites: readonly LeafTestSuite[] = LEAF_TEST_SUITES,
): ResolvedLeafSuiteOwner[] {
  const normalized = normalizeProjectPath(path);
  return suites
    .filter((suite) =>
      normalized.startsWith(normalizeProjectPath(suite.pathPrefix))
    )
    .map(({ id, level, runner, variant }) => ({
      level,
      suite: id,
      ...(variant ? { variant } : {}),
      runner,
    }));
}

export function validateLeafSuiteRegistry(
  suites: readonly LeafTestSuite[] = LEAF_TEST_SUITES,
): void {
  const seenPrefixes = new Set<string>();

  for (const suite of suites) {
    const prefix = normalizeProjectPath(suite.pathPrefix);
    if (!prefix.endsWith("/")) {
      throw new Error(`Leaf suite ${suite.id} pathPrefix must end with /`);
    }
    if (seenPrefixes.has(prefix)) {
      throw new Error(`Leaf suite registry has duplicate prefix ${prefix}`);
    }
    seenPrefixes.add(prefix);

    const owners = resolveLeafSuiteOwners(
      `${prefix}owner-probe.test.ts`,
      suites,
    );
    if (owners.length > 1) {
      throw new Error(
        `Leaf suite registry has multiple canonical owners for ${prefix}: ${
          owners.map((owner) => owner.suite).join(", ")
        }`,
      );
    }
  }
}

function normalizeProjectPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}
