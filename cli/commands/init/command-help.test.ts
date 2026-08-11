import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { showCommandHelp } from "../../help/command-help.ts";
import { initHelp } from "./command-help.ts";
import { parseRuntime } from "./runtime.ts";

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

describe("cli/commands/init/command-help", () => {
  it("documents --runtime, which the handler accepts and the docs advertise", () => {
    // `veryfront init --runtime <node|bun|deno>` works and is documented on
    // the public create-project page, but was missing from `init --help`,
    // hiding a supported flag from the CLI's own discovery surface.
    const runtimeOption = initHelp.options?.find((opt) => opt.flag.includes("--runtime"));
    assertExists(runtimeOption, "init help must document the --runtime flag");
    // Takes a value, so the arg parser classifies it as a value flag.
    assertEquals(runtimeOption.flag.includes("<"), true);
    for (const runtime of ["node", "bun", "deno"]) {
      // Every value parseRuntime accepts must be discoverable from --help.
      assertEquals(parseRuntime(runtime), runtime);
      assertStringIncludes(runtimeOption.description, runtime);
    }
  });

  it("renders --runtime in `veryfront init --help` output", () => {
    const output = captureConsoleLog(() => showCommandHelp("init"));
    assertStringIncludes(output, "--runtime");
  });
});
