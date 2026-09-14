import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { cliLogger } from "../../../cli/utils/index.ts";
import { mergeCommand } from "../../../cli/commands/merge/command.ts";

describe("merge dry-run REST contract", () => {
  it("finds a branch on the next page and reports canonical conflict paths without merging", async () => {
    const originalDirectory = Deno.cwd();
    const directory = await Deno.makeTempDir();
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
