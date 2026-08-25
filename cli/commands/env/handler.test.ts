import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ParsedArgs } from "#cli/shared/types";
import { setJsonMode } from "../../shared/json-output.ts";
import type { EnvironmentTokenDependencies } from "./command.ts";
import { handleEnvCommand } from "./handler.ts";

const dependencies: EnvironmentTokenDependencies = {
  resolveConfig: () =>
    Promise.resolve({
      apiUrl: "https://control.example.test/api",
      apiToken: "test-api-key",
      projectSlug: "my-project",
    }),
  createControlPlane: () => ({
    getProject: () => Promise.resolve({ id: "project-id", slug: "my-project" }),
    createEnvironmentAccessToken: () =>
      Promise.resolve({ accessToken: "bound-token", expiresIn: 300 }),
  }),
};

async function captureConsole(fn: () => Promise<void>): Promise<{
  stdout: string[];
  stderr: string[];
}> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  console.log = (...args: unknown[]) => stdout.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => stderr.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => stderr.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }
  return { stdout, stderr };
}

describe("handleEnvCommand", () => {
  it("prints only the token in human mode, including with --verbose", async () => {
    setJsonMode(false);

    const output = await captureConsole(() =>
      handleEnvCommand(
        { _: ["env", "token"], env: "production", verbose: true } as ParsedArgs,
        dependencies,
      )
    );

    assertEquals(output, { stdout: ["bound-token"], stderr: [] });
  });

  it("prints the standard JSON envelope with the API expiry", async () => {
    setJsonMode(true);
    try {
      const output = await captureConsole(() =>
        handleEnvCommand(
          { _: ["env", "token"], env: "production", json: true } as ParsedArgs,
          dependencies,
        )
      );

      assertEquals(output.stderr, []);
      assertEquals(output.stdout.length, 1);
      const [jsonOutput] = output.stdout;
      assertExists(jsonOutput);
      assertEquals(JSON.parse(jsonOutput), {
        success: true,
        command: "env",
        data: {
          access_token: "bound-token",
          expires_in: 300,
        },
      });
    } finally {
      setJsonMode(false);
    }
  });

  it("rejects an unknown subcommand as a usage error", async () => {
    const error = await assertRejects(() =>
      handleEnvCommand({ _: ["env", "tokens"] } as ParsedArgs, dependencies)
    );

    assertStringIncludes(String(error), "Unknown env subcommand: tokens");
    assertEquals((error as { exitCode?: number }).exitCode, 2);
  });

  it("requires the token subcommand", async () => {
    const error = await assertRejects(() =>
      handleEnvCommand({ _: ["env"] } as ParsedArgs, dependencies)
    );

    assertStringIncludes(String(error), "Environment subcommand is required");
    assertEquals((error as { exitCode?: number }).exitCode, 2);
  });
});
