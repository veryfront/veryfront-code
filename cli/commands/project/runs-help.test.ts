import { assert, assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { RUNS_COMMANDS } from "./runs.ts";
import { parseCliArgs } from "../../shared/args.ts";
import { generateCommandSchema } from "../schema/command.ts";
import {
  generateBashCompletions,
  generateFishCompletions,
  generateZshCompletions,
} from "../completions/command.ts";
import { projectHelp } from "./command-help.ts";

describe("project runs discovery", () => {
  it("discovers dispatch acceptance through schema and shell completions", () => {
    assert(
      generateCommandSchema("project")?.options.some((option) =>
        option.flag === "--accept-dispatch"
      ),
    );
    for (
      const generate of [generateBashCompletions, generateZshCompletions, generateFishCompletions]
    ) {
      assert(generate().includes("accept-dispatch"));
    }
  });
  it("preserves runs and heartbeat after the boolean dispatch flag", () => {
    const parsed = parseCliArgs([
      "project",
      "--accept-dispatch",
      "runs",
      "heartbeat",
      "--run-id",
      "example",
    ]);
    assertEquals(parsed["accept-dispatch"], true);
    assertEquals(parsed._, ["project", "runs", "heartbeat"]);
    const beforeCommand = parseCliArgs(["--accept-dispatch", "project", "runs", "heartbeat"]);
    assertEquals(beforeCommand["accept-dispatch"], true);
    assertEquals(beforeCommand._, ["project", "runs", "heartbeat"]);
  });

  it("advertises SDK-backed run commands in the existing project family", () => {
    assert(projectHelp.examples?.some((example) => example.includes("project runs list")));
    for (const command of Object.values(RUNS_COMMANDS)) {
      assert(projectHelp.notes?.some((note) => note.includes(command)), command);
    }
  });
});
