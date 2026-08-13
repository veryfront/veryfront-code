/**
 * Docs contract: the project trees printed in the getting-started pages must
 * list every file the corresponding template actually scaffolds.
 *
 * These trees are drawn as complete directory listings — no ellipsis, no
 * "partial" marker — so a reader treats them as the full scaffold. When a
 * template gains a file and the tree is not updated, the page silently starts
 * lying about what `veryfront init` produced.
 *
 * Ground truth is `templates/manifest.json` (the template's own files) plus
 * the files the init flow generates for every template regardless of choice.
 */

import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

/** Repo-relative reads, so a cwd-changing sibling test cannot break these. */
const REPO_ROOT = new URL("../../", import.meta.url);

function readRepoFile(path: string): Promise<string> {
  return Deno.readTextFile(new URL(path, REPO_ROOT));
}

/** Written by the init flow for every template, so absent from the manifest. */
const GENERATED_FILES = [".gitignore", "AGENTS.md", "package.json"] as const;

interface DocumentedTree {
  doc: string;
  /** Prose line that introduces the tree; the next fenced block is the tree. */
  marker: string;
  template: string;
}

const DOCUMENTED_TREES: DocumentedTree[] = [
  {
    doc: "docs/getting-started/create-project.md",
    marker: "The `minimal` template creates:",
    template: "minimal",
  },
  {
    doc: "docs/getting-started/create-project.md",
    marker: "The `ai-agent` template creates:",
    template: "ai-agent",
  },
];

function extractFencedBlockAfter(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  assert(markerIndex >= 0, `marker not found in doc: ${marker}`);

  const openIndex = source.indexOf("```", markerIndex);
  assert(openIndex >= 0, `no fenced block after marker: ${marker}`);

  const bodyStart = source.indexOf("\n", openIndex);
  assert(bodyStart >= 0, `unterminated fence opener after marker: ${marker}`);

  const closeIndex = source.indexOf("```", bodyStart);
  assert(closeIndex >= 0, `unterminated fenced block after marker: ${marker}`);

  return source.slice(bodyStart + 1, closeIndex);
}

/**
 * Turns an indented ASCII tree into the file paths it claims exist. Directory
 * lines end with `/`; trailing `# ...` comments are annotations, not names.
 */
function parseTree(block: string): string[] {
  const files: string[] = [];
  const stack: Array<{ indent: number; name: string }> = [];
  let sawRoot = false;

  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (line.trim() === "") continue;

    const name = line.trim();
    const indent = line.length - line.trimStart().length;

    if (!sawRoot) {
      assert(name.endsWith("/"), `tree must start at a project root: ${name}`);
      sawRoot = true;
    }

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (name.endsWith("/")) {
      stack.push({ indent, name: name.slice(0, -1) });
      continue;
    }

    // stack[0] is the project root directory, which is not part of the path.
    const prefix = stack.slice(1).map((entry) => entry.name);
    files.push([...prefix, name].join("/"));
  }

  return files.sort();
}

async function expectedFilesFor(template: string): Promise<string[]> {
  const manifest = JSON.parse(
    await readRepoFile("templates/manifest.json"),
  ) as { templates: Record<string, { files: Record<string, string> }> };

  const entry = manifest.templates[template];
  assert(entry, `template missing from manifest: ${template}`);

  return [...Object.keys(entry.files), ...GENERATED_FILES].sort();
}

describe("getting-started scaffold trees", () => {
  for (const { doc, marker, template } of DOCUMENTED_TREES) {
    it(`lists every file the ${template} template creates (${doc})`, async () => {
      const source = await readRepoFile(doc);
      const documented = parseTree(extractFencedBlockAfter(source, marker));
      const expected = await expectedFilesFor(template);

      assertEquals(
        documented,
        expected,
        `${doc}: the ${template} tree is drawn as a complete listing but does ` +
          `not match the template. Missing: ` +
          `[${expected.filter((file) => !documented.includes(file))}]. ` +
          `Not created: [${documented.filter((file) => !expected.includes(file))}].`,
      );
    });
  }
});
