import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { cliLogger } from "#cli/utils";
import { mergeCommand } from "#cli/commands/merge/command";
import {
  computeSourceDigest,
  type PushReceipt,
  readPushReceipt,
  writePushReceipt,
} from "#cli/shared/deployment-provenance";

describe("merge dry-run REST contract", () => {
  it("finds a branch on the next page and reports canonical conflict paths without merging", async () => {
    const originalDirectory = Deno.cwd();
    const directory = await makeTempDir();
    const keys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const previous = keys.map((key) => Deno.env.get(key));
    const originalWarn = cliLogger.warn;
    const warnings: string[] = [];
    const requests: string[] = [];
    try {
      Deno.chdir(directory);
      Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
      Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
      Deno.env.set("VERYFRONT_PROJECT_SLUG", "fixture-project");
      _resetEnvironmentConfig();
      cliLogger.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
      await withMockFetch(async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        requests.push(`${request.method} ${url.pathname}${url.search}`);
        assertEquals(request.method, "GET");
        if (url.pathname === "/projects/fixture-project/branches") {
          assertEquals(url.searchParams.get("search"), "fixture");
          assertEquals(url.searchParams.get("limit"), "100");
          return Response.json(
            url.searchParams.has("cursor")
              ? {
                data: [{ id: "branch-id", name: "fixture", project_id: "project-id" }],
                page_info: { next: null },
              }
              : {
                data: [{ id: "other-id", name: "fixture-other", project_id: "project-id" }],
                page_info: { next: "page-two" },
              },
          );
        }
        assertEquals(url.pathname, "/projects/fixture-project/branches/branch-id/merge-preview");
        return Response.json({
          diffs: [
            { file_path: "app/page.tsx", has_conflicts: true },
            { file_path: "app/layout.tsx", has_conflicts: false },
          ],
        });
      }, () => mergeCommand({ branch: "fixture", dryRun: true, force: false }));
      assertEquals(requests.length, 3);
      assertEquals(requests[1]?.includes("cursor=page-two"), true);
      assertEquals(warnings, ["  1 file(s) have conflicts", "    - app/page.tsx"]);
    } finally {
      cliLogger.warn = originalWarn;
      Deno.chdir(originalDirectory);
      keys.forEach((key, i) => {
        if (previous[i] === undefined) Deno.env.delete(key);
        else Deno.env.set(key, previous[i]);
      });
      _resetEnvironmentConfig();
      await Deno.remove(directory, { recursive: true });
    }
  });
});

describe("merge push receipt", () => {
  const PUSHED_FILES = [{ path: "app/page.tsx", content: "export default () => 'Merged';\n" }];

  /**
   * Run `veryfront merge fixture --force` from a directory whose push receipt
   * names the fixture branch, against a control plane whose file listing for
   * main answers with `filesResponse`.
   */
  async function mergeFromPushedDirectory(filesResponse: () => Response): Promise<{
    pushed: PushReceipt;
    after: PushReceipt | null;
    requests: string[];
    output: string[];
  }> {
    const originalDirectory = Deno.cwd();
    const directory = await makeTempDir();
    const keys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const previous = keys.map((key) => Deno.env.get(key));
    const originalLog = console.log;
    const output: string[] = [];
    const requests: string[] = [];
    try {
      const sourceDigest = await computeSourceDigest(PUSHED_FILES);
      const pushed = await writePushReceipt(directory, {
        controlPlane: "https://control.example.test",
        projectId: "550e8400-e29b-41d4-a716-446655440000",
        projectSlug: "fixture-project",
        branch: "fixture",
        commitSha: null,
        sourceDigest,
        localSourceDigest: sourceDigest,
        localPaths: PUSHED_FILES.map((file) => file.path),
        clean: false,
        pushedAt: "2026-11-12T09:00:00.000Z",
      });
      Deno.chdir(directory);
      Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
      Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
      Deno.env.set("VERYFRONT_PROJECT_SLUG", "fixture-project");
      _resetEnvironmentConfig();
      console.log = (...args: unknown[]) => output.push(args.map(String).join(" "));
      await withMockFetch(async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        requests.push(`${request.method} ${url.pathname}`);
        if (url.pathname === "/projects/fixture-project/branches") {
          return Response.json({
            data: [{ id: "branch-id", name: "fixture", project_id: "project-id" }],
            page_info: { next: null },
          });
        }
        if (url.pathname === "/projects/fixture-project/branches/branch-id/merge") {
          return Response.json({
            success: true,
            branch: { id: "branch-id", name: "fixture", project_id: "project-id" },
            merged_documents: 1,
            added_documents: 0,
            deleted_documents: 0,
            auto_merged_documents: 0,
          });
        }
        assertEquals(url.pathname, "/projects/fixture-project/files");
        return filesResponse();
      }, () => mergeCommand({ branch: "fixture", dryRun: false, force: true }));
      return { pushed, after: await readPushReceipt(directory), requests, output };
    } finally {
      console.log = originalLog;
      Deno.chdir(originalDirectory);
      keys.forEach((key, i) => {
        if (previous[i] === undefined) Deno.env.delete(key);
        else Deno.env.set(key, previous[i]);
      });
      _resetEnvironmentConfig();
      await Deno.remove(directory, { recursive: true });
    }
  }

  it("points the receipt at main after a merge that leaves main holding the pushed source", async () => {
    const { pushed, after, requests } = await mergeFromPushedDirectory(() =>
      Response.json({ data: PUSHED_FILES, page_info: { next: null } })
    );

    assertEquals(requests, [
      "GET /projects/fixture-project/branches",
      "POST /projects/fixture-project/branches/branch-id/merge",
      "GET /projects/fixture-project/files",
    ]);
    assertEquals(after, { ...pushed, branch: "main" });
  });

  it("reports the merge and keeps the receipt when main's files cannot be read", async () => {
    const { pushed, after, requests, output } = await mergeFromPushedDirectory(() =>
      Response.json({ error: "unavailable" }, { status: 404 })
    );

    assertEquals(
      requests.includes("POST /projects/fixture-project/branches/branch-id/merge"),
      true,
    );
    assertEquals(after, pushed);
    assertEquals(output.some((line) => line.includes('Merged "fixture" into main')), true);
  });
});
