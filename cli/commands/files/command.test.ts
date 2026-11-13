import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { VeryfrontError } from "veryfront/errors";
import {
  buildRemoteFileUrl,
  deleteRemoteFile,
  filesCommand,
  getRemoteFile,
  listRemoteFiles,
  putRemoteFileFromLocal,
} from "./command.ts";
import type { ApiClient } from "#cli/shared/config";
import type { ParsedArgs } from "#cli/shared/types";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { join } from "veryfront/platform/path";

const PROJECT_ENVIRONMENT_NAMES = [
  "VERYFRONT_API_URL",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "TENANT_PROJECT_SLUG",
  "VERYFRONT_PROJECT_ID",
  "TENANT_PROJECT_ID",
  "XDG_CONFIG_HOME",
] as const;

/** Runs `fn` in an empty folder named `code`, with a token and no project reference. */
async function withUnlinkedFolder(
  fn: (projectDir: string, requests: string[]) => Promise<void>,
): Promise<void> {
  const root = await makeTempDir({ prefix: "vf-files-unlinked-" });
  const projectDir = join(root, "code");
  await Deno.mkdir(projectDir);
  const original = Object.fromEntries(
    PROJECT_ENVIRONMENT_NAMES.map((name) => [name, Deno.env.get(name)]),
  );
  const requests: string[] = [];
  try {
    for (const name of PROJECT_ENVIRONMENT_NAMES) Deno.env.delete(name);
    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
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

function createMockClient(overrides: {
  get?: (path: string, params?: Record<string, string>) => Promise<unknown>;
  put?: (path: string, body?: unknown) => Promise<unknown>;
  delete?: (path: string) => Promise<unknown>;
} = {}): ApiClient {
  return {
    get: async <T>(path: string, params?: Record<string, string>): Promise<T> => {
      const result = await (overrides.get?.(path, params) ?? Promise.resolve({ data: [] }));
      return result as T;
    },
    post: <T>(): Promise<T> => Promise.resolve({} as T),
    put: async <T>(path: string, body?: unknown): Promise<T> => {
      const result = await (overrides.put?.(path, body) ?? Promise.resolve({ path }));
      return result as T;
    },
    patch: <T>(): Promise<T> => Promise.resolve({} as T),
    delete: async <T>(path: string): Promise<T> => {
      const result = await (overrides.delete?.(path) ?? Promise.resolve({}));
      return result as T;
    },
  };
}

describe("buildRemoteFileUrl", () => {
  it("encodes project file paths", () => {
    assertEquals(
      buildRemoteFileUrl("my-project", "knowledge/contracts/q1-report.md"),
      "/projects/my-project/files/knowledge%2Fcontracts%2Fq1-report.md",
    );
  });

  it("rejects traversal attempts as invalid-argument usage errors", () => {
    const error = assertThrows(
      () => buildRemoteFileUrl("my-project", "../secrets.txt"),
      VeryfrontError,
      "Invalid remote file path",
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "invalid-argument");
  });
});

describe("listRemoteFiles", () => {
  it("lists remote files and filters by prefix when requested", async () => {
    const client = createMockClient({
      get: () =>
        Promise.resolve({
          data: [
            { path: "knowledge/q1.md", size: 10, type: "file", created_at: "", updated_at: "" },
            { path: "src/index.ts", size: 10, type: "file", created_at: "", updated_at: "" },
          ],
          page_info: { next: null },
        }),
    });

    const files = await listRemoteFiles(client, "my-project", { path: "knowledge/" });

    assertEquals(files.map((file: { path: string }) => file.path), ["knowledge/q1.md"]);
  });
});

describe("getRemoteFile", () => {
  it("reads remote file content from the project files API", async () => {
    let capturedPath = "";
    const client = createMockClient({
      get: (path) => {
        capturedPath = path;
        return Promise.resolve({ path: "knowledge/q1.md", content: "# Q1\n", size: 5 });
      },
    });

    const content = await getRemoteFile(client, "my-project", "knowledge/q1.md");

    assertEquals(capturedPath, "/projects/my-project/files/knowledge%2Fq1.md");
    assertEquals(content, "# Q1\n");
  });
});

describe("putRemoteFileFromLocal", () => {
  it("reads a local file and uploads it to the project files API", async () => {
    let capturedPath = "";
    let capturedBody: unknown = null;
    const tempDir = await makeTempDir();
    const localPath = `${tempDir}/q1-report.md`;

    await Deno.writeTextFile(localPath, "# Q1 Report\n");

    try {
      const client = createMockClient({
        put: (path, body) => {
          capturedPath = path;
          capturedBody = body;
          return Promise.resolve({
            path: "knowledge/q1-report.md",
            file_id: "file-1",
            version_id: "version-1",
            checksum: "checksum-1",
          });
        },
      });

      const result = await putRemoteFileFromLocal(
        client,
        "my-project",
        "knowledge/q1-report.md",
        localPath,
      );

      assertEquals(capturedPath, "/projects/my-project/files/knowledge%2Fq1-report.md");
      assertEquals(capturedBody, { content: "# Q1 Report\n" });
      assertEquals(result, {
        path: "knowledge/q1-report.md",
        file_id: "file-1",
        version_id: "version-1",
        checksum: "checksum-1",
      });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
  it("rejects an empty explicit branch before reading or uploading", async () => {
    let writes = 0;
    const client = createMockClient({
      put: () => {
        writes++;
        return Promise.resolve({});
      },
    });
    await assertRejects(
      () =>
        putRemoteFileFromLocal(
          client,
          "my-project",
          "knowledge/proof.md",
          "/missing/proof.md",
          undefined,
          { branch: "" },
        ),
      VeryfrontError,
    );
    assertEquals(writes, 0);
  });

  it("uploads durable metadata when provided", async () => {
    let capturedBody: unknown = null;
    const tempDir = await makeTempDir();
    const localPath = `${tempDir}/proof.md`;
    await Deno.writeTextFile(localPath, "# Proof\n");
    try {
      const client = createMockClient({
        put: (_path, body) => {
          capturedBody = body;
          return Promise.resolve({ path: "knowledge/proof.md" });
        },
      });

      await putRemoteFileFromLocal(
        client,
        "my-project",
        "knowledge/proof.md",
        localPath,
        undefined,
        undefined,
        { _veryfront: { okf: { bundle_root_path: "knowledge/imports/acme" } } },
      );

      assertEquals(capturedBody, {
        content: "# Proof\n",
        metadata: { _veryfront: { okf: { bundle_root_path: "knowledge/imports/acme" } } },
      });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("encodes branch names as canonical ref selectors", async () => {
    assertEquals(
      buildRemoteFileUrl("my-project", "knowledge/proof.md", {
        branch: "chore/context-knowledge-proof-20261007",
      }),
      "/projects/my-project/files/knowledge%2Fproof.md?ref=branch%3Achore%2Fcontext-knowledge-proof-20261007",
    );
  });

  it("uploads to the explicit branch ref without changing omitted-branch behavior", async () => {
    const tempDir = await makeTempDir();
    const localPath = `${tempDir}/proof.md`;
    await Deno.writeTextFile(localPath, "Branch proof");
    const paths: string[] = [];
    try {
      const client = createMockClient({
        put: (url) => {
          paths.push(url);
          return Promise.resolve({});
        },
      });
      await putRemoteFileFromLocal(
        client,
        "my-project",
        "knowledge/proof.md",
        localPath,
      );
      await putRemoteFileFromLocal(
        client,
        "my-project",
        "knowledge/proof.md",
        localPath,
        undefined,
        { branch: "branch&ref=main" },
      );
      const controller = new AbortController();
      await putRemoteFileFromLocal(
        client,
        "my-project",
        "knowledge/proof.md",
        localPath,
        controller.signal,
        { branchId: "legacy-branch-id" },
      );
      assertEquals(paths, [
        "/projects/my-project/files/knowledge%2Fproof.md",
        "/projects/my-project/files/knowledge%2Fproof.md?ref=branch%3Abranch%26ref%3Dmain",
        "/projects/my-project/files/knowledge%2Fproof.md?branch_id=legacy-branch-id",
      ]);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});

describe("deleteRemoteFile", () => {
  it("deletes a remote project file", async () => {
    let capturedPath = "";
    const client = createMockClient({
      delete: (path) => {
        capturedPath = path;
        return Promise.resolve({});
      },
    });

    await deleteRemoteFile(client, "my-project", "knowledge/q1-report.md");

    assertEquals(capturedPath, "/projects/my-project/files/knowledge%2Fq1-report.md");
  });
});

describe("filesCommand", () => {
  it("rejects unusable subcommand arguments as invalid-argument usage errors", async () => {
    const cases: Array<[ParsedArgs, string]> = [
      [{ _: ["files", "get"] }, "Invalid files get arguments:"],
      [{ _: ["files", "put"] }, "Invalid files put arguments:"],
      [{ _: ["files", "delete"] }, "Invalid files delete arguments:"],
    ];
    for (const [args, expectedDetail] of cases) {
      const error = await assertRejects(
        () => filesCommand(args),
        VeryfrontError,
        expectedDetail,
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "invalid-argument");
    }
  });

  it("stops before the API when no project is linked to the folder", async () => {
    await withUnlinkedFolder(async (projectDir, requests) => {
      const cases: ParsedArgs[] = [
        { _: ["files", "list"] },
        { _: ["files", "get", "app/page.tsx"] },
        { _: ["files", "put", "app/page.tsx"], from: join(projectDir, "page.tsx") },
        { _: ["files", "delete", "app/page.tsx"] },
      ];
      await Deno.writeTextFile(join(projectDir, "page.tsx"), "export default 1;\n");
      for (const args of cases) {
        const error = await assertRejects(
          () => filesCommand({ ...args, "project-dir": projectDir }),
          VeryfrontError,
        );
        assertEquals(error.slug, "invalid-argument");
        assertEquals(
          error.message,
          "No project is linked to this folder. Pass `--project <slug>` (the slug is on the project's Settings page), or run `veryfront pull <slug>` to link one.",
        );
      }
      assertEquals(requests, []);
    });
  });

  it("uses the project linked to the folder", async () => {
    await withUnlinkedFolder(async (projectDir, requests) => {
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
      await filesCommand({ _: ["files", "list"], "project-dir": projectDir, json: true });
      assertEquals(requests, ["/projects/linked-project/files"]);
    });
  });

  it("uses --project in a folder with no linked project", async () => {
    await withUnlinkedFolder(async (projectDir, requests) => {
      await filesCommand({
        _: ["files", "list"],
        "project-dir": projectDir,
        project: "support-desk",
        json: true,
      });
      assertEquals(requests, ["/projects/support-desk/files"]);
    });
  });
});
