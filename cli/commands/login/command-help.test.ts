import "#veryfront/schemas/_test-setup.ts";
import { assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { showCommandHelp } from "../../help/command-help.ts";

function captureConsoleLog(run: () => void): string {
  const output: string[] = [];
  const originalLog = console.log;
  try {
    console.log = (msg?: unknown, ...rest: unknown[]) => {
      output.push(String(msg), ...rest.map(String));
    };
    run();
  } finally {
    console.log = originalLog;
  }
  return output.join("\n");
}

describe("cli/commands/login/command-help", () => {
  it("documents that explicit login methods are unavailable in JSON mode", () => {
    const output = captureConsoleLog(() => showCommandHelp("login"));

    assertStringIncludes(output, "veryfront login --google");
    assertStringIncludes(output, "--json");
    assertStringIncludes(output, "usage error");
  });

  it("documents shell-token precedence when switching accounts", () => {
    const output = captureConsoleLog(() => showCommandHelp("login"));

    assertStringIncludes(output, "VERYFRONT_API_TOKEN");
    assertStringIncludes(output, "unset or replace");
  });
});
