import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseCliArgs } from "#cli/shared/args";
import { buildUrl, parseOpenArgs } from "./command.ts";
import { createSuccessEnvelope } from "../../shared/json-output.ts";

function assertSuccess<T extends { success: boolean; data?: unknown }>(
  result: T,
): asserts result is T & { success: true; data: NonNullable<T["data"]> } {
  assertEquals(result.success, true);
}

describe("Open Command", () => {
  describe("buildUrl", () => {
    it("builds dashboard URL", () => {
      const url = buildUrl("my-app", { studio: false });
      assertEquals(url, "https://veryfront.com/projects/my-app");
    });

    it("builds studio URL", () => {
      const url = buildUrl("my-app", { studio: true });
      assertEquals(url, "https://veryfront.com/studio/my-app");
    });

    it("builds environment URL", () => {
      const url = buildUrl("my-app", { env: "staging", studio: false });
      assertEquals(
        url,
        "https://veryfront.com/projects/my-app/environments/staging",
      );
    });

    it("studio flag takes precedence over env", () => {
      const url = buildUrl("my-app", { env: "staging", studio: true });
      assertEquals(url, "https://veryfront.com/studio/my-app");
    });

    it("uses project slug with --project-slug override", () => {
      const url = buildUrl("custom-slug", { studio: false });
      assertEquals(url, "https://veryfront.com/projects/custom-slug");
    });
  });

  describe("JSON output", () => {
    it("creates envelope with URL", () => {
      const url = buildUrl("my-app", { studio: false });
      const envelope = createSuccessEnvelope("open", { url });
      assertEquals(envelope.success, true);
      assertEquals(envelope.command, "open");
      assertEquals(envelope.data.url, "https://veryfront.com/projects/my-app");
    });
  });

  describe("parseOpenArgs", () => {
    it("parses -p as project slug from raw open argv", () => {
      const result = parseOpenArgs(parseCliArgs(["open", "-p", "my-project"]));
      assertSuccess(result);
      assertEquals(result.data.projectSlug, "my-project");
    });
  });
});
