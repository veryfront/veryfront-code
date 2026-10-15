import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join } from "#veryfront/platform/compat/path/index.ts";
import { loadIgnoreChecker } from "../../sync/ignore.ts";
import { pushCommand, scanLocalFiles } from "./command.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";

const companions = [
  "references/attesters/sql_equality.py",
  "references/computations/lib/revenue.sql",
  "references/executors/checksum",
  "references/notebooks/gross-margin.ipynb",
  "references/raw/orders.csv",
  "references/scripts/load.sh",
  "references/scripts/model.r",
  "references/xml/order-schema.xml",
];
async function withFiles(files: Record<string, string>, run: (directory: string) => Promise<void>) {
  const directory = await Deno.makeTempDir();
  try {
    for (const [path, content] of Object.entries(files)) {
      await Deno.mkdir(dirname(join(directory, path)), { recursive: true });
      await Deno.writeTextFile(join(directory, path), content);
    }
    await run(directory);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

describe("native push OKF companions", () => {
  it("preserves all 16 bundle files, including explicitly referenced opaque assets", async () => {
    const files: Record<string, string> = {
      "acme/index.md": "---\nokf_version: '0.1'\n---\n# Index\n",
      "acme/log.md": "# Log\n",
      "acme/metrics/revenue.md": "---\ntype: Metric\nunknown: {keep: true}\nsources:\n" +
        companions.map((path) => `  - resource: /${path}`).join("\n") + "\n---\nRevenue\r\n",
      "acme/metrics/gross-margin.md": "\uFEFF---\ntype: Metric\n---\nGross margin\r\n",
      "acme/policies/revenue-recognition.md": "---\ntype: Policy\n---\nPolicy\n",
      "acme/references/skills/run-on-bq.md": "---\ntype: Reference\n---\nSkill\n",
      "acme/references/source-docs/revenue-policy.md": "---\ntype: Reference\n---\nSource\n",
      "acme/tables/orders.md": "---\ntype: Table\n---\nOrders\n",
      ...Object.fromEntries(companions.map((path) => [`acme/${path}`, `opaque:${path}\r\n`])),
    };
    await withFiles(files, async (directory) => {
      const scanned = await scanLocalFiles(directory, await loadIgnoreChecker(directory));
      assertEquals(scanned.map((file) => file.path).sort(), Object.keys(files).sort());
      for (const file of scanned) assertEquals(file.content, files[file.path]);
    });
  });

  it("keeps ignored, protected, unreferenced and escaped assets excluded", async () => {
    await withFiles({
      "acme/index.md": "---\nokf_version: '0.1'\n---\n# Index\n",
      "acme/doc.md":
        "---\ntype: Metric\nsources:\n  - /references/allowed.sql\n  - /references/ignored.sql\n  - /node_modules/dependency.sql\n  - /.env.secret\n  - ../../outside.sql\n  - https://example.com/external.sql\n---\n",
      "acme/references/allowed.sql": "select 1;",
      "acme/references/ignored.sql": "ignored",
      "acme/references/unreferenced.sql": "unreferenced",
      "acme/node_modules/dependency.sql": "dependency",
      "acme/.env.secret": "not a credential, synthetic exclusion control",
      "outside.sql": "outside",
      ".vfignore": "acme/references/ignored.sql\n",
    }, async (directory) => {
      const scanned = await scanLocalFiles(directory, await loadIgnoreChecker(directory));
      assertEquals(scanned.map((file) => file.path).sort(), [
        "acme/doc.md",
        "acme/index.md",
        "acme/references/allowed.sql",
      ]);
    });
  });

  for (const branch of ["main", "existing-preview"]) {
    it(`uploads, verifies and prunes referenced companions on ${branch}`, async () => {
      await withFiles({
        "acme/index.md": "---\nokf_version: '0.1'\n---\n# Index\n",
        "acme/doc.md":
          "---\ntype: Metric\ncomputation: /references/query.sql\nsources: [/references/branch-only.sql]\n---\n",
        "acme/references/query.sql": "select 1;\r\n",
        "remote-only.sql": "local unreferenced bytes",
      }, async (directory) => {
        const keys = [
          "VERYFRONT_API_TOKEN",
          "VERYFRONT_API_URL",
          "VERYFRONT_PROJECT_SLUG",
          "VERYFRONT_PROJECT_ID",
          "TENANT_PROJECT_SLUG",
          "TENANT_PROJECT_ID",
        ];
        const saved = keys.map((key) => Deno.env.get(key));
        const remote = new Map<string, { path: string; content: string; version_id: string }>();
        remote.set("index.md", {
          path: "index.md",
          content: "---\nokf_version: '0.1'\n---\n",
          version_id: "00000000-0000-4000-8000-000000000004",
        });
        remote.set("old.md", {
          path: "old.md",
          content: "---\ntype: Metric\ncomputation: /remote-only.sql\n---\n",
          version_id: "00000000-0000-4000-8000-000000000005",
        });
        remote.set("remote-only.sql", {
          path: "remote-only.sql",
          content: "remote bytes",
          version_id: "00000000-0000-4000-8000-000000000006",
        });
        const uploads: string[] = [];
        try {
          for (const key of keys) Deno.env.delete(key);
          Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
          Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
          _resetEnvironmentConfig();
          await withMockFetch(async (input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            const url = new URL(request.url);
            if (request.method === "GET" && url.pathname.endsWith("/files")) {
              return Response.json({
                data: branch === "main" || url.searchParams.get("ref") === `branch:${branch}`
                  ? [...remote.values()]
                  : [],
                page_info: {},
              });
            }
            if (request.method === "GET" && url.pathname.endsWith("/branches")) {
              return Response.json({
                data: [{ id: "00000000-0000-4000-8000-000000000002", name: branch }],
                page_info: {},
              });
            }
            if (request.method === "DELETE" && url.pathname.includes("/files/")) {
              remote.delete(decodeURIComponent(url.pathname.split("/files/")[1] ?? ""));
              return Response.json({ success: true });
            }
            if (request.method === "GET" && /^\/projects\/[^/]+$/.test(url.pathname)) {
              return Response.json({ id: "project-123", slug: "my-project" });
            }
            if (request.method === "PUT" && url.pathname.includes("/files/")) {
              const path = decodeURIComponent(url.pathname.split("/files/")[1] ?? "");
              const body: unknown = await request.json();
              if (
                body == null || typeof body !== "object" || !("content" in body) ||
                typeof body.content !== "string"
              ) throw new Error("invalid upload");
              const file = {
                path,
                content: body.content,
                version_id: "00000000-0000-4000-8000-000000000001",
              };
              remote.set(path, file);
              uploads.push(path);
              return Response.json(file);
            }
            throw new Error(`Unexpected ${request.method} ${url.pathname}`);
          }, async () => {
            await pushCommand({
              projectSlug: "my-project",
              projectDir: directory,
              branch,
              quiet: true,
              force: true,
            });
            assertEquals(remote.get("remote-only.sql")?.content, "remote bytes");
            assertEquals(uploads.sort(), [
              "acme/doc.md",
              "acme/index.md",
              "acme/references/query.sql",
            ]);
            assertEquals(remote.get("acme/references/query.sql")?.content, "select 1;\r\n");
            await pushCommand({
              projectSlug: "my-project",
              projectDir: directory,
              branch,
              quiet: true,
            });
            assertEquals(uploads.length, 3);
            if (branch !== "main") {
              remote.set("acme/references/branch-only.sql", {
                path: "acme/references/branch-only.sql",
                content: "select 2;",
                version_id: "00000000-0000-4000-8000-000000000003",
              });
            }
            await Deno.remove(join(directory, "acme/references/query.sql"));
            await pushCommand({
              projectSlug: "my-project",
              projectDir: directory,
              branch,
              quiet: true,
              prune: true,
              force: true,
            });
            assertEquals(remote.has("acme/references/query.sql"), false);
            assertEquals(remote.has("acme/references/branch-only.sql"), false);
          });
        } finally {
          keys.forEach((key, index) => {
            const value = saved[index];
            if (value === undefined) Deno.env.delete(key);
            else Deno.env.set(key, value);
          });
          _resetEnvironmentConfig();
        }
      });
    });
  }

  it("rejects an explicitly referenced opaque symbolic link before reading its content", async () => {
    await withFiles({
      "acme/index.md": "---\nokf_version: '0.1'\n---\n# Index\n",
      "acme/doc.md": "---\ntype: Metric\ncomputation: /linked.sql\n---\n",
      "outside.sql": "outside",
    }, async (directory) => {
      await Deno.symlink(join(directory, "outside.sql"), join(directory, "acme/linked.sql"));
      const checker = await loadIgnoreChecker(directory);
      await assertRejects(
        () => scanLocalFiles(directory, checker),
        Error,
        "symbolic links",
      );
    });
  });
});
