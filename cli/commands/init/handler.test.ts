import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseCliArgs } from "../../shared/args.ts";
import { parseInitArgs } from "./handler.ts";

describe("cli/commands/init/handler", () => {
  it("rejects unknown options instead of silently using defaults", () => {
    const result = parseInitArgs(
      parseCliArgs(["init", "my-app", "--templat", "minimal"]),
    );

    assertEquals(result.success, false);
    if (!result.success) {
      assertEquals(
        result.error.message,
        "Unknown option --templat. Did you mean --template?",
      );
    }
  });

  it("parses documented init options", () => {
    const result = parseInitArgs(
      parseCliArgs([
        "init",
        "my-app",
        "--template",
        "minimal",
        "--runtime",
        "deno",
        "--skip-install",
        "--skip-env-prompt",
        "--force",
      ]),
    );

    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data, {
        name: "my-app",
        template: "minimal",
        runtime: "deno",
        skipInstall: true,
        skipEnvPrompt: true,
        deploy: false,
        force: true,
      });
    }
  });
});
