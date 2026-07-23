import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { createMockAdapter } from "#veryfront/platform";
import { discoverWebhooks } from "./discovery.ts";

describe(
  "webhook discovery",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it("normalizes raw exports into detached complete definitions", async () => {
      const adapter = createMockAdapter();
      await adapter.fs.mkdir("/project/webhooks", { recursive: true });
      await adapter.fs.writeFile(
        "/project/webhooks/ticket.ts",
        [
          "export default {",
          '  id: "ticket-created",',
          '  target: { kind: "workflow", id: "escalate-ticket" },',
          '  eventFilter: { mode: "all", conditions: [',
          '    { path: "$.type", operator: "equals", value: { type: "ticket.created" } },',
          "  ] },",
          "};",
        ].join("\n"),
      );

      const result = await discoverWebhooks({ projectDir: "/project", adapter });

      assertEquals(result.errors, []);
      assertEquals(result.items, [{
        id: "ticket-created",
        target: { kind: "workflow", id: "escalate-ticket" },
        eventFilter: {
          mode: "all",
          conditions: [{
            path: "$.type",
            operator: "equals",
            value: { type: "ticket.created" },
          }],
        },
      }]);
      assertEquals(
        Object.getPrototypeOf(result.items[0]?.eventFilter?.conditions[0]?.value),
        null,
      );
    });

    it("reports incomplete raw definitions as contained source errors", async () => {
      const adapter = createMockAdapter();
      await adapter.fs.mkdir("/project/webhooks", { recursive: true });
      await adapter.fs.writeFile(
        "/project/webhooks/agent.ts",
        'export default { id: "agent-event", target: { kind: "agent", id: "assistant" } };',
      );

      const result = await discoverWebhooks({ projectDir: "/project", adapter });

      assertEquals(result.items, []);
      assertEquals(
        result.errors.map((error) => ({
          code: error.code,
          sourcePath: error.sourcePath,
        })),
        [{ code: "invalid_definition", sourcePath: "webhooks/agent.ts" }],
      );
    });

    it("rejects malformed options without invoking accessors", async () => {
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

      const accessorError = await assertRejects(
        () => discoverWebhooks(options as never),
        VeryfrontError,
      );
      assertEquals(accessorError.slug, "webhook-config-invalid");
      assertEquals(reads, 0);

      const invalidPath = await assertRejects(
        () => discoverWebhooks({ projectDir: "", adapter }),
        VeryfrontError,
      );
      assertEquals(invalidPath.slug, "webhook-config-invalid");
    });

    it("propagates cancellation instead of containing it as a source error", async () => {
      const adapter = createMockAdapter();
      const controller = new AbortController();
      controller.abort();

      await assertRejects(
        () =>
          discoverWebhooks({
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
