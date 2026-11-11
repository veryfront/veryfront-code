/**
 * Project file access for the `coding-agent` starter, from a real folder.
 *
 * The starter's `list-files`, `read-file` and `edit-file` tools resolved every
 * path against `cwd()`. On Veryfront Cloud the process runs from the
 * runtime's own folder, which holds no project files. Without the platform
 * file operations of a hosted agent run, the tools must say so instead of
 * answering "Directory not found: app", and under `veryfront dev` they must
 * keep reading the local project folder.
 *
 * - The local file source runs against temporary directories.
 * - The shipped tools run in a child `deno` process whose working directory
 *   is a temporary folder, so no test depends on, or changes, this process's
 *   working directory. The child has no network access, loads only cached
 *   modules with the repository lockfile frozen, and writes only inside its
 *   temporary folder.
 *
 * Hosted runs are covered by the colocated unit test
 * `templates/coding-agent-file-tools.test.ts`.
 *
 * @module tests/integration/templates/coding-agent-file-tools.test
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { basename, fromFileUrl, join } from "#veryfront/compat/path/index.ts";
import { runCommand } from "#veryfront/compat/process.ts";

const TEMPLATE_DIR = new URL("../../../templates/files/coding-agent/", import.meta.url);
const TOOLS_DIR = new URL("tools/", TEMPLATE_DIR);
const LIB_URL = new URL("lib/project-files.ts", TEMPLATE_DIR);
const REPO_CONFIG = fromFileUrl(new URL("../../../deno.json", import.meta.url));
const SCHEMA_SETUP_URL = new URL("../../../src/schemas/_test-setup.ts", import.meta.url);
const TOOL_HELPERS_URL = new URL("../../../src/agent/runtime/tool-helpers.ts", import.meta.url);

/** The sentence a tool adds when its process runs outside the project. */
const NO_LOCAL_COPY =
  "This runtime has no local copy of the project files. Run the agent with `veryfront dev` in the project folder, or from an agent run on Veryfront Cloud.";

const PAGE = "export default function Page() { return <main>hi</main>; }\n";

/** Loaded lazily so the tool tests still run, and fail for their own reason, without the module. */
function loadProjectFilesModule(): Promise<
  typeof import("../../../templates/files/coding-agent/lib/project-files.ts")
> {
  return import(LIB_URL.href);
}

/**
 * Run the shipped tools in a child process whose working directory is `cwd`.
 *
 * Each call goes through the agent runtime's tool executor, as in an agent
 * run that admits no platform operation (for example under `veryfront dev`).
 * Returns each call's result in order. The child is denied network access and
 * may write only inside `cwd`.
 */
async function runToolsFrom(
  cwd: string,
  scriptDir: string,
  calls: Array<[tool: "list-files" | "read-file" | "edit-file", input: Record<string, unknown>]>,
): Promise<unknown[]> {
  const script = join(scriptDir, "run-tools.ts");
  await Deno.writeTextFile(
    script,
    [
      `import ${JSON.stringify(SCHEMA_SETUP_URL.href)};`,
      `import { executeConfiguredTool } from ${JSON.stringify(TOOL_HELPERS_URL.href)};`,
      "const calls = JSON.parse(Deno.args[0]);",
      "const results = [];",
      "for (const [url, input] of calls) {",
      "  const { default: tool } = await import(url);",
      "  results.push(",
      "    await executeConfiguredTool(tool.id, input, { [tool.id]: tool }, { agentId: \"coder\" }),",
      "  );",
      "}",
      "console.log(JSON.stringify(results));",
    ].join("\n"),
  );
  const result = await runCommand(Deno.execPath(), {
    args: [
      "run",
      "--no-check",
      "--frozen",
      "--cached-only",
      "--deny-net",
      "--allow-env",
      "--allow-read",
      // The tools canonicalize paths, so grant the canonical form (macOS maps /var to /private/var).
      `--allow-write=${await Deno.realPath(cwd)}`,
      `--config=${REPO_CONFIG}`,
      script,
      JSON.stringify(calls.map(([tool, input]) => [new URL(`${tool}.ts`, TOOLS_DIR).href, input])),
    ],
    cwd,
    capture: true,
  });
  assertEquals(result.code, 0, `tool process failed: ${result.stderr}`);
  return JSON.parse(String(result.stdout).trim().split("\n").pop()!);
}

