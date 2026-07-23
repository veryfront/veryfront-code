import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as dotenv from "./dotenv.ts";

async function withEnvFile(
  content: string,
  run: (path: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "veryfront-dotenv-"));
  const path = join(root, ".env");
  try {
    await writeFile(path, content);
    await run(path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("platform/compat/std/dotenv", () => {
  it("loads the supported dotenv grammar consistently", async () => {
    await withEnvFile(
      [
        "export BASIC=basic",
        "EMPTY=",
        "INLINE=hello # comment",
        "SINGLE='literal\\nvalue'",
        'MULTILINE="first',
        'second"',
        "BASE=base",
        "EXPANDED=${BASE}-suffix",
      ].join("\n"),
      async (path) => {
        const values = await dotenv.load({ envPath: pathToFileURL(path) });

        assertEquals(values.BASIC, "basic");
        assertEquals(values.EMPTY, "");
        assertEquals(values.INLINE, "hello");
        assertEquals(values.SINGLE, "literal\\nvalue");
        assertEquals(values.MULTILINE, "first\nsecond");
        assertEquals(values.BASE, "base");
        assertEquals(values.EXPANDED, "base-suffix");
      },
    );
  });

  it("supports a disabled env path and missing files", async () => {
    assertEquals(Object.keys(await dotenv.load({ envPath: null })).length, 0);
    assertEquals(
      Object.keys(await dotenv.load({ envPath: join(tmpdir(), "veryfront-missing-dotenv") }))
        .length,
      0,
    );
  });

  it("exports values without overwriting the process environment", async () => {
    const existingKey = "VF_DOTENV_EXISTING_TEST";
    const newKey = "VF_DOTENV_NEW_TEST";
    const previousExisting = process.env[existingKey];
    const previousNew = process.env[newKey];
    process.env[existingKey] = "host";
    delete process.env[newKey];

    try {
      await withEnvFile(
        `${existingKey}=file\n${newKey}=loaded`,
        async (path) => {
          const values = await dotenv.load({ envPath: path, export: true });
          assertEquals(values[existingKey], "file");
          assertEquals(values[newKey], "loaded");
          assertEquals(process.env[existingKey], "host");
          assertEquals(process.env[newKey], "loaded");
        },
      );
    } finally {
      if (previousExisting === undefined) delete process.env[existingKey];
      else process.env[existingKey] = previousExisting;
      if (previousNew === undefined) delete process.env[newKey];
      else process.env[newKey] = previousNew;
    }
  });

  it("exposes the upstream parse, loadSync, and stringify surface", async () => {
    assertEquals(typeof dotenv.parse, "function");
    assertEquals(typeof dotenv.loadSync, "function");
    assertEquals(typeof dotenv.stringify, "function");

    const parsed = dotenv.parse("GREETING=hello world\nEMPTY=");
    assertEquals(parsed.GREETING, "hello world");
    assertEquals(parsed.EMPTY, "");
    assertEquals(dotenv.stringify({ GREETING: "hello world" }), "GREETING='hello world'");

    await withEnvFile("SYNC=value", async (path) => {
      assertEquals(dotenv.loadSync({ envPath: path }), { SYNC: "value" });
    });
  });
});
