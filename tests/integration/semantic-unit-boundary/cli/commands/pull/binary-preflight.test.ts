/**
 * Binary pull safety needs real local files and process environment state.
 * Keep this byte-preservation regression at the semantic integration boundary.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { deleteEnv, getEnv, makeTempDir, setEnv } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";
import { pullCommand } from "../../../../../../cli/commands/pull/command.ts";

for (
  const options of [
    { existing: true, force: true, bytes: 7 },
    { existing: true, force: false, bytes: 7 },
    { existing: false, force: true, bytes: 7 },
    { existing: false, force: false, bytes: 0 },
  ]
) {
  it(`rejects selected REST binary before any pull writes (${JSON.stringify(options)})`, async () => {
    const directory = await makeTempDir();
    const token = getEnv("VERYFRONT_API_TOKEN");
    const original = new Uint8Array([239, 187, 191, 0, 255, 128, 10]);
    const markdown = '---\nokf_version: "1.0"\nresource: ./a.bin\n---\n# Remote\n';
    try {
      setEnv("VERYFRONT_API_TOKEN", "synthetic-pull-test");
      _resetEnvironmentConfig();
      if (options.existing) {
        await Deno.mkdir(join(directory, "knowledge"));
        await Deno.writeFile(join(directory, "knowledge/a.bin"), original);
        await Deno.writeTextFile(join(directory, "knowledge/index.md"), "keep existing Markdown\n");
      }
      const before = await Array.fromAsync(Deno.readDir(directory));
      const requested: string[] = [];
      const transport: typeof fetch = (input) => {
        const url = new URL(String(input));
        requested.push(url.pathname);
        if (url.pathname === "/projects/synthetic/files") {
          return Promise.resolve(Response.json({
            data: [
              { path: "knowledge/index.md", content: markdown, type: "virtual_file" },
              {
                path: "knowledge/a.bin",
                content: "",
                type: "virtual_file",
                size_bytes: options.bytes,
                binary: {
                  content_type: "application/octet-stream",
                  byte_size: options.bytes,
                  content_hash: "a".repeat(64),
                },
              },
            ],
            page_info: { next: null },
          }));
        }
        if (url.pathname === "/projects/synthetic") {
          return Promise.resolve(
            Response.json({ id: "11111111-1111-4111-8111-111111111111", slug: "synthetic" }),
          );
        }
        throw new Error(`Unexpected test request: ${url.pathname}`);
      };
      await assertRejects(
        () =>
          pullCommand({
            projectDir: directory,
            projectSlug: "synthetic",
            quiet: true,
            force: options.force,
            transport,
          }),
        Error,
        'Cannot pull binary file "knowledge/a.bin" as text. No files in this project were changed.',
      );
      assertEquals(
        (await Array.fromAsync(Deno.readDir(directory))).map((entry) => entry.name).sort(),
        before.map((entry) => entry.name).sort(),
      );
      if (options.existing) {
        assertEquals(await Deno.readFile(join(directory, "knowledge/a.bin")), original);
        assertEquals(
          await Deno.readTextFile(join(directory, "knowledge/index.md")),
          "keep existing Markdown\n",
        );
      }
      assertEquals(requested, ["/projects/synthetic/files"]);
    } finally {
      if (token === undefined) deleteEnv("VERYFRONT_API_TOKEN");
      else setEnv("VERYFRONT_API_TOKEN", token);
      _resetEnvironmentConfig();
      await Deno.remove(directory, { recursive: true });
    }
  });
}

for (const ignored of [false, true]) {
  it(`preserves unselected binary and still pulls text (ignored: ${ignored})`, async () => {
    const directory = await makeTempDir();
    const token = getEnv("VERYFRONT_API_TOKEN");
    const original = new Uint8Array([0, 255, 128]);
    const markdown = ignored
      ? '---\nokf_version: "1.0"\nresource: ./a.bin\n---\n# Remote\n'
      : "# Remote text without a binary reference\n";
    try {
      setEnv("VERYFRONT_API_TOKEN", "synthetic-pull-test");
      _resetEnvironmentConfig();
      await Deno.mkdir(join(directory, "knowledge"));
      await Deno.writeFile(join(directory, "knowledge/a.bin"), original);
      if (ignored) await Deno.writeTextFile(join(directory, ".vfignore"), "knowledge/a.bin\n");
      const transport: typeof fetch = (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/projects/synthetic/files") {
          return Promise.resolve(Response.json({
            data: [
              { path: "knowledge/index.md", content: markdown, type: "virtual_file" },
              {
                path: "knowledge/a.bin",
                content: "",
                type: "virtual_file",
                binary: {
                  content_type: "application/octet-stream",
                  byte_size: 3,
                  content_hash: "a".repeat(64),
                },
              },
            ],
            page_info: { next: null },
          }));
        }
        if (url.pathname === "/projects/synthetic") {
          return Promise.resolve(
            Response.json({ id: "11111111-1111-4111-8111-111111111111", slug: "synthetic" }),
          );
        }
        throw new Error(`Unexpected test request: ${url.pathname}`);
      };
      await pullCommand({
        projectDir: directory,
        projectSlug: "synthetic",
        force: true,
        quiet: true,
        transport,
      });
      assertEquals(await Deno.readFile(join(directory, "knowledge/a.bin")), original);
      assertEquals(await Deno.readTextFile(join(directory, "knowledge/index.md")), markdown);
    } finally {
      if (token === undefined) deleteEnv("VERYFRONT_API_TOKEN");
      else setEnv("VERYFRONT_API_TOKEN", token);
      _resetEnvironmentConfig();
      await Deno.remove(directory, { recursive: true });
    }
  });
}