describe("templates/coding-agent file tools from a real folder", () => {
  describe("local project file source", () => {
    it("lists, reads and writes files inside the project folder", async () => {
      const { localProjectFiles } = await loadProjectFilesModule();
      await withTempDir(async (dir) => {
        await Deno.mkdir(join(dir, "app", "about"), { recursive: true });
        await Deno.writeTextFile(join(dir, "app", "page.tsx"), PAGE);
        const files = localProjectFiles(dir);

        assertEquals(await files.list("app"), { files: ["page.tsx"] });
        assertEquals(await files.read("app/page.tsx"), { content: PAGE });
        await files.write("app/page.tsx", "changed\n");
        assertEquals(await Deno.readTextFile(join(dir, "app", "page.tsx")), "changed\n");
      }, { prefix: "vf-coding-agent-local-" });
    });

    it("answers not found for a missing directory or file", async () => {
      const { localProjectFiles } = await loadProjectFilesModule();
      await withTempDir(async (dir) => {
        const files = localProjectFiles(dir);
        assertEquals(await files.list("missing"), { notFound: true });
        assertEquals(await files.read("missing.ts"), { notFound: true });
        await assertRejects(
          () => files.write("missing.ts", ""),
          Error,
          "File not found: missing.ts",
        );
      }, { prefix: "vf-coding-agent-local-" });
    });

    it("refuses relative, absolute and symlinked paths that leave the project", async () => {
      const { localProjectFiles } = await loadProjectFilesModule();
      await withTempDir(async (outside) => {
        await Deno.writeTextFile(join(outside, "secret.txt"), "<REDACTED>");
        await withTempDir(async (dir) => {
          await Deno.symlink(outside, join(dir, "link"));
          const files = localProjectFiles(dir);
          for (const path of ["..", `${outside}/secret.txt`, outside, "link/secret.txt", "link"]) {
            assertEquals(await files.list(path), { escapes: true }, path);
            assertEquals(await files.read(path), { escapes: true }, path);
          }
          await assertRejects(
            () => files.write("link/secret.txt", "overwritten"),
            Error,
            "Path escapes project directory: link/secret.txt",
          );
          assertEquals(await Deno.readTextFile(join(outside, "secret.txt")), "<REDACTED>");
        }, { prefix: "vf-coding-agent-local-" });
      }, { prefix: "vf-coding-agent-outside-" });
    });

    it("adds a hint only when the folder is not a project", async () => {
      const { localProjectFiles, notFoundMessage } = await loadProjectFilesModule();
      await withTempDir(async (dir) => {
        assertEquals(
          await notFoundMessage(localProjectFiles(dir), "Directory not found: app"),
          `Directory not found: app. ${NO_LOCAL_COPY}`,
        );
        await Deno.mkdir(join(dir, "tools"));
        assertEquals(
          await notFoundMessage(localProjectFiles(dir), "Directory not found: app"),
          "Directory not found: app",
          "a missing folder inside a real project needs no hint",
        );
      }, { prefix: "vf-coding-agent-local-" });
    });
  });

  describe("tools run without the platform file operations", () => {
    it("say the runtime has no project files when they run outside the project, as on Veryfront Cloud", async () => {
      await withTempDir(async (scriptDir) => {
        await withTempDir(async (runtimeDir) => {
          await Deno.writeTextFile(
            join(runtimeDir, "veryfront.config.mjs"),
            "export default {};\n",
          );
          assertEquals(
            await runToolsFrom(runtimeDir, scriptDir, [
              ["list-files", { directory: "app" }],
              ["read-file", { path: "app/page.tsx" }],
              ["edit-file", { path: "app/page.tsx", search: "a", replace: "b" }],
            ]),
            [
              { error: `Directory not found: app. ${NO_LOCAL_COPY}` },
              { error: `File not found: app/page.tsx. ${NO_LOCAL_COPY}` },
              { error: `File not found: app/page.tsx. ${NO_LOCAL_COPY}` },
            ],
          );
        }, { prefix: "vf-coding-agent-runtime-" });
      }, { prefix: "vf-coding-agent-script-" });
    });

    it("keep reading and editing the project folder they run from", async () => {
      await withTempDir(async (scriptDir) => {
        await withTempDir(async (projectDir) => {
          await Deno.mkdir(join(projectDir, "app"));
          await Deno.mkdir(join(projectDir, "tools"));
          await Deno.writeTextFile(join(projectDir, "app", "page.tsx"), PAGE);
          const outsideFile = `../${basename(scriptDir)}/run-tools.ts`;
          assertEquals(
            await runToolsFrom(projectDir, scriptDir, [
              ["list-files", { directory: "app" }],
              ["read-file", { path: "app/page.tsx" }],
              ["edit-file", { path: "app/page.tsx", search: "hi", replace: "hello" }],
              ["list-files", { directory: "missing" }],
              // An existing file in the sibling temporary folder, outside the project.
              ["read-file", { path: outsideFile }],
              ["list-files", { directory: "/etc" }],
            ]),
            [
              { directory: "app", files: ["page.tsx"], count: 1 },
              { path: "app/page.tsx", content: PAGE },
              { path: "app/page.tsx", success: true },
              { error: "Directory not found: missing" },
              { error: `Path escapes project directory: ${outsideFile}` },
              { error: "Path escapes project directory: /etc" },
            ],
          );
          assertEquals(
            await Deno.readTextFile(join(projectDir, "app", "page.tsx")),
            "export default function Page() { return <main>hello</main>; }\n",
          );
        }, { prefix: "vf-coding-agent-project-" });
      }, { prefix: "vf-coding-agent-script-" });
    });
  });
});
