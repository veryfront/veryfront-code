import "#veryfront/schemas/_test-setup.ts";
/**
 * Init Command Tests
 *
 * Tests the init command types and options validation.
 */

import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { exists, makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";
import { stripAnsi } from "../../ui/ansi.ts";
import { initCommand } from "./init-command.ts";
import type { InitOptions, InitTemplate } from "./types.ts";

describe("InitCommand Types", () => {
  describe("InitTemplate", () => {
    const templates: InitTemplate[] = [
      "ai-agent",
      "docs-agent",
      "multi-agent-system",
      "agentic-workflow",
      "coding-agent",
      "saas-starter",
      "minimal",
    ];

    for (const template of templates) {
      it(`should support '${template}' template`, () => {
        assertEquals(template, template);
      });
    }
  });

  describe("InitOptions", () => {
    it("creates a named project beneath parentDir", async () => {
      const parentDir = await makeTempDir({ prefix: "veryfront-init-parent-" });
      const name = `parent-target-${crypto.randomUUID()}`;

      try {
        await initCommand({
          name,
          parentDir,
          template: "minimal",
          skipInstall: true,
          skipEnvPrompt: true,
          quiet: true,
        });

        assertEquals(await exists(join(parentDir, name, "app")), true);
        assertEquals(
          await exists(join(parentDir, name, "package.json")),
          false,
        );
      } finally {
        await remove(parentDir, { recursive: true }).catch(() => {});
      }
    });

    it("prints the verified URL returned by the composed deployment", async () => {
      const parentDir = await makeTempDir({ prefix: "veryfront-init-deploy-" });
      const name = `deployed-target-${crypto.randomUUID()}`;
      const deployedUrl = "https://verified.example.test/app/dashboard";
      const output: string[] = [];
      const originalLog = console.log;

      try {
        console.log = (...args: unknown[]) => output.push(args.map(String).join(" "));

        await initCommand(
          {
            name,
            parentDir,
            template: "minimal",
            skipInstall: true,
            skipEnvPrompt: true,
            deploy: true,
          },
          {
            deployProject: async (projectDir) => {
              assertEquals(projectDir, join(parentDir, name));
              return deployedUrl;
            },
          },
        );

        const expectedLiveLine = `  Live: ${deployedUrl}`;
        const liveLine = output.map(stripAnsi).find((line) => line === expectedLiveLine);
        assertEquals(await exists(join(parentDir, name, "app")), true);
        assertEquals(liveLine, expectedLiveLine);
      } finally {
        console.log = originalLog;
        await remove(parentDir, { recursive: true }).catch(() => {});
      }
    });

    it("should allow empty options", () => {
      const options: InitOptions = {};
      assertExists(options);
    });

    it("should allow name option", () => {
      const options: InitOptions = { name: "my-project" };
      assertEquals(options.name, "my-project");
    });

    it("should allow template option", () => {
      const options: InitOptions = { template: "ai-agent" };
      assertEquals(options.template, "ai-agent");
    });

    it("should allow skipInstall option", () => {
      const options: InitOptions = { skipInstall: true };
      assertEquals(options.skipInstall, true);
    });

    it("should allow skipEnvPrompt option", () => {
      const options: InitOptions = { skipEnvPrompt: true };
      assertEquals(options.skipEnvPrompt, true);
    });

    it("should allow integrations array", () => {
      const options: InitOptions = { integrations: [] };
      assertEquals(options.integrations?.length, 0);
    });

    it("should allow combined options", () => {
      const options: InitOptions = {
        name: "my-ai-app",
        template: "ai-agent",
        skipInstall: false,
        skipEnvPrompt: false,
        integrations: [],
      };

      assertEquals(options.name, "my-ai-app");
      assertEquals(options.template, "ai-agent");
      assertEquals(options.skipInstall, false);
      assertEquals(options.skipEnvPrompt, false);
      assertExists(options.integrations);
    });

    it("should allow runtime option", () => {
      const options: InitOptions = { runtime: "deno" };
      assertEquals(options.runtime, "deno");
    });

    it("should accept all three runtime values", () => {
      const node: InitOptions = { runtime: "node" };
      const bun: InitOptions = { runtime: "bun" };
      const deno: InitOptions = { runtime: "deno" };
      assertEquals(node.runtime, "node");
      assertEquals(bun.runtime, "bun");
      assertEquals(deno.runtime, "deno");
    });
  });

  describe("Default behaviors", () => {
    const options: InitOptions = {};

    it("should default template to undefined when not specified", () => {
      assertEquals(options.template, undefined);
    });

    it("should default skipInstall to undefined when not specified", () => {
      assertEquals(options.skipInstall, undefined);
    });

    it("should default skipEnvPrompt to undefined when not specified", () => {
      assertEquals(options.skipEnvPrompt, undefined);
    });

    it("should default integrations to undefined when not specified", () => {
      assertEquals(options.integrations, undefined);
    });

    it("should default runtime to undefined when not specified", () => {
      assertEquals(options.runtime, undefined);
    });
  });
});

describe("initCommand target directory", () => {
  it("rejects an existing target directory so the CLI exits non-zero", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-init-existing-" });
    const name = "taken";
    const keepsake = join(parentDir, name, "README.md");

    try {
      await Deno.mkdir(join(parentDir, name));
      await Deno.writeTextFile(keepsake, "keep me\n");

      // `veryfront init x && cd x && npm run dev` must stop at the refusal. A
      // printed message with a zero exit lets the chain run on in the wrong
      // directory, so the refusal has to surface as an error, not a return.
      await assertRejects(
        () =>
          initCommand({
            name,
            parentDir,
            template: "minimal",
            skipInstall: true,
            skipEnvPrompt: true,
            quiet: true,
          }),
        Error,
        `Directory "${name}" already contains README.md`,
      );

      assertEquals(await Deno.readTextFile(keepsake), "keep me\n");
      assertEquals(await exists(join(parentDir, name, "app")), false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });
});

describe("initCommand into the current directory", () => {
  it("refuses to overwrite files already in the directory without --force", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-init-cwd-" });
    const readme = join(parentDir, "README.md");

    try {
      await Deno.writeTextFile(readme, "mine\n");

      // Non-interactive `veryfront init` with no name scaffolds into the
      // current directory. It must hold the same line as the named path: an
      // existing file is refused, not replaced.
      await assertRejects(
        () =>
          initCommand({
            parentDir,
            template: "minimal",
            skipInstall: true,
            skipEnvPrompt: true,
            quiet: true,
          }),
        Error,
        "README.md",
      );

      assertEquals(await Deno.readTextFile(readme), "mine\n");
      assertEquals(await exists(join(parentDir, "app")), false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });
});
