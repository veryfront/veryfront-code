import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";

describe("demo command integration", () => {
  async function runDemo(args: string[] = []): Promise<{ code: number; output: string }> {
    const cliPath = new URL("../../main.ts", import.meta.url).pathname;
    const command = new Deno.Command("deno", {
      args: ["run", "--allow-all", cliPath, "demo", ...args],
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
    });
    const { code, stdout, stderr } = await command.output();
    const output = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);
    return { code, output };
  }

  describe("--help flag", () => {
    it("should display help information", async () => {
      const { output } = await runDemo(["--help"]);
      assertStringIncludes(output, "veryfront demo");
      assertStringIncludes(output, "Interactive guided tour");
    });

    it("should show --auto option in help", async () => {
      const { output } = await runDemo(["--help"]);
      assertStringIncludes(output, "--auto");
      assertStringIncludes(output, "Auto-advance");
    });

    it("should show --login option in help", async () => {
      const { output } = await runDemo(["--help"]);
      assertStringIncludes(output, "--login");
      assertStringIncludes(output, "google");
      assertStringIncludes(output, "github");
      assertStringIncludes(output, "microsoft");
      assertStringIncludes(output, "token");
    });

    it("should show examples in help", async () => {
      const { output } = await runDemo(["--help"]);
      assertStringIncludes(output, "Examples:");
      assertStringIncludes(output, "my-first-app");
    });
  });

  describe("non-TTY behavior", () => {
    it("should exit gracefully when not in TTY", async () => {
      // Without TTY, demo should exit with a message
      const { output } = await runDemo([]);
      assertStringIncludes(output, "interactive terminal");
    });

    it("should exit gracefully with --auto flag when not in TTY", async () => {
      // Even with --auto, still requires TTY
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
      // Should still fail due to non-TTY, but args are parsed
      assertStringIncludes(output, "interactive terminal");
    });

    it("should accept --auto flag with project name", async () => {
      const { output } = await runDemo(["test-project", "--auto"]);
      assertStringIncludes(output, "interactive terminal");
    });

    it("should accept all login methods", async () => {
      for (const method of ["google", "github", "microsoft", "token"]) {
        const { output } = await runDemo(["--auto", "--login", method]);
        // Should not show "unknown option" error
        assertStringIncludes(output, "interactive terminal");
      }
    });
  });
});
