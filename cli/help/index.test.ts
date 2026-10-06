import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { COMMAND_CATEGORIES, getStructuredCommandHelp, getStructuredMainHelp } from "./index.ts";

describe("structured CLI help", () => {
  it("returns complete command help for direct command names", () => {
    const help = getStructuredCommandHelp("deploy");

    assertEquals(help?.name, "deploy");
    assertEquals(help?.category, "deploy");
    assertEquals(help?.usage.includes("veryfront deploy"), true);
    assertEquals(Array.isArray(help?.options), true);
    assertEquals((help?.examples.length ?? 0) > 0, true);
    assertEquals(Array.isArray(help?.notes), true);
    assertEquals(Array.isArray(help?.aliases), true);
  });

  it("resolves aliases to the canonical command help", () => {
    const generate = getStructuredCommandHelp("g");
    const project = getStructuredCommandHelp("projects");
    const serve = getStructuredCommandHelp("preview");

    assertEquals(generate?.name, "generate");
    assertEquals(generate?.aliases, ["g"]);
    assertEquals(project?.name, "project");
    assertEquals(project?.aliases, ["projects"]);
    assertEquals(serve?.name, "serve");
    assertEquals(serve?.aliases, ["preview"]);
  });

  it("returns null for unknown commands", () => {
    assertEquals(getStructuredCommandHelp("does-not-exist"), null);
  });

  it("omits hidden commands from main help by default", () => {
    const help = getStructuredMainHelp();
    const commandNames = help.commands.map((command) => command.name);

    assertEquals(help.usage, "veryfront <command> [options]");
    assertEquals(help.showAll, false);
    assertEquals(commandNames.includes("deploy"), true);
    assertEquals(commandNames.includes("lock"), false);
    assertEquals(commandNames.includes("completions"), false);
  });

  it("includes hidden commands when showAll is requested", () => {
    const help = getStructuredMainHelp(true);
    const lock = help.commands.find((command) => command.name === "lock");

    assertEquals(help.showAll, true);
    assertEquals(lock?.hidden, true);
  });

  it("serializes category labels and static guidance for JSON help", () => {
    const help = getStructuredMainHelp();

    assertEquals(
      help.categories.map((category) => category.value),
      COMMAND_CATEGORIES,
    );
    assertEquals(
      help.categories.find((category) => category.value === "ai")?.label,
      "AI & Automation",
    );
    assertEquals(help.globalOptions.some((option) => option.flag === "--json"), true);
    assertEquals(help.quickStart, ["veryfront init my-app", "cd my-app", "veryfront dev"]);
    assertEquals(help.previewDeploy, ["veryfront push", "veryfront deploy"]);
    assertEquals(help.codingAgents.at(-1), {
      label: "Schema",
      description: "veryfront schema --json",
    });
  });
});
