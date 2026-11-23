import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createRuntimeProjectFilesClient,
  createStrictRuntimeProjectFilesClient,
  getRuntimeProjectFiles,
  getStrictRuntimeProjectFiles,
} from "./project-files-client.ts";

describe("runtime project file release selection", () => {
  for (const list of [getRuntimeProjectFiles, getStrictRuntimeProjectFiles]) {
    it(`does not change release between pages through ${list.name}`, async () => {
      const refs: Array<string | null> = [];
      const input = {
        apiUrl: "https://api.example.test",
        projectId: "project-1",
        authToken: "release-bound-token",
        releaseId: "release-1",
        fetch: (value: string) => {
          const url = new URL(value);
          refs.push(url.searchParams.get("ref"));
          input.releaseId = "release-2";
          const second = url.searchParams.has("cursor");
          return Promise.resolve(
            Response.json({
              data: [{ path: second ? "second.md" : "first.md" }],
              page_info: { next: second ? null : "next-page" },
            }),
          );
        },
      };
      await list(input);
      assertEquals(refs, ["release:release-1", "release:release-1"]);
    });
  }

  for (const create of [createRuntimeProjectFilesClient, createStrictRuntimeProjectFilesClient]) {
    it(`pins file reads and every listing page through ${create.name}`, async () => {
      const calls: URL[] = [];
      const client = create({
        apiUrl: "https://api.example.test",
        fetch: (value: string) => {
          const url = new URL(value);
          calls.push(url);
          return Promise.resolve(
            url.pathname.endsWith("/AGENTS.md")
              ? Response.json({ path: "AGENTS.md", content: "Release instructions" })
              : Response.json({
                data: [{ path: url.searchParams.has("cursor") ? "second.md" : "first.md" }],
                page_info: { next: url.searchParams.has("cursor") ? null : "next-page" },
              }),
          );
        },
      });
      const source = {
        projectId: "project-1",
        authToken: "release-bound-token",
        releaseId: "release-1",
      };
      await client.getProjectFile({ ...source, path: "AGENTS.md" });
      await client.getProjectFiles(source);
      assertEquals(calls.length, 3);
      assertEquals(
        calls.map((url) => url.searchParams.get("ref")),
        Array(3).fill("release:release-1"),
      );
      const count = calls.length;
      await assertRejects(() =>
        client.getProjectFile({ ...source, branchId: "main", path: "AGENTS.md" })
      );
      await assertRejects(() => client.getProjectFiles({ ...source, branchId: "main" }));
      await assertRejects(() =>
        client.getProjectFile({ ...source, releaseId: "", path: "AGENTS.md" })
      );
      assertEquals(calls.length, count);
    });
  }
});
