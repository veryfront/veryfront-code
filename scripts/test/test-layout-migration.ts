import type { TestLevel, TestRunner } from "./suites.ts";

export interface TestLayoutMigrationEntry {
  readonly id: string;
  readonly pathPrefix: string;
  readonly count: number;
  readonly level: TestLevel;
  readonly suite: "unit";
  readonly runner: TestRunner;
}

export const TEST_LAYOUT_MIGRATION_ENTRIES:
  readonly TestLayoutMigrationEntry[] = Object.freeze([
    {
      id: "src",
      pathPrefix: "src/",
      count: 1760,
      level: "unit",
      suite: "unit",
      runner: "deno",
    },
    {
      id: "cli",
      pathPrefix: "cli/",
      count: 208,
      level: "unit",
      suite: "unit",
      runner: "deno",
    },
    {
      id: "extensions",
      pathPrefix: "extensions/",
      count: 93,
      level: "unit",
      suite: "unit",
      runner: "deno",
    },
    {
      id: "scripts",
      pathPrefix: "scripts/",
      count: 56,
      level: "unit",
      suite: "unit",
      runner: "deno",
    },
    {
      id: "tests",
      pathPrefix: "tests/",
      count: 19,
      level: "unit",
      suite: "unit",
      runner: "deno",
    },
    {
      id: "templates",
      pathPrefix: "templates/",
      count: 9,
      level: "unit",
      suite: "unit",
      runner: "deno",
    },
    {
      id: "react",
      pathPrefix: "react/",
      count: 1,
      level: "unit",
      suite: "unit",
      runner: "deno",
    },
  ]);
