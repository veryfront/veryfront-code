/**
 * `files`, `knowledge`, `uploads` and `project delete` in a folder that is
 * not linked to a project: with no `--project`, the folder or package name is only a guess,
 * so each command stops before it calls the API.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { VeryfrontError } from "veryfront/errors";
import { join } from "veryfront/platform/path";
import type { ParsedArgs } from "../../../../cli/shared/types.ts";
import { filesCommand } from "../../../../cli/commands/files/command.ts";
import { knowledgeCommand } from "../../../../cli/commands/knowledge/command.ts";
import { uploadsCommand } from "../../../../cli/commands/uploads/command.ts";
import { projectCommand } from "../../../../cli/commands/project/command.ts";

const NO_LINKED_PROJECT_MESSAGE =
  "No project is linked to this folder. Pass `--project <slug>` (the slug is on the project's Settings page), or run `veryfront pull <slug>` to link one.";

const PROJECT_ENVIRONMENT_NAMES = [
  "VERYFRONT_API_URL",
  "VERYFRONT_API_BASE_URL",
  "VERYFRONT_API_KEY",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_TOKEN_FILE",
  "VERYFRONT_PROJECT_SLUG",
  "TENANT_PROJECT_SLUG",
  "VERYFRONT_PROJECT_ID",
  "TENANT_PROJECT_ID",
  "XDG_CONFIG_HOME",
] as const;

type Command = (args: ParsedArgs) => Promise<void>;

/** Runs `fn` in an empty folder named `code`, with a token and no project reference. */
async function withUnlinkedFolder(
  fn: (projectDir: string, requests: string[]) => Promise<void>,
  options: { token?: boolean } = {},
): Promise<void> {
  const root = await makeTempDir({ prefix: "vf-unlinked-project-" });
  const projectDir = join(root, "code");
  await Deno.mkdir(projectDir);
  await Deno.writeTextFile(join(projectDir, "page.tsx"), "export default 1;\n");
  const original = Object.fromEntries(
    PROJECT_ENVIRONMENT_NAMES.map((name) => [name, Deno.env.get(name)]),
  );
  const requests: string[] = [];
  try {
    for (const name of PROJECT_ENVIRONMENT_NAMES) Deno.env.delete(name);
    if (options.token !== false) Deno.env.set("VERYFRONT_API_KEY", "test-token");
    Deno.env.set("XDG_CONFIG_HOME", root);
    _resetEnvironmentConfig();
    await withMockFetch((input) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(new URL(url).pathname);
      return Promise.resolve(Response.json({ data: [] }));
    }, () => fn(projectDir, requests));
  } finally {
    for (const name of PROJECT_ENVIRONMENT_NAMES) {
      const value = original[name];
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
    _resetEnvironmentConfig();
    await Deno.remove(root, { recursive: true });
  }
}

async function writeProjectLink(projectDir: string): Promise<void> {
  await Deno.mkdir(join(projectDir, ".veryfront"));
  await Deno.writeTextFile(
    join(projectDir, ".veryfront", "project.json"),
    JSON.stringify({
      version: 1,
      controlPlane: "https://api.veryfront.com",
      projectId: "linked-project-id",
      projectSlug: "linked-project",
    }),
  );
}

function unlinkedCases(projectDir: string): Array<[string, Command, ParsedArgs]> {
  const from = join(projectDir, "page.tsx");
  return [
    ["files list", filesCommand, { _: ["files", "list"] }],
    ["files get", filesCommand, { _: ["files", "get", "app/page.tsx"] }],
    ["files put", filesCommand, { _: ["files", "put", "app/page.tsx"], from }],
    ["files delete", filesCommand, { _: ["files", "delete", "app/page.tsx"] }],
    ["knowledge ingest", knowledgeCommand, { _: ["knowledge", "ingest", "guide.pdf"] }],
    ["uploads list", uploadsCommand, { _: ["uploads", "list"] }],
    ["uploads pull", uploadsCommand, {
      _: ["uploads", "pull", "guide.pdf"],
      "output-dir": join(projectDir, "out"),
    }],
    ["uploads put", uploadsCommand, { _: ["uploads", "put", "guide.pdf"], from }],
    ["uploads delete", uploadsCommand, { _: ["uploads", "delete", "guide.pdf"] }],
    ["project delete", projectCommand, { _: ["project", "delete"], force: true }],
  ];
}

describe("commands in a folder with no linked project", () => {
  it("stop before the API and say how to name the project", async () => {
    await withUnlinkedFolder(async (projectDir, requests) => {
      for (const [name, command, args] of unlinkedCases(projectDir)) {
        const error = await assertRejects(
          () => command({ ...args, "project-dir": projectDir }),
          VeryfrontError,
          undefined,
          name,
        ) as VeryfrontError;
        assertEquals(error.slug, "invalid-argument", name);
        assertEquals(error.message, NO_LINKED_PROJECT_MESSAGE, name);
      }
      assertEquals(requests, []);
    });
  });

  it("stop before asking for a login when no credential is set", async () => {
    await withUnlinkedFolder(async (projectDir, requests) => {
      for (const [name, command, args] of unlinkedCases(projectDir)) {
        const error = await assertRejects(
          () => command({ ...args, "project-dir": projectDir }),
          VeryfrontError,
          undefined,
          name,
        ) as VeryfrontError;
        assertEquals(error.message, NO_LINKED_PROJECT_MESSAGE, name);
      }
      assertEquals(requests, []);
    }, { token: false });
  });

  it("use the project linked to the folder", async () => {
    await withUnlinkedFolder(async (projectDir, requests) => {
      await writeProjectLink(projectDir);
      await filesCommand({ _: ["files", "list"], "project-dir": projectDir, json: true });
      await uploadsCommand({ _: ["uploads", "list"], "project-dir": projectDir, json: true });
      assertEquals(requests, [
        "/projects/linked-project/files",
        "/projects/linked-project/uploads",
      ]);
    });
  });

  it("use --project when no project is linked", async () => {
    await withUnlinkedFolder(async (projectDir, requests) => {
      for (const command of [filesCommand, uploadsCommand]) {
        const name = command === filesCommand ? "files" : "uploads";
        await command({
          _: [name, "list"],
          "project-dir": projectDir,
          project: "support-desk",
          json: true,
        });
      }
      assertEquals(requests, [
        "/projects/support-desk/files",
        "/projects/support-desk/uploads",
      ]);
    });
  });
});
