# Regression Tests

This directory contains regression tests for bugs that have been discovered and fixed.
Each test should prevent the bug from reoccurring in future releases.

## Test Naming Convention

Files should be named with the pattern: `YYYY-MM-DD-short-description.test.ts`

Examples:

- `2026-01-31-relative-import-bug.test.ts`
- `2026-01-30-missing-http-bundles.test.ts`

## Test Structure

Each regression test should include:

1. **Bug metadata** - Reference to the original issue, PR, or commit
2. **Root cause description** - What caused the bug
3. **Reproduction steps** - Minimal setup to trigger the bug
4. **Verification** - What to check to ensure the fix works

## Template

```typescript
/**
 * Regression Test: [Short Description]
 *
 * Bug: [Brief description of the bug]
 * Fixed: [Date]
 * Commit: [Commit hash if available]
 * Related: [Issue/PR links if available]
 *
 * Root Cause:
 *   [Explanation of what caused the bug]
 *
 * Reproduction:
 *   [Steps to reproduce the bug]
 *
 * Fix:
 *   [Brief explanation of the fix]
 */

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createProject,
  ensureBinaryCompiled,
  expectPage,
  expectServer,
  fetchPage,
  withServer,
} from "../setup/index.ts";

describe(
  "Regression: [Short Description]",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    beforeAll(async () => {
      await ensureBinaryCompiled();
    });

    it("should [expected behavior that was broken]", async () => {
      const projectDir = await createProject(
        "regression-test-name",
        `
// Page content that reproduces the bug scenario
export default function Home() {
  return <div id="content">Test</div>;
}
`,
        {
          files: {
            // Additional files needed to reproduce
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withoutErrors();

        expectServer(server)
          .withoutErrors();
      });
    });
  },
);
```
