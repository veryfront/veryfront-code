/**
 * Docs contract: every `veryfront install ...` command printed in the published
 * guide set must actually select the AI-tool target the surrounding prose
 * promises. "Published" means the same three directories the sibling docs
 * contracts scan (`guide-contracts.test.ts`, `guide-code-examples.test.ts`):
 * getting-started, guides, concepts. Generated pages (`docs/api-reference`) and
 * unpublished notes (`docs/internal`, `docs/rfcs`, `docs/evidence`) are out of
 * scope — they may quote a broken invocation deliberately.
 *
 * The install command takes its target from `--target` or from the first
 * positional argument (`veryfront install agents`). A command line that selects
 * neither falls back to auto-detection, which in a fresh project writes
 * `SKILL.md` instead of the `AGENTS.md` the docs describe.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseCliArgs } from "../../cli/shared/args.ts";
import { parseInstallArgs } from "../../cli/commands/install/handler.ts";
import { parseTargetFlag } from "../../cli/commands/install/install.ts";
import { getToolById } from "../../cli/commands/install/registry.ts";

const DOC_DIRS = ["docs/getting-started", "docs/guides", "docs/concepts"] as const;

interface DocumentedInstall {
  file: string;
  command: string;
}

async function listDocFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      files.push(...await listDocFiles(path));
    } else if (entry.isFile && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

/** Collect `veryfront install ...` lines from fenced shell blocks. */
function extractInstallCommands(file: string, source: string): DocumentedInstall[] {
  const found: DocumentedInstall[] = [];
  let inShellFence = false;

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim().toLowerCase();
      inShellFence = inShellFence ? false : lang === "bash" || lang === "sh" || lang === "shell";
      continue;
    }

    if (!inShellFence) continue;
    if (!line.startsWith("veryfront install")) continue;

    found.push({ file, command: line });
  }

  return found;
}

async function collectDocumentedInstalls(): Promise<DocumentedInstall[]> {
  const commands: DocumentedInstall[] = [];
  for (const dir of DOC_DIRS) {
    for (const file of await listDocFiles(dir)) {
      commands.push(...extractInstallCommands(file, await Deno.readTextFile(file)));
    }
  }
  return commands.sort((a, b) => a.command.localeCompare(b.command));
}

/** Run a documented command line through the real CLI parsing pipeline. */
function resolveTargets(command: string): string[] {
  const argv = command.replace(/^veryfront\s+/, "").split(/\s+/).filter(Boolean);
  const parsed = parseInstallArgs(parseCliArgs(argv));

  assert(parsed.success, `\`${command}\` failed argument validation`);
  if (parsed.data.target === undefined) return [];

  return parseTargetFlag(parsed.data.target);
}

describe("docs: veryfront install commands", () => {
  it("every documented install command selects a target non-interactively", async () => {
    const documented = await collectDocumentedInstalls();
    assert(documented.length > 0, "expected the docs to document `veryfront install`");

    const ignored = documented.filter(({ command }) => resolveTargets(command).length === 0);

    assertEquals(
      ignored.map(({ file, command }) => `${file}: ${command}`),
      [],
      "these documented commands pass a target the CLI ignores; use `--target <id>`",
    );
  });

  it("the pages that promise AGENTS.md document a command that writes AGENTS.md", async () => {
    const pages = ["docs/getting-started/installation.md", "docs/guides/coding-agents.md"];

    for (const page of pages) {
      const source = await Deno.readTextFile(page);
      assert(source.includes("AGENTS.md"), `${page} should describe AGENTS.md`);

      const files = extractInstallCommands(page, source)
        .flatMap(({ command }) => resolveTargets(command))
        .map((id) => getToolById(id).file);

      assert(
        files.includes("AGENTS.md"),
        `${page} promises AGENTS.md but documents no install command that writes it (writes: ${
          files.join(", ") || "nothing"
        })`,
      );
    }
  });
});
