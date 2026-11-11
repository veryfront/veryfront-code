/**
 * Project file access gate for the `coding-agent` starter, in a hosted run.
 *
 * The starter's `list-files`, `read-file` and `edit-file` tools resolved every
 * path against `cwd()`. On Veryfront Cloud the process runs from the
 * runtime's own folder, which holds no project files, so `list-files` answered
 * "Directory not found: app" for a project that has an `app/` directory.
 *
 * The tools now read the project through the platform file operations a
 * hosted agent run grants (`context.executePlatformTool`). These tests inject
 * an in-memory platform and touch no filesystem, network or process. The local
 * file source and the tools run from a real folder are covered in
 * `tests/integration/templates/coding-agent-file-tools.test.ts`.
 *
 * @module templates/coding-agent-file-tools.test
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ToolExecutionContext } from "#veryfront/tool/types.ts";
import { PERMISSION_DENIED } from "#veryfront/errors";
import listFiles from "./files/coding-agent/tools/list-files.ts";
import readFile from "./files/coding-agent/tools/read-file.ts";
import editFile from "./files/coding-agent/tools/edit-file.ts";

const LIB_URL = new URL("./files/coding-agent/lib/project-files.ts", import.meta.url);

/** Paths that leave the project root, each of which must be refused. */
const ESCAPING_PATHS = [
  "..",
  "../other",
  "app/../../other",
  "/etc",
  "/etc/passwd",
  "\\\\server\\share",
  "C:\\Windows",
];

const PAGE = "export default function Page() { return <main>hi</main>; }\n";

/** Loaded lazily so the tool tests still run, and fail for their own reason, without the module. */
function loadProjectFilesModule(): Promise<
  typeof import("./files/coding-agent/lib/project-files.ts")
> {
  return import(LIB_URL.href);
}

type PlatformCall = { name: string; input: Record<string, unknown> };

/** An in-memory project behind the canonical platform file operations. */
function hostedProject(
  files: Record<string, string>,
  options: { pageSize?: number; context?: Partial<ToolExecutionContext> } = {},
) {
  const pageSize = options.pageSize ?? 100;
  const calls: PlatformCall[] = [];
  const executePlatformTool = (name: string, input: Record<string, unknown>) => {
    calls.push({ name, input: { ...input } });
    const path = input.path as string | undefined;
    switch (name) {
      case "veryfront__list_files": {
        // `*` matches one path segment, as on the platform.
        const pattern = String(input.pattern);
        const prefix = pattern === "*" ? "" : pattern.slice(0, -1);
        const matches = Object.keys(files).filter((file) =>
          file.startsWith(prefix) && !file.slice(prefix.length).includes("/")
        );
        const start = input.cursor === undefined ? 0 : Number(input.cursor);
        const next = start + pageSize < matches.length ? String(start + pageSize) : null;
        return Promise.resolve({
          data: matches.slice(start, start + pageSize).map((file) => ({
            path: file,
            type: fileKind(file),
          })),
          page_info: { next },
        });
      }
      case "veryfront__get_file":
        if (path === undefined || !Object.hasOwn(files, path)) {
          return Promise.reject(new Error(`File not found: ${path}`));
        }
        return Promise.resolve({ path, content: files[path] });
      case "veryfront__update_file":
        files[path!] = String(input.content);
        return Promise.resolve({ path });
      default:
        return Promise.reject(new Error(`Platform operation "${name}" is unavailable`));
    }
  };
  const context: ToolExecutionContext = {
    projectSlug: "<PROJECT_SLUG>",
    ...options.context,
    executePlatformTool,
  };
  return { calls, context, files };
}

/** The platform's file kind for a path, as `veryfront__list_files` reports it. */
function fileKind(path: string): string {
  if (path.startsWith("app/api/") || path.startsWith("pages/api/")) return "function";
  if (path.startsWith("pages/")) return "page";
  if (path.startsWith("components/")) return "component";
  return "file";
}

/** The runtime's refusal of an operation the run does not admit. */
function notAdmitted(name: string): Promise<never> {
  return Promise.reject(
    PERMISSION_DENIED.create({
      detail: `Platform operation "${name}" is not admitted for this wrapper invocation`,
    }),
  );
}

