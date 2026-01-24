import { assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";

const denoOnlyDescribe = isDeno ? describe : describe.skip;

denoOnlyDescribe("demo command integration", () => {
  async function runDemo(args: string[] = []): Promise<{ code: number; output: string }> {
    const cliPath = new URL("../../main.ts", import.meta.url).pathname;
    const command = new Deno.Command("deno", {
      args: ["run", "--allow-all", cliPath, "demo", ...args],
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
    });

    const { code, stdout, stderr } = await command.output();
    const decoder = new TextDecoder();
    const output = decoder.decode(stdout) + decoder.decode(stderr);

    return { code, output };
  }

  async function assertHelpIncludes(...includes: string[]): Promise<void> {
    const { output } = await runDemo(["--help"]);
    for (const text of includes) assertStringIncludes(output, text);
  }

  describe("--help flag", () => {
    it("should display help information", async () => {
      await assertHelpIncludes("veryfront demo", "Interactive guided tour");
    });

    it("should show --auto option in help", async () => {
      await assertHelpIncludes("--auto", "Auto-advance");
    });

    it("should show --login option in help", async () => {
      await assertHelpIncludes("--login", "google", "github", "microsoft", "token");
    });

    it("should show examples in help", async () => {
      await assertHelpIncludes("Examples:", "my-first-app");
    });
  });

  describe("non-TTY behavior", () => {
    it("should exit gracefully when not in TTY", async () => {
      const { output } = await runDemo([]);
      assertStringIncludes(output, "interactive terminal");
    });

    it("should exit gracefully with --auto flag when not in TTY", async () => {
      const { output } = await runDemo(["--auto"]);
      assertStringIncludes(output, "interactive terminal");
    });

    it("should exit gracefully with --auto and --login flags when not in TTY", async () => {
      const { output } = await runDemo(["--auto", "--login", "google"]);
      assertStringIncludes(output, "interactive terminal");
    });
  });

  describe("command-line argument parsing", () => {
    it("should accept project name argument", async () => {
      const { output } = await runDemo(["my-custom-project"]);
      assertStringIncludes(output, "interactive terminal");
    });

    it("should accept --auto flag with project name", async () => {
      const { output } = await runDemo(["test-project", "--auto"]);
      assertStringIncludes(output, "interactive terminal");
    });

    it("should accept all login methods", async () => {
      for (const method of ["google", "github", "microsoft", "token"]) {
        const { output } = await runDemo(["--auto", "--login", method]);
        assertStringIncludes(output, "interactive terminal");
      }
    });
  });
});
