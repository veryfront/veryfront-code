import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getDevServerCommand } from "./template-runtime-e2e.ts";
import {
  getDevServerEnvironment,
  inspectModuleExports,
} from "./runtime-e2e-helpers.ts";

describe("template runtime E2E commands", () => {
  it("exports the shared harness without running the E2E flow on import", async () => {
    assertEquals(
      await inspectModuleExports(
        new URL("./template-runtime-e2e.ts", import.meta.url),
        "template runtime",
      ),
      [
        "assertCondition",
        "ensureCommand",
        "getDevServerCommand",
        "installDependencies",
        "packNpmPackage",
        "parseCommaSeparatedFlag",
        "runChecked",
        "scaffoldProject",
        "startDevServer",
        "stopDevServer",
        "waitForRoute",
      ],
      "Template runtime module should export only shared harness helpers on import",
    );
  });

  it("passes the selected port through Deno task without a separator", () => {
    assertEquals(
      getDevServerCommand("deno", 4321),
      {
        command: "deno",
        args: ["task", "dev", "--port", "4321"],
      },
      "Deno dev command should pass the selected port directly to the task",
    );
  });

  it("preserves the script argument separator for npm and Bun", () => {
    assertEquals(
      getDevServerCommand("node", 4321),
      {
        command: "npm",
        args: ["run", "dev", "--", "--port", "4321"],
      },
      "Node dev command should preserve npm's script argument separator",
    );
    assertEquals(
      getDevServerCommand("bun", 4321),
      {
        command: "bun",
        args: ["run", "dev", "--", "--port", "4321"],
      },
      "Bun dev command should preserve Bun's script argument separator",
    );
  });

  it("merges child-only environment overrides with deterministic defaults", () => {
    assertEquals(
      getDevServerEnvironment({
        ANTHROPIC_API_KEY: "test-key",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:4312/v1",
      }),
      {
        ANTHROPIC_API_KEY: "test-key",
        GOOGLE_API_KEY: "",
        GOOGLE_GENERATIVE_AI_API_KEY: "",
        LOG_FORMAT: "text",
        MISTRAL_API_KEY: "",
        NODE_ENV: "development",
        OPENAI_API_KEY: "",
        REVALIDATION_PER_PROJECT_LIMIT: "0",
        SSR_TRANSFORM_PER_PROJECT_LIMIT: "0",
        VF_DISABLE_LRU_INTERVAL: "1",
        VERYFRONT_API_TOKEN: "",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:4312/v1",
      },
      "Dev server environment should blank competing credentials and isolate scenario overrides in the child process",
    );
  });
});
