import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
  refreshLoggerConfig,
} from "#veryfront/utils/logger/logger.ts";
import { invalidateProjectCaches } from "./cache-invalidation.ts";

describe("server/context/cache-invalidation", () => {
  afterEach(() => {
    __resetLogRecordEmitterForTests();
  });

  it("does not log project, branch, or changed-path identifiers", async () => {
    const previousLevel = Deno.env.get("LOG_LEVEL");
    Deno.env.set("LOG_LEVEL", "DEBUG");
    refreshLoggerConfig();
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));

    try {
      await invalidateProjectCaches(
        "private-project-slug",
        ["private-source/customer-page.tsx"],
        {
          projectId: "private-project-id",
          environment: "preview",
          branchId: "private-branch-id",
        },
      );

      const invalidationEntries = entries.filter((entry) =>
        entry.component === "cache-invalidation"
      );
      assert(invalidationEntries.length > 0);
      const serialized = JSON.stringify(invalidationEntries);
      for (
        const privateValue of [
          "private-project-slug",
          "private-project-id",
          "private-source/customer-page.tsx",
          "private-branch-id",
        ]
      ) {
        assertEquals(serialized.includes(privateValue), false);
      }
      assert(
        invalidationEntries.some((entry) => entry.context?.changedPathCount === 1),
      );
      assert(
        invalidationEntries.some((entry) => typeof entry.context?.entriesDeleted === "number"),
      );
    } finally {
      if (previousLevel === undefined) Deno.env.delete("LOG_LEVEL");
      else Deno.env.set("LOG_LEVEL", previousLevel);
      refreshLoggerConfig();
    }
  });
});
