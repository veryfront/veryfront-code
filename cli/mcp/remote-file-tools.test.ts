import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  _resetEnvironmentConfig,
  _setEnvironmentConfigForTesting,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { deleteHostSecret, setHostSecret } from "#cli/process-env";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process/env.ts";
import {
  remoteFileTools,
  vfRemoteCloneProject,
  vfRemoteCreateBranch,
  vfRemoteCreateProject,
  vfRemoteDeleteBranch,
  vfRemoteDeleteFile,
  vfRemoteGetFile,
  vfRemoteListBranches,
  vfRemoteListFiles,
  vfRemoteMergeBranch,
  vfRemoteMoveFile,
  vfRemoteSearchFiles,
  vfRemoteUpdateFile,
} from "./remote-file-tools.ts";

function assertSchemaSuccess<T>(
  result: { success: true; data: T } | { success: false },
): asserts result is { success: true; data: T } {
  assertEquals(result.success, true);
}

async function assertExecuteError(
  promise: Promise<{ success: boolean; error?: unknown }>,
): Promise<void> {
  const result = await promise;
  assertEquals(result.success, false);
  assertExists(result.error);
}

describe("cli/mcp/remote-file-tools", () => {
  describe("remoteFileTools array", () => {
    it("should export all remote tools", () => {
      assertEquals(remoteFileTools.length, 12);
    });

    it("should have unique names", () => {
      const names = remoteFileTools.map((t) => t.name);
      assertEquals(names.length, new Set(names).size);
    });

    it("should have name and description for each tool", () => {
      for (const tool of remoteFileTools) {
        assertExists(tool.name);
        assertExists(tool.description);
        assertEquals(typeof tool.name, "string");
        assertEquals(typeof tool.description, "string");
        assertEquals(tool.name.length > 0, true);
        assertEquals(tool.description.length > 0, true);
      }
    });

    it("should have inputSchema for each tool", () => {
      for (const tool of remoteFileTools) {
        assertExists(tool.inputSchema);
        assertEquals(typeof tool.execute, "function");
      }
    });

    it("should include all expected tool names", () => {
      const expectedNames = [
        "vf_remote_create_project",
        "vf_remote_clone_project",
        "vf_remote_list_files",
        "vf_remote_get_file",
        "vf_remote_update_file",
        "vf_remote_delete_file",
        "vf_remote_search_files",
        "vf_remote_move_file",
        "vf_remote_list_branches",
        "vf_remote_create_branch",
        "vf_remote_merge_branch",
        "vf_remote_delete_branch",
      ];
      const actualNames = remoteFileTools.map((t) => t.name);

      for (const name of expectedNames) {
        assertEquals(actualNames.includes(name), true, `Missing tool: ${name}`);
      }
    });
  });

  describe("vfRemoteListFiles", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteListFiles.name, "vf_remote_list_files");
    });

    it("should validate input schema - requires project", () => {
      const result = vfRemoteListFiles.inputSchema.safeParse({ project: "my-project" });
      assertEquals(result.success, true);
    });

    it("should validate input schema - rejects empty", () => {
      const result = vfRemoteListFiles.inputSchema.safeParse({});
      assertEquals(result.success, false);
    });

    it("should accept optional branch and pattern", () => {
      const result = vfRemoteListFiles.inputSchema.safeParse({
        project: "my-project",
        branch: "feature",
        pattern: "*.tsx",
        limit: 10,
      });
      assertSchemaSuccess(result);
      assertEquals(result.data.project, "my-project");
      assertEquals(result.data.branch, "feature");
      assertEquals(result.data.pattern, "*.tsx");
      assertEquals(result.data.limit, 10);
    });

    it("should default limit to 50", () => {
      const result = vfRemoteListFiles.inputSchema.safeParse({ project: "my-project" });
      assertSchemaSuccess(result);
      assertEquals(result.data.limit, 50);
    });
  });

  describe("vfRemoteGetFile", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteGetFile.name, "vf_remote_get_file");
    });

    it("should require project and path", () => {
      const valid = vfRemoteGetFile.inputSchema.safeParse({
        project: "my-project",
        path: "pages/index.tsx",
      });
      assertEquals(valid.success, true);

      const missingPath = vfRemoteGetFile.inputSchema.safeParse({
        project: "my-project",
      });
      assertEquals(missingPath.success, false);

      const missingProject = vfRemoteGetFile.inputSchema.safeParse({
        path: "pages/index.tsx",
      });
      assertEquals(missingProject.success, false);
    });

    it("should accept optional branch", () => {
      const result = vfRemoteGetFile.inputSchema.safeParse({
        project: "my-project",
        path: "pages/index.tsx",
        branch: "dev",
      });
      assertEquals(result.success, true);
    });
  });

  describe("vfRemoteUpdateFile", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteUpdateFile.name, "vf_remote_update_file");
    });

    it("should require project, path, and content", () => {
      const valid = vfRemoteUpdateFile.inputSchema.safeParse({
        project: "my-project",
        path: "pages/index.tsx",
        content: "export default function Page() { return <div>Hello</div> }",
      });
      assertEquals(valid.success, true);

      const missingContent = vfRemoteUpdateFile.inputSchema.safeParse({
        project: "my-project",
        path: "pages/index.tsx",
      });
      assertEquals(missingContent.success, false);
    });
  });

  describe("vfRemoteDeleteFile", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteDeleteFile.name, "vf_remote_delete_file");
    });

    it("should require project and path", () => {
      const valid = vfRemoteDeleteFile.inputSchema.safeParse({
        project: "my-project",
        path: "pages/old.tsx",
      });
      assertEquals(valid.success, true);
    });
  });

  describe("vfRemoteSearchFiles", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteSearchFiles.name, "vf_remote_search_files");
    });

    it("should require project and query", () => {
      const valid = vfRemoteSearchFiles.inputSchema.safeParse({
        project: "my-project",
        query: "useState",
      });
      assertEquals(valid.success, true);

      const missingQuery = vfRemoteSearchFiles.inputSchema.safeParse({
        project: "my-project",
      });
      assertEquals(missingQuery.success, false);
    });

    it("should accept all optional params", () => {
      const result = vfRemoteSearchFiles.inputSchema.safeParse({
        project: "my-project",
        query: "useState",
        pattern: "*.tsx",
        is_regex: true,
        case_sensitive: true,
        max_results: 100,
        branch: "feature",
      });
      assertEquals(result.success, true);
    });

    it("should default max_results to 50", () => {
      const result = vfRemoteSearchFiles.inputSchema.safeParse({
        project: "my-project",
        query: "test",
      });
      assertSchemaSuccess(result);
      assertEquals(result.data.max_results, 50);
    });
  });

  describe("vfRemoteMoveFile", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteMoveFile.name, "vf_remote_move_file");
    });

    it("should require project, source_path, and destination_path", () => {
      const valid = vfRemoteMoveFile.inputSchema.safeParse({
        project: "my-project",
        source_path: "old/path.tsx",
        destination_path: "new/path.tsx",
      });
      assertEquals(valid.success, true);

      const missingDest = vfRemoteMoveFile.inputSchema.safeParse({
        project: "my-project",
        source_path: "old/path.tsx",
      });
      assertEquals(missingDest.success, false);
    });
  });

  describe("vfRemoteListBranches", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteListBranches.name, "vf_remote_list_branches");
    });

    it("should require project", () => {
      const valid = vfRemoteListBranches.inputSchema.safeParse({
        project: "my-project",
      });
      assertEquals(valid.success, true);
    });

    it("should accept optional search and status", () => {
      const result = vfRemoteListBranches.inputSchema.safeParse({
        project: "my-project",
        search: "feature",
        status: "active",
      });
      assertEquals(result.success, true);
    });

    it("should validate status enum", () => {
      const valid = vfRemoteListBranches.inputSchema.safeParse({
        project: "my-project",
        status: "merged",
      });
      assertEquals(valid.success, true);

      const invalid = vfRemoteListBranches.inputSchema.safeParse({
        project: "my-project",
        status: "invalid",
      });
      assertEquals(invalid.success, false);
    });
  });

  describe("vfRemoteCreateBranch", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteCreateBranch.name, "vf_remote_create_branch");
    });

    it("should require project and name", () => {
      const valid = vfRemoteCreateBranch.inputSchema.safeParse({
        project: "my-project",
        name: "feature-branch",
      });
      assertEquals(valid.success, true);

      const missingName = vfRemoteCreateBranch.inputSchema.safeParse({
        project: "my-project",
      });
      assertEquals(missingName.success, false);
    });

    it("should accept optional base_branch_id", () => {
      const result = vfRemoteCreateBranch.inputSchema.safeParse({
        project: "my-project",
        name: "feature-branch",
        base_branch_id: "abc123",
      });
      assertEquals(result.success, true);
    });
  });

  describe("vfRemoteMergeBranch", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteMergeBranch.name, "vf_remote_merge_branch");
    });

    it("should require project and branch_id", () => {
      const valid = vfRemoteMergeBranch.inputSchema.safeParse({
        project: "my-project",
        branch_id: "branch-123",
      });
      assertEquals(valid.success, true);

      const missingBranch = vfRemoteMergeBranch.inputSchema.safeParse({
        project: "my-project",
      });
      assertEquals(missingBranch.success, false);
    });
  });

  describe("vfRemoteDeleteBranch", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteDeleteBranch.name, "vf_remote_delete_branch");
    });

    it("should require project and branch_id", () => {
      const valid = vfRemoteDeleteBranch.inputSchema.safeParse({
        project: "my-project",
        branch_id: "branch-123",
      });
      assertEquals(valid.success, true);
    });
  });

  describe("vfRemoteCreateProject", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteCreateProject.name, "vf_remote_create_project");
    });

    it("should require slug", () => {
      const valid = vfRemoteCreateProject.inputSchema.safeParse({
        slug: "my-project",
      });
      assertEquals(valid.success, true);

      const missingSlug = vfRemoteCreateProject.inputSchema.safeParse({});
      assertEquals(missingSlug.success, false);
    });

    it("should accept optional template and is_public", () => {
      const result = vfRemoteCreateProject.inputSchema.safeParse({
        slug: "my-project",
        template: "ai-agent",
        is_public: true,
      });
      assertEquals(result.success, true);
    });
  });

  describe("vfRemoteCloneProject", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteCloneProject.name, "vf_remote_clone_project");
    });

    it("should require source_project and target_slug", () => {
      const valid = vfRemoteCloneProject.inputSchema.safeParse({
        source_project: "source-proj",
        target_slug: "clone-project",
      });
      assertEquals(valid.success, true);

      const missingTarget = vfRemoteCloneProject.inputSchema.safeParse({
        source_project: "source-proj",
      });
      assertEquals(missingTarget.success, false);
    });

    it("should accept optional file_pattern", () => {
      const result = vfRemoteCloneProject.inputSchema.safeParse({
        source_project: "source-proj",
        target_slug: "clone-project",
        file_pattern: "*.tsx",
      });
      assertEquals(result.success, true);
    });
  });

  describe("tool execute happy-path behavior", () => {
    const resetEnv = () => {
      _setEnvironmentConfigForTesting({
        apiBaseUrl: "https://api.remote-vf.test/api",
        apiToken: "token-123",
        nodeEnv: "test",
        veryfrontEnv: "test",
        veryfrontMode: "test",
        debug: false,
        ci: false,
        denoTesting: false,
        perfEnabled: false,
        publicApiBaseUrl: "https://api.remote-vf.test",
        apiUrl: "https://api.remote-vf.test/graphql",
        projectSlug: "project",
      });
    };

    for (const binaryAt of ["list", "detail"]) {
      it(`rejects binary clone before creating a destination (${binaryAt})`, async () => {
        resetEnv();
        const writes: string[] = [];
        const binary = {
          content_type: "application/octet-stream",
          byte_size: 7,
          content_hash: "a".repeat(64),
        };
        const result = await withMockFetch((input, init) => {
          const request = new Request(input, init);
          const url = new URL(request.url);
          if (request.method !== "GET") {
            writes.push(request.method + " " + url.pathname);
            return Promise.resolve(Response.json({ id: "destination", slug: "copy" }));
          }
          const isList = url.pathname.endsWith("/files");
          const file = {
            path: "knowledge/a.bin",
            content: "",
            size: 7,
            type: "virtual_file",
            ...(binaryAt === "detail" && isList ? {} : { binary }),
          };
          return Promise.resolve(Response.json(isList ? { data: [file] } : file));
        }, () => vfRemoteCloneProject.execute({ source_project: "source", target_slug: "copy" }));
        assertEquals(result.success, false);
        assertEquals(
          result.error,
          'Cannot clone binary file "knowledge/a.bin" as text. No destination project was created.',
        );
        assertEquals(writes, []);
      });
    }

    it("clones selected text files after source preflight", async () => {
      resetEnv();
      const events: string[] = [];
      const content = "export const kept = true;";
      const result = await withMockFetch(
        async (input, init) => {
          const request = new Request(input, init);
          const url = new URL(request.url);
          events.push(request.method + " " + url.pathname);
          if (request.method === "POST") return Response.json({ id: "destination", slug: "copy" });
          if (request.method === "PUT") {
            assertEquals(await request.json(), { content });
            return Response.json({ id: "copied", path: "app/page.tsx" });
          }
          const file = { path: "app/page.tsx", content, type: "virtual_file" };
          if (url.pathname.endsWith("/files")) {
            assertEquals(url.searchParams.get("pattern"), "app/**");
            return Response.json({ data: [file] });
          }
          return Response.json(file);
        },
        () =>
          vfRemoteCloneProject.execute({
            source_project: "source",
            target_slug: "copy",
            file_pattern: "app/**",
          }),
      );
      assertEquals(result.success, true);
      assertEquals(result.files_copied, 1);
      assertEquals(events.slice(0, 2), [
        "GET /api/source/files",
        "GET /api/source/files/app/page.tsx",
      ]);
      assertEquals(events[2], "POST /api/projects");
    });

    it("loads a file via API with encoded path and returns typed payload", async () => {
      resetEnv();

      let requestUrl = "";
      let requestMethod = "";
      let requestAuth = "";
      const response = {
        id: "1",
        path: "pages/index.tsx",
        content: "export default function Page() {}",
        size: 42,
        type: "file",
        updated_at: "2024-01-01T00:00:00.000Z",
      };

      const result = await withMockFetch(async (input, init) => {
        const request = new Request(input, init);
        requestUrl = request.url;
        requestMethod = request.method;
        requestAuth = request.headers.get("Authorization") ?? "";
        return new Response(
          JSON.stringify(response),
          { headers: { "Content-Type": "application/json" } },
        );
      }, async () => {
        return await vfRemoteGetFile.execute({
          project: "my-project",
          path: "pages/index.tsx",
        });
      });

      assertEquals(requestUrl, "https://api.remote-vf.test/api/my-project/files/pages/index.tsx");
      assertEquals(requestMethod, "GET");
      assertEquals(requestAuth, "Bearer token-123");
      assertEquals(result.success, true);
      assertEquals(result.file?.path, "pages/index.tsx");
      assertEquals(result.file?.size, 42);
    });

    for (const branch of [undefined, "feature"]) {
      for (const byteSize of [0, 7]) {
        it(`preserves binary descriptor and immutable identity in remote reads (${branch ?? "main"}, ${byteSize})`, async () => {
          resetEnv();
          const file = {
            id: "11111111-1111-4111-8111-111111111111",
            version_id: "22222222-2222-4222-8222-222222222222",
            path: "knowledge/a.bin",
            content: "",
            type: "virtual_file",
            size_bytes: byteSize,
            size: byteSize,
            binary: {
              content_type: "application/octet-stream",
              byte_size: byteSize,
              content_hash: "a".repeat(64),
            },
          };
          let fields = "";
          const [detail, list] = await withMockFetch((input, init) => {
            const url = new URL(new Request(input, init).url);
            const isList = url.pathname.endsWith("/files");
            if (isList) fields = url.searchParams.get("fields") ?? "";
            return Promise.resolve(Response.json(isList ? { data: [file] } : file));
          }, async () =>
            [
              await vfRemoteGetFile.execute({ project: "project", path: file.path, branch }),
              await vfRemoteListFiles.execute({ project: "project", branch, limit: 50 }),
            ] as const);
          assertEquals(detail.file, {
            path: file.path,
            content: "",
            type: file.type,
            size: byteSize,
            id: file.id,
            version_id: file.version_id,
            binary: file.binary,
          });
          assertEquals(list.files, [{
            path: file.path,
            type: file.type,
            size: byteSize,
            id: file.id,
            version_id: file.version_id,
            binary: file.binary,
          }]);
          assertEquals(fields.includes("binary"), true);
          assertEquals(fields.includes("version_id"), true);
        });
      }
    }

    it("reads file sizes from size_bytes and selects it on file lists", async () => {
      resetEnv();

      let listUrl = "";
      const file = {
        id: "1",
        path: "pages/index.tsx",
        content: "export default function Page() {}",
        // `size` deliberately differs so a tool that reads it is caught.
        size_bytes: 42,
        size: 1,
        type: "file",
        updated_at: "2024-01-01T00:00:00.000Z",
      };

      const [detail, list] = await withMockFetch(async (input, init) => {
        const request = new Request(input, init);
        const isList = new URL(request.url).pathname.endsWith("/files");
        if (isList) listUrl = request.url;
        return Response.json(isList ? { data: [file] } : file);
      }, async () =>
        [
          await vfRemoteGetFile.execute({ project: "my-project", path: "pages/index.tsx" }),
          await vfRemoteListFiles.execute({ project: "my-project", limit: 50 }),
        ] as const);

      assertEquals(detail.file?.size, 42);
      assertEquals(list.files, [{ path: "pages/index.tsx", type: "file", size: 42, id: "1" }]);
      assertEquals(
        new URL(listUrl).searchParams.get("fields"),
        "(id,path,type,size_bytes,size,version_id,binary)",
      );
    });

    it("selects and reads size on the branch file route, which answers no size_bytes", async () => {
      resetEnv();

      let listUrl = "";
      const result = await withMockFetch(
        (input, init) => {
          listUrl = new Request(input, init).url;
          return Promise.resolve(Response.json({
            data: [{ path: "pages/index.tsx", type: "file", size: 7 }],
          }));
        },
        async () =>
          await vfRemoteListFiles.execute({ project: "my-project", branch: "feature", limit: 50 }),
      );

      assertEquals(result.files, [{ path: "pages/index.tsx", type: "file", size: 7 }]);
      assertEquals(new URL(listUrl).pathname.endsWith("/branches/feature/files"), true);
      assertEquals(
        new URL(listUrl).searchParams.get("fields"),
        "(id,path,type,size,version_id,binary)",
      );
    });

    it("searches project file text with limit and reads data and total_matches", async () => {
      resetEnv();

      let requestUrl = "";
      let requestBody: unknown;
      const matches = [{ path: "pages/index.tsx", matches: [{ line: 1, content: "Page" }] }];

      const result = await withMockFetch(async (input, init) => {
        const request = new Request(input, init);
        requestUrl = request.url;
        requestBody = await request.json();
        return Response.json({
          data: matches,
          total_matches: 1,
          // Earlier spellings the route still serves; the tool must not prefer them.
          results: [],
          total_files: 0,
        });
      }, async () => {
        return await vfRemoteSearchFiles.execute({
          project: "my-project",
          query: "Page",
          max_results: 25,
        });
      });

      assertEquals(requestUrl, "https://api.remote-vf.test/api/my-project/files/search");
      assertEquals(requestBody, { query: "Page", limit: 25 });
      assertEquals(result.results, matches);
      assertEquals(result.total_files, 1);
    });

    it("moves a file on the file path move route and reads the moved file path", async () => {
      resetEnv();

      let requestUrl = "";
      let requestMethod = "";
      let requestBody: unknown;
      const result = await withMockFetch(async (input, init) => {
        const request = new Request(input, init);
        requestUrl = request.url;
        requestMethod = request.method;
        requestBody = await request.json();
        return Response.json({ id: "file-1", path: "pages/moved page.tsx" });
      }, async () => {
        return await vfRemoteMoveFile.execute({
          project: "my-project",
          source_path: "pages/index page.tsx",
          destination_path: "pages/moved page.tsx",
          branch: "branch-1",
        });
      });

      assertEquals(
        requestUrl,
        "https://api.remote-vf.test/api/my-project/files/pages%2Findex%20page.tsx/move?branch_id=branch-1",
      );
      assertEquals(requestMethod, "POST");
      assertEquals(requestBody, { destination_path: "pages/moved page.tsx" });
      assertEquals(result, {
        success: true,
        source_path: "pages/index page.tsx",
        destination_path: "pages/moved page.tsx",
      });
    });

    it("keeps max_results and results on the branch search route", async () => {
      resetEnv();

      let requestUrl = "";
      let requestBody: unknown;
      const matches = [{ path: "pages/index.tsx", matches: [{ line: 1, content: "Page" }] }];

      const result = await withMockFetch(async (input, init) => {
        const request = new Request(input, init);
        requestUrl = request.url;
        requestBody = await request.json();
        return Response.json({ results: matches, total_files: 1 });
      }, async () => {
        return await vfRemoteSearchFiles.execute({
          project: "my-project",
          query: "Page",
          max_results: 25,
          branch: "feature",
        });
      });

      assertEquals(
        requestUrl,
        "https://api.remote-vf.test/api/my-project/branches/feature/files/search",
      );
      assertEquals(requestBody, { query: "Page", max_results: 25 });
      assertEquals(result.results, matches);
      assertEquals(result.total_files, 1);
    });

    it("prefers the host-private credential over a blank exported token", async () => {
      resetEnv();
      // The environment snapshot keeps a whitespace-only export verbatim, and
      // the CLI treats that as "unset" when it registers the stored login
      // token host-privately. The blank export must not shadow it.
      _setEnvironmentConfigForTesting({
        ...getEnvironmentConfig(),
        apiToken: "   ",
      });
      setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
      const originalBaseUrl = getEnv("VERYFRONT_API_BASE_URL");
      const originalApiUrl = getEnv("VERYFRONT_API_URL");
      deleteEnv("VERYFRONT_API_BASE_URL");
      deleteEnv("VERYFRONT_API_URL");

      let requestAuth = "";
      let requestUrl = "";
      try {
        await withMockFetch(async (input, init) => {
          const request = new Request(input, init);
          requestUrl = request.url;
          requestAuth = request.headers.get("Authorization") ?? "";
          return new Response(
            JSON.stringify({
              id: "1",
              path: "pages/index.tsx",
              content: "export default function Page() {}",
              size: 42,
              type: "file",
              updated_at: "2024-01-01T00:00:00.000Z",
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }, async () => {
          return await vfRemoteGetFile.execute({
            project: "my-project",
            path: "pages/index.tsx",
          });
        });
      } finally {
        deleteHostSecret("VERYFRONT_API_TOKEN");
        if (originalBaseUrl === undefined) deleteEnv("VERYFRONT_API_BASE_URL");
        else setEnv("VERYFRONT_API_BASE_URL", originalBaseUrl);
        if (originalApiUrl === undefined) deleteEnv("VERYFRONT_API_URL");
        else setEnv("VERYFRONT_API_URL", originalApiUrl);
      }

      assertEquals(requestAuth, "Bearer stored-login-token");
      assertEquals(
        requestUrl,
        "https://api.veryfront.com/api/my-project/files/pages/index.tsx",
      );
    });

    it("preserves an explicitly configured REST base path", async () => {
      resetEnv();
      _setEnvironmentConfigForTesting({
        ...getEnvironmentConfig(),
        apiBaseUrl: "https://gateway.example/v1",
      });
      let requestUrl = "";

      try {
        const result = await withMockFetch(async (input) => {
          requestUrl = String(input);
          return Response.json({ files: [] });
        }, () => vfRemoteListFiles.execute({ project: "my-project", limit: 50 }));

        assertEquals(requestUrl.startsWith("https://gateway.example/v1/my-project/files?"), true);
        assertEquals(result.success, true);
      } finally {
        _resetEnvironmentConfig();
      }
    });

    it("does not send a token to a non-loopback HTTP endpoint", async () => {
      resetEnv();
      _setEnvironmentConfigForTesting({
        ...getEnvironmentConfig(),
        apiBaseUrl: "http://remote.example/api",
      });
      let fetchCalls = 0;

      try {
        const result = await withMockFetch(() => {
          fetchCalls++;
          return Promise.resolve(Response.json({ data: [] }));
        }, () => vfRemoteListFiles.execute({ project: "my-project", limit: 50 }));

        assertEquals(fetchCalls, 0);
        assertEquals(result.success, false);
        assertEquals(result.error?.includes("must use HTTPS"), true);
      } finally {
        _resetEnvironmentConfig();
      }
    });

    it("allows an explicit token at an exact HTTP loopback API endpoint", async () => {
      resetEnv();
      _setEnvironmentConfigForTesting({
        ...getEnvironmentConfig(),
        apiBaseUrl: "http://localhost:4321/api",
      });
      let requestUrl = "";
      try {
        const result = await withMockFetch((input) => {
          requestUrl = String(input);
          return Promise.resolve(Response.json({ files: [] }));
        }, () => vfRemoteListFiles.execute({ project: "my-project", limit: 50 }));
        assertEquals(result.success, true);
        assertEquals(new URL(requestUrl).origin, "http://localhost:4321");
      } finally {
        _resetEnvironmentConfig();
      }
    });

    it("returns error response when API responds with unauthorized JSON error", async () => {
      resetEnv();
      let requestUrl = "";

      const result = await withMockFetch(async (input: string | URL | Request) => {
        const request = input instanceof Request ? input : new Request(input);
        requestUrl = request.url;
        return new Response(
          JSON.stringify({ message: "Unauthorized" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }, async () => {
        return await vfRemoteGetFile.execute({
          project: "my-project",
          path: "pages/index.tsx",
        });
      });

      assertEquals(requestUrl, "https://api.remote-vf.test/api/my-project/files/pages/index.tsx");
      assertEquals(result.success, false);
      assertEquals(result.error, "Unauthorized");
    });
  });

  describe("tool execute without API token", () => {
    it("should return error for list files without token", async () => {
      _resetEnvironmentConfig();
      await assertExecuteError(
        vfRemoteListFiles.execute({
          project: "test",
          limit: 50,
        }),
      );
    });

    it("should return error for get file without token", async () => {
      _resetEnvironmentConfig();
      await assertExecuteError(
        vfRemoteGetFile.execute({
          project: "test",
          path: "index.tsx",
        }),
      );
    });

    it("should return error for delete file without token", async () => {
      _resetEnvironmentConfig();
      await assertExecuteError(
        vfRemoteDeleteFile.execute({
          project: "test",
          path: "index.tsx",
        }),
      );
    });

    it("should return error for move file without token", async () => {
      _resetEnvironmentConfig();
      await assertExecuteError(
        vfRemoteMoveFile.execute({
          project: "test",
          source_path: "a.tsx",
          destination_path: "b.tsx",
        }),
      );
    });

    it("should return error for list branches without token", async () => {
      _resetEnvironmentConfig();
      await assertExecuteError(
        vfRemoteListBranches.execute({
          project: "test",
          status: "all",
        }),
      );
    });

    it("should return error for create branch without token", async () => {
      _resetEnvironmentConfig();
      await assertExecuteError(
        vfRemoteCreateBranch.execute({
          project: "test",
          name: "feature",
        }),
      );
    });

    it("should return error for merge branch without token", async () => {
      _resetEnvironmentConfig();
      await assertExecuteError(
        vfRemoteMergeBranch.execute({
          project: "test",
          branch_id: "branch-1",
        }),
      );
    });

    it("should return error for delete branch without token", async () => {
      _resetEnvironmentConfig();
      await assertExecuteError(
        vfRemoteDeleteBranch.execute({
          project: "test",
          branch_id: "branch-1",
        }),
      );
    });

    it("should return error for create project without token", async () => {
      _resetEnvironmentConfig();
      await assertExecuteError(
        vfRemoteCreateProject.execute({
          slug: "test",
        }),
      );
    });
  });
});
