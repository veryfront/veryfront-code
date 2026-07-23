import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { createMockAdapter } from "#veryfront/platform";
import { discoverSchedules } from "./discovery.ts";

describe(
  "schedule discovery",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it("normalizes raw canonical exports into detached definitions", async () => {
      const adapter = createMockAdapter();
      await adapter.fs.mkdir("/project/schedules", { recursive: true });
      await adapter.fs.writeFile(
        "/project/schedules/daily.ts",
        [
          "export default {",
          '  id: "daily-triage",',
          '  schedule: "0 8 * * *",',
          '  target: { kind: "task", id: "sync-helpdesk" },',
          '  input: { queue: "priority" },',
          "};",
        ].join("\n"),
      );

      const result = await discoverSchedules({ projectDir: "/project", adapter });

      assertEquals(result.errors, []);
      assertEquals(result.items, [{
        id: "daily-triage",
        schedule: "0 8 * * *",
        target: { kind: "task", id: "sync-helpdesk" },
        input: { queue: "priority" },
      }]);
      assertEquals(Object.getPrototypeOf(result.items[0]?.input), null);
    });

    it("rejects accessor-backed options without invoking them", async () => {
      const adapter = createMockAdapter();
      let reads = 0;
      const options = { adapter };
      Object.defineProperty(options, "projectDir", {
        enumerable: true,
        get() {
          reads += 1;
          return "/project";
        },
      });

      const error = await assertRejects(
        () => discoverSchedules(options as never),
        VeryfrontError,
      );
      assertEquals(error.slug, "schedule-config-invalid");
      assertEquals(reads, 0);
    });

    it("uses schedule configuration errors for malformed discovery options", async () => {
      const adapter = createMockAdapter();

      const error = await assertRejects(
        () => discoverSchedules({ projectDir: "", adapter }),
        VeryfrontError,
      );

      assertEquals(error.slug, "schedule-config-invalid");
    });

    it("propagates cancellation instead of converting it into a discovery error", async () => {
      const adapter = createMockAdapter();
      const controller = new AbortController();
      controller.abort();

      await assertRejects(
        () =>
          discoverSchedules({
            projectDir: "/project",
            adapter,
            signal: controller.signal,
          }),
        DOMException,
        "aborted",
      );
    });
  },
);
