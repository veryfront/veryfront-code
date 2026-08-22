import type { LeafTestSuiteId, TestLevel, TestRunner } from "./suites.ts";

export interface TestLayoutMigrationEntry {
  readonly path: string;
  readonly level: TestLevel;
  readonly suite: LeafTestSuiteId;
  readonly runner: TestRunner;
  readonly variant?: "node" | "bun";
  readonly owner: string;
  readonly removalPr: string;
}

interface MigrationGroup {
  readonly level: TestLevel;
  readonly suite: LeafTestSuiteId;
  readonly runner: TestRunner;
  readonly variant?: "node" | "bun";
  readonly owner: string;
  readonly removalPr: string;
}

export const TEST_LAYOUT_MIGRATION_ENTRIES:
  readonly TestLayoutMigrationEntry[] = Object.freeze([
    ...entries(
      [
        "tests/_helpers/context.test.ts",
        "tests/_helpers/playwright.test.ts",
        "tests/_helpers/proxy-mode.test.ts",
        "tests/embedding/vector-store.test.ts",
        "tests/ensure-npm-links.test.mjs",
        "tests/node-resolver-workspace-imports.test.ts",
        "tests/runtime-test-filters.test.ts",
        "tests/server/context/cache-invalidation.test.ts",
        "tests/server/context/request-context.test.ts",
        "tests/server/handlers/request/api/pages-api-handler.test.ts",
        "tests/test-file-utils.test.mjs",
        "tests/unit/build/compile-binary-includes.test.ts",
        "tests/unit/html/styles-builder/extract-candidates.test.ts",
        "tests/unit/invalidation-state.test.ts",
        "tests/unit/rendering/layouts/components-layout-discovery.test.ts",
        "tests/unit/transforms/http-bundler.test.ts",
        "tests/utils/id.test.ts",
        "tests/utils/singleflight.test.ts",
      ],
      {
        level: "unit",
        suite: "unit",
        runner: "deno",
        owner: "test-architecture",
        removalPr: "PR 4",
      },
    ),
    ...entries(
      [
        "tests/agent/verify-tool-search-live.test.ts",
        "tests/build/binary-source-hash.test.ts",
        "tests/build/npm-package-metadata.test.ts",
        "tests/build/prepare-framework-sources.test.ts",
        "tests/chat/agent-runtime-streaming.test.ts",
        "tests/chat/chat-handler-fallback.test.ts",
        "tests/chat/sse-line-buffer.test.ts",
        "tests/chat/use-chat-ag-ui-streaming.test.ts",
        "tests/chat/use-chat-streaming.test.ts",
        "tests/docs/cli-install-commands.test.ts",
        "tests/docs/error-docs-links.test.ts",
        "tests/docs/guide-code-examples.test.ts",
        "tests/docs/guide-content.test.ts",
        "tests/docs/guide-contracts.test.ts",
        "tests/docs/guide-examples.test.ts",
        "tests/docs/scaffold-trees.test.ts",
        "tests/validation/001-adapter-divergence/001.1-layout-discovery-unified.test.ts",
        "tests/validation/001-adapter-divergence/001.4-layout-cache-isolation.test.ts",
        "tests/validation/002-global-state/002.1-head-collector-leakage.test.ts",
        "tests/validation/002-global-state/002.4-semaphore-fairness.test.ts",
        "tests/validation/002-global-state/002.5-registry-isolation.test.ts",
        "tests/validation/002-global-state/002.5-transform-concurrency.test.ts",
        "tests/validation/002-global-state/002.8-tailwind-compiler-isolation.test.ts",
        "tests/validation/003-cache-behavior/003.1-003.3-cache-fixes.test.ts",
        "tests/validation/005-router-divergence/005.2-ssg-app-router-pages.test.ts",
        "tests/validation/009-timeout-handling/009.1-009.2-timeout-fixes.test.ts",
        "tests/validation/013-cache-key-patterns/013.2-agent-cache-isolation.test.ts",
        "tests/validation/014-deployment-modes/014.1-node-env-validation.test.ts",
      ],
      {
        level: "integration",
        suite: "integration",
        runner: "deno",
        owner: "test-architecture",
        removalPr: "PR 4",
      },
    ),
    ...entries(
      [
        "tests/bun/dynamic-alias-resolution.test.ts",
        "tests/bun/npm-protocol-resolution.test.ts",
        "tests/bun/runner-args.test.mjs",
        "tests/bun/workspace-packages.test.mjs",
        "tests/bun/workspace-resolution.test.ts",
      ],
      {
        level: "unit",
        suite: "runtime",
        runner: "bun",
        variant: "bun",
        owner: "runtime-compat",
        removalPr: "PR 5",
      },
    ),
  ]);

function entries(
  paths: readonly string[],
  group: MigrationGroup,
): readonly TestLayoutMigrationEntry[] {
  return paths.map((path) => ({ path, ...group }));
}