function sampleProject(): Record<string, string> {
  return {
    "app/page.tsx": PAGE,
    "app/layout.tsx": "export default function Layout() { return null; }\n",
    "app/about/page.mdx": "# About\n",
    "agents/coder.ts": "export default {};\n",
    "README.md": "# Coding Agent\n",
  };
}

describe("templates/coding-agent file tools", () => {
  it("declares the platform file operations each tool calls on Veryfront Cloud", () => {
    assertEquals(listFiles.delegatedPlatformTools, ["veryfront__list_files"]);
    assertEquals(readFile.delegatedPlatformTools, ["veryfront__get_file"]);
    assertEquals(editFile.delegatedPlatformTools, [
      "veryfront__get_file",
      "veryfront__update_file",
    ]);
  });

  describe("in a Veryfront Cloud agent run", () => {
    it("lists the project's directory through the platform, not the working directory", async () => {
      const { calls, context } = hostedProject(sampleProject());
      assertEquals(
        await listFiles.execute({ directory: "app" }, context),
        { directory: "app", files: ["page.tsx", "layout.tsx"], count: 2 },
        "only the files directly in app/ are listed",
      );
      assertEquals(calls, [{
        name: "veryfront__list_files",
        input: { project_reference: "<PROJECT_SLUG>", pattern: "app/*", limit: 100 },
      }]);
    });

    it("lists the project root, normalizes the directory and applies the extension filter", async () => {
      const { calls, context } = hostedProject(sampleProject());
      assertEquals(await listFiles.execute({ directory: "." }, context), {
        directory: ".",
        files: ["README.md"],
        count: 1,
      });
      assertEquals(
        await listFiles.execute({ directory: "./app/", extensions: [".mdx", ".tsx"] }, context),
        { directory: "./app/", files: ["page.tsx", "layout.tsx"], count: 2 },
      );
      assertEquals(
        await listFiles.execute({ directory: "app", extensions: [".css"] }, context),
        { directory: "app", files: [], count: 0 },
        "a filter that matches nothing is an empty listing, not a missing directory",
      );
      assertEquals(calls.map((call) => call.input.pattern), ["*", "app/*", "app/*"]);
    });

    it("follows the page cursor until the listing is complete", async () => {
      const files: Record<string, string> = {};
      for (let index = 0; index < 5; index++) files[`app/file-${index}.ts`] = "";
      const { calls, context } = hostedProject(files, { pageSize: 2 });
      assertEquals(await listFiles.execute({ directory: "app" }, context), {
        directory: "app",
        files: ["file-0.ts", "file-1.ts", "file-2.ts", "file-3.ts", "file-4.ts"],
        count: 5,
      });
      assertEquals(calls.map((call) => call.input.cursor), [undefined, "2", "4"]);
    });

    it("lists files of every kind, including pages, components and API routes", async () => {
      const { context } = hostedProject({
        "components/Button.tsx": "",
        "pages/index.tsx": "",
        "app/api/ag-ui/route.ts": "",
      });
      assertEquals(await listFiles.execute({ directory: "components" }, context), {
        directory: "components",
        files: ["Button.tsx"],
        count: 1,
      });
      assertEquals(await listFiles.execute({ directory: "pages" }, context), {
        directory: "pages",
        files: ["index.tsx"],
        count: 1,
      });
      assertEquals(await listFiles.execute({ directory: "app/api/ag-ui" }, context), {
        directory: "app/api/ag-ui",
        files: ["route.ts"],
        count: 1,
      });
    });

    it("reads and saves the run's preview branch, and main otherwise", async () => {
      const onBranch = hostedProject(sampleProject(), { context: { branch: "<BRANCH_ID>" } });
      await listFiles.execute({ directory: "app" }, onBranch.context);
      await editFile.execute(
        { path: "app/page.tsx", search: "hi", replace: "hello" },
        onBranch.context,
      );
      assertEquals(
        onBranch.calls.map((call) => call.input.branch_id),
        ["<BRANCH_ID>", "<BRANCH_ID>", "<BRANCH_ID>"],
      );

      for (const branch of [undefined, null, "main"]) {
        const onMain = hostedProject(sampleProject(), { context: { branch } });
        await readFile.execute({ path: "README.md" }, onMain.context);
        assertEquals(onMain.calls[0]!.input, {
          project_reference: "<PROJECT_SLUG>",
          path: "README.md",
        }, String(branch));
      }
    });

    it("scopes calls to the run's project slug, then its ID, and otherwise to the current project", async () => {
      const byId = hostedProject(sampleProject(), {
        context: { projectSlug: undefined, projectId: "<PROJECT_ID>" },
      });
      await readFile.execute({ path: "README.md" }, byId.context);
      assertEquals(byId.calls[0]!.input, { project_reference: "<PROJECT_ID>", path: "README.md" });

      const current = hostedProject(sampleProject(), { context: { projectSlug: undefined } });
      await readFile.execute({ path: "README.md" }, current.context);
      assertEquals(current.calls[0]!.input, { path: "README.md" });
    });

    it("answers not found for a directory or file the project does not have", async () => {
      const { calls, context } = hostedProject(sampleProject());
      assertEquals(await listFiles.execute({ directory: "missing" }, context), {
        error: "Directory not found: missing",
      });
      assertEquals(await readFile.execute({ path: "app/missing.tsx" }, context), {
        error: "File not found: app/missing.tsx",
      });
      assertEquals(
        await editFile.execute({ path: "app/missing.tsx", search: "a", replace: "b" }, context),
        { error: "File not found: app/missing.tsx" },
      );
      assertEquals(
        calls.map((call) => call.name),
        ["veryfront__list_files", "veryfront__get_file", "veryfront__get_file"],
        "the answer comes from the project's files, not the runtime's working directory",
      );
    });

    it("refuses every path that leaves the project without calling the platform", async () => {
      const { calls, context } = hostedProject(sampleProject());
      for (const path of ESCAPING_PATHS) {
        const error = `Path escapes project directory: ${path}`;
        assertEquals(await listFiles.execute({ directory: path }, context), { error }, path);
        assertEquals(await readFile.execute({ path }, context), { error }, path);
        assertEquals(
          await editFile.execute({ path, search: "a", replace: "b" }, context),
          { error },
          path,
        );
      }
      assertEquals(calls, []);

      const { hostedProjectFiles } = await loadProjectFilesModule();
      await assertRejects(
        () => hostedProjectFiles(context.executePlatformTool!).write("../outside.ts", ""),
        Error,
        "Path escapes project directory: ../outside.ts",
      );
      assertEquals(calls, []);
    });

    it("reads a project file through the platform", async () => {
      const { calls, context } = hostedProject(sampleProject());
      assertEquals(await readFile.execute({ path: "./app/page.tsx" }, context), {
        path: "./app/page.tsx",
        content: PAGE,
      });
      assertEquals(calls[0]!.input.path, "app/page.tsx", "the platform gets a normalized path");
    });

    it("edits a project file through the platform", async () => {
      const project = hostedProject(sampleProject());
      assertEquals(
        await editFile.execute(
          { path: "app/page.tsx", search: "<main>hi</main>", replace: "<main>hello</main>" },
          project.context,
        ),
        { path: "app/page.tsx", success: true },
      );
      assertEquals(
        project.files["app/page.tsx"],
        "export default function Page() { return <main>hello</main>; }\n",
      );
      assertEquals(project.calls.map((call) => call.name), [
        "veryfront__get_file",
        "veryfront__update_file",
      ]);
      assertEquals(project.calls[1]!.input, {
        project_reference: "<PROJECT_SLUG>",
        path: "app/page.tsx",
        content: "export default function Page() { return <main>hello</main>; }\n",
      });
    });

    it("does not save when the search string is not in the file", async () => {
      const project = hostedProject(sampleProject());
      assertEquals(
        await editFile.execute(
          { path: "app/page.tsx", search: "not there", replace: "x" },
          project.context,
        ),
        { error: "Search string not found in file" },
      );
      assertEquals(project.calls.map((call) => call.name), ["veryfront__get_file"]);
      assertEquals(project.files["app/page.tsx"], PAGE);
    });

    it("surfaces a refused save after a platform read instead of saving elsewhere", async () => {
      const project = hostedProject(sampleProject());
      const context: ToolExecutionContext = {
        ...project.context,
        executePlatformTool: (name, input) =>
          name === "veryfront__update_file"
            ? notAdmitted(name)
            : project.context.executePlatformTool!(name, input),
      };
      await assertRejects(
        () => editFile.execute({ path: "app/page.tsx", search: "hi", replace: "hello" }, context),
        Error,
        "is not admitted",
      );
      assertEquals(project.files["app/page.tsx"], PAGE);
    });

    it("surfaces a read failure instead of reporting a missing file", async () => {
      const context: ToolExecutionContext = {
        executePlatformTool: () => Promise.reject(new Error("<PLATFORM_FAILURE>")),
      };
      await assertRejects(
        () => readFile.execute({ path: "app/page.tsx" }, context),
        Error,
        "<PLATFORM_FAILURE>",
      );
      await assertRejects(
        () => editFile.execute({ path: "app/page.tsx", search: "a", replace: "b" }, context),
        Error,
        "<PLATFORM_FAILURE>",
      );
    });

    it("answers not found for a returned not-found result, and surfaces other returned errors", async () => {
      const project = hostedProject(sampleProject());
      const answer = (result: Record<string, unknown>, name = "veryfront__get_file") => ({
        ...project.context,
        executePlatformTool: (called: string, input: Record<string, unknown>) =>
          called === name
            ? Promise.resolve(result)
            : project.context.executePlatformTool!(called, input),
      });
      assertEquals(
        await readFile.execute(
          { path: "app/page.tsx" },
          answer({ isError: true, message: "File not found: app/page.tsx" }),
        ),
        { error: "File not found: app/page.tsx" },
      );
      await assertRejects(
        () =>
          readFile.execute(
            { path: "app/page.tsx" },
            answer({ isError: true, message: "<PLATFORM_FAILURE>" }),
          ),
        Error,
        "<PLATFORM_FAILURE>",
      );
      await assertRejects(
        () =>
          editFile.execute(
            { path: "app/page.tsx", search: "hi", replace: "hello" },
            answer({ isError: true, message: "<SAVE_FAILURE>" }, "veryfront__update_file"),
          ),
        Error,
        "<SAVE_FAILURE>",
      );
    });

    it("surfaces a returned listing error instead of reporting a missing directory", async () => {
      const context: ToolExecutionContext = {
        executePlatformTool: () =>
          Promise.resolve({ isError: true, message: "<PLATFORM_FAILURE>" }),
      };
      await assertRejects(
        () => listFiles.execute({ directory: "app" }, context),
        Error,
        "<PLATFORM_FAILURE>",
      );
    });

    it("surfaces a listing failure instead of reporting an empty directory", async () => {
      const context: ToolExecutionContext = {
        executePlatformTool: () => Promise.reject(new Error("<PLATFORM_FAILURE>")),
      };
      await assertRejects(
        () => listFiles.execute({ directory: "app" }, context),
        Error,
        "<PLATFORM_FAILURE>",
      );
    });
  });

  describe("in a run that admits no platform file operation", () => {
    it("falls back to the folder it runs from, and says when that is not the project", async () => {
      const { projectFiles, notFoundMessage } = await loadProjectFilesModule();
      const calls: string[] = [];
      const context: ToolExecutionContext = {
        executePlatformTool: (name) => {
          calls.push(name);
          return notAdmitted(name);
        },
      };
      // A folder that does not exist stands in for a runtime folder without the project.
      const files = projectFiles(context, "/vf-coding-agent-no-such-folder");
      assertEquals(await files.list("app"), { notFound: true });
      assertEquals(await files.read("app/page.tsx"), { notFound: true });
      assertEquals(
        await notFoundMessage(files, "Directory not found: app"),
        "Directory not found: app. This runtime has no local copy of the project files. Run the agent with `veryfront dev` in the project folder, or from an agent run on Veryfront Cloud.",
      );
      assertEquals(calls, ["veryfront__list_files"], "the platform is not asked again");
    });
  });
});
