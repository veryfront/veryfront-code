import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fromFileUrl } from "#std/path";
import {
  auditRepoMetaProperties,
  collectShippedSources,
  findBuildUnsafeMetaProperties,
  ParseFailure,
  type ShippedSourceConfig,
  shippedSourceRoots,
} from "./dnt-meta-property-safety.ts";

const repoRoot = fromFileUrl(new URL("../../", import.meta.url));

async function readRepoConfig(): Promise<ShippedSourceConfig> {
  return JSON.parse(
    await Deno.readTextFile(`${repoRoot}deno.json`),
  ) as ShippedSourceConfig;
}

describe("DNT meta-property safety", () => {
  describe("findBuildUnsafeMetaProperties", () => {
    it("reports new.target, which DNT rewrites into the import.meta ponyfill", () => {
      const uses = findBuildUnsafeMetaProperties(
        [
          "class Base extends Error {",
          "  constructor() {",
          "    super();",
          "    this.name = new.target.name;",
          "  }",
          "}",
        ].join("\n"),
        "example.ts",
      );

      assertEquals(uses.length, 1);
      assertEquals(uses[0]?.line, 4);
      assertEquals(uses[0]?.expression, "new.target");
    });

    it("accepts this.constructor, which survives the transform", () => {
      const uses = findBuildUnsafeMetaProperties(
        [
          "class Base extends Error {",
          "  constructor() {",
          "    super();",
          "    this.name = this.constructor.name;",
          "  }",
          "}",
        ].join("\n"),
        "example.ts",
      );

      assertEquals(uses, []);
    });

    it("ignores new.target spelled inside comments and strings", () => {
      const uses = findBuildUnsafeMetaProperties(
        [
          "// never use new.target here",
          'const hint = "new.target is rewritten by DNT";',
        ].join("\n"),
        "example.ts",
      );

      assertEquals(uses, []);
    });

    it("leaves import.meta alone — the ponyfill is correct for it", () => {
      const uses = findBuildUnsafeMetaProperties(
        "export const here = import.meta.url;",
        "example.ts",
      );

      assertEquals(uses, []);
    });

    it("fails closed when a file cannot be parsed", () => {
      assertThrows(
        () => findBuildUnsafeMetaProperties("class {{{", "broken.ts"),
        ParseFailure,
      );
    });
  });

  describe("shippedSourceRoots", () => {
    it("covers every entry point DNT compiles", async () => {
      const config = await readRepoConfig();
      const roots = shippedSourceRoots(config);

      for (const path of Object.values(config.exports ?? {})) {
        const relative = path.replace(/^\.\//, "");
        assertEquals(
          roots.some((root) => relative.startsWith(`${root}/`)),
          true,
          `${path} is a DNT entry point but sits outside the audited roots`,
        );
      }

      for (const member of config.workspace ?? []) {
        if (!member.startsWith("./extensions/")) continue;
        assertEquals(
          roots.includes(member.replace(/^\.\//, "")),
          true,
          `${member} gets its own DNT build but sits outside the audited roots`,
        );
      }
    });

    it("keeps templates/ in scope, which the ./scaffold export ships", async () => {
      assertEquals(
        shippedSourceRoots(await readRepoConfig()).includes("templates"),
        true,
      );
    });

    it("derives roots from the export map rather than a hard-coded list", () => {
      assertEquals(
        shippedSourceRoots({
          exports: { "./future": "./somewhere-new/entry.ts" },
        }),
        ["react", "somewhere-new"],
      );
    });
  });

  describe("collectShippedSources", () => {
    it("treats an absent scan root as empty", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-dnt-meta-absent-" });
      try {
        assertEquals(await collectShippedSources(`${root}/never-created`), []);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("propagates a scan-root failure that is not a missing directory", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-dnt-meta-not-dir-" });
      try {
        const file = `${root}/not-a-directory.ts`;
        await Deno.writeTextFile(file, "export const ok = true;\n");
        await assertRejects(() => collectShippedSources(file));
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  });

  it("audits a checkout whose scan roots are absent", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-dnt-meta-empty-" });
    try {
      await Deno.writeTextFile(
        `${root}/deno.json`,
        JSON.stringify({ exports: { ".": "./src/index.ts" } }),
      );

      const { uses, parseFailures } = await auditRepoMetaProperties(`${root}/`);

      assertEquals(uses, []);
      assertEquals(parseFailures, []);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("finds no new.target anywhere in the shipped sources", async () => {
    const { uses, parseFailures } = await auditRepoMetaProperties(repoRoot);

    assertEquals(parseFailures, []);
    assertEquals(
      uses.map((use) => `${use.file}:${use.line}`),
      [],
      "DNT rewrites new.target into the import.meta ponyfill, so these are " +
        "silently broken in the published npm package. Use this.constructor.",
    );
  });
});
