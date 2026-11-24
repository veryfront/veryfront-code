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
      const refs: string[] = [];
      const input = {
        apiUrl: "https://api.example.test",
        projectId: "project-1",
        authToken: "release-bound-token",
        releaseId: "release-1",
        pathPrefix: "skills/a*",
        fetch: (value: string) => {
          const url = new URL(value);
          refs.push(url.pathname);
          assertEquals(url.searchParams.get("pattern"), "skills/**");
          input.releaseId = "release-2";
          input.pathPrefix = "other-directory";
          const second = url.searchParams.has("cursor");
          return Promise.resolve(
            Response.json({
              data: [{ path: second ? "skills/a*/second.md" : "skills/a*/first.md" }],
              page_info: { next: second ? null : "next-page" },
            }),
          );
        },
      };
      assertEquals((await list(input)).map((file) => file.path), [
        "skills/a*/first.md",
        "skills/a*/second.md",
      ]);
      assertEquals(refs, [
        "/projects/project-1/releases/release-1/files",
        "/projects/project-1/releases/release-1/files",
      ]);
    });
  }

  for (const create of [createRuntimeProjectFilesClient, createStrictRuntimeProjectFilesClient]) {
    for (const prefix of ["skills/a*", "skills/[team]?", "a*"]) {
      it(`keeps literal prefix ${prefix} and counts only matching files through ${create.name}`, async () => {
        const patterns: Array<string | null> = [];
        let overLimit = false;
        const client = create({
          apiUrl: "https://api.example.test",
          fetch: (value: string) => {
            const url = new URL(value), index = Number(url.searchParams.get("cursor") ?? "0");
            patterns.push(url.searchParams.get("pattern"));
            const paths = [
              `${prefix}-other/SKILL.md`,
              `${prefix}/SKILL.md`,
              overLimit ? `${prefix}/extra.md` : "skills/another/SKILL.md",
            ];
            return Promise.resolve(
              Response.json({
                data: [{ path: paths[index] }],
                page_info: { next: index === 2 ? null : String(index + 1) },
              }),
            );
          },
        });
        const source = {
          projectId: "project-1",
          releaseId: "release-1",
          authToken: "source-token",
          pathPrefix: prefix,
          maximumEntries: 1,
        };
        assertEquals(await client.getProjectFiles(source), [{ path: `${prefix}/SKILL.md` }]);
        assertEquals(patterns, Array(3).fill(prefix.includes("/") ? "skills/**" : null));
        overLimit = true;
        await assertRejects(() => client.getProjectFiles(source));
      });
    }

    it(`uses release-file transport accepted by a release-bound source token through ${create.name}`, async () => {
      const projectId = "11111111-1111-4111-8111-111111111111";
      const releaseId = "22222222-2222-4222-8222-222222222222";
      const prefix = `/projects/${projectId}/releases/${releaseId}/files`;
      const calls: string[] = [];
      const client = create({
        apiUrl: "https://api.example.test",
        fetch: (value: string, init: RequestInit) => {
          const url = new URL(value);
          calls.push(url.pathname);
          assertEquals(
            new Headers(init.headers).get("authorization"),
            "Bearer release-bound-token",
          );
          // The API's published_source_read transport admits immutable file routes,
          // not the draft files route with a release query parameter.
          if (
            !(url.pathname === prefix || url.pathname === `${prefix}/AGENTS.md`) ||
            url.searchParams.has("ref") ||
            (url.pathname === prefix && url.searchParams.get("pattern") !== "skills/**")
          ) {
            return Promise.resolve(
              Response.json({ detail: "Source transport denied" }, { status: 403 }),
            );
          }
          return Promise.resolve(
            url.pathname.endsWith("/AGENTS.md")
              ? Response.json({ path: "AGENTS.md", content: "Release instructions" })
              : Response.json({ data: [], page_info: { next: null } }),
          );
        },
      });
      const source = { projectId, releaseId, authToken: "release-bound-token" };
      assertEquals(
        (await client.getProjectFile({ ...source, path: "AGENTS.md" }))?.content,
        "Release instructions",
      );
      assertEquals(await client.getProjectFiles({ ...source, pathPrefix: "skills" }), []);
      assertEquals(calls, [`${prefix}/AGENTS.md`, prefix]);
    });

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
        calls.map((url) => url.pathname),
        [
          "/projects/project-1/releases/release-1/files/AGENTS.md",
          "/projects/project-1/releases/release-1/files",
          "/projects/project-1/releases/release-1/files",
        ],
      );
      assertEquals(calls.some((url) => url.searchParams.has("ref")), false);
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
