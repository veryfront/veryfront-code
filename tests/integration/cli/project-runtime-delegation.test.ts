import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { join } from "#std/path";

const wrapper = await Deno.readTextFile(
  new URL("../../../scripts/build/bin-wrapper.js", import.meta.url),
);
const engine = await Deno.readTextFile(
  new URL("../../../scripts/build/node-engine-precondition.js", import.meta.url),
);

async function fixture(local: boolean) {
  const root = await Deno.makeTempDir({ prefix: "vf-cli-peer-graph-" });
  const global = join(root, "global", "veryfront");
  const project = join(root, "project");
  await Deno.mkdir(project, { recursive: true });
  await Deno.writeTextFile(join(project, "package.json"), JSON.stringify({ type: "module" }));
  async function install(directory: string, version: string, origin: string) {
    await Deno.mkdir(join(directory, "bin"), { recursive: true });
    await Deno.mkdir(join(directory, "esm", "cli"), { recursive: true });
    await Deno.mkdir(join(directory, "node_modules", "react"), { recursive: true });
    await Deno.writeTextFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: "veryfront",
        type: "module",
        bin: { veryfront: "bin/veryfront.js" },
        exports: { ".": { import: "./esm/cli/main.js" } },
      }),
    );
    await Deno.writeTextFile(join(directory, "bin", "veryfront.js"), wrapper);
    await Deno.writeTextFile(join(directory, "bin", "node-engine-precondition.js"), engine);
    await Deno.writeTextFile(
      join(directory, "node_modules", "react", "package.json"),
      JSON.stringify({ name: "react", version, main: "index.cjs" }),
    );
    await Deno.writeTextFile(
      join(directory, "node_modules", "react", "index.cjs"),
      `module.exports = { version: ${JSON.stringify(version)} };`,
    );
    await Deno.writeTextFile(
      join(directory, "esm", "_dnt.polyfills.js"),
      `globalThis.frameworkOrigin = ${JSON.stringify(origin)};`,
    );
    await Deno.writeTextFile(
      join(directory, "esm", "cli", "main.js"),
      'import { createRequire } from "node:module"; console.log(JSON.stringify({ react: createRequire(import.meta.url)("react").version, origin: globalThis.frameworkOrigin, args: process.argv.slice(2) }));',
    );
  }
  await install(global, "19.2.4", "global");
  if (local) await install(join(project, "node_modules", "veryfront"), "19.2.5", "project");
  return { root, global, project };
}

describe("project runtime delegation", () => {
  it("uses the project framework and its exact peer graph before global modules load", async () => {
    const f = await fixture(true);
    try {
      const result = await new Deno.Command("node", {
        args: [join(f.global, "bin", "veryfront.js"), "dev", "--port", "3456"],
        cwd: f.project,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
      assertEquals(JSON.parse(new TextDecoder().decode(result.stdout)), {
        react: "19.2.5",
        origin: "project",
        args: ["dev", "--port", "3456"],
      });
    } finally {
      await Deno.remove(f.root, { recursive: true });
    }
  });
  it("refuses an escaping project CLI entry without falling back to global code", async () => {
    const f = await fixture(true);
    try {
      const packageFile = join(f.project, "node_modules", "veryfront", "package.json");
      const pkg = JSON.parse(await Deno.readTextFile(packageFile));
      pkg.bin.veryfront = "../../outside.js";
      await Deno.writeTextFile(packageFile, JSON.stringify(pkg));
      await Deno.writeTextFile(join(f.project, "outside.js"), 'console.log("escaped");');
      const result = await new Deno.Command("node", {
        args: [join(f.global, "bin", "veryfront.js"), "dev"],
        cwd: f.project,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.code, 1);
      assertEquals(new TextDecoder().decode(result.stdout), "");
      assertEquals(new TextDecoder().decode(result.stderr).includes("escapes its package"), true);
    } finally {
      await Deno.remove(f.root, { recursive: true });
    }
  });
  it("preserves the delegated CLI failure status", async () => {
    const f = await fixture(true);
    try {
      await Deno.writeTextFile(
        join(f.project, "node_modules", "veryfront", "esm", "cli", "main.js"),
        "process.exitCode = 7;",
      );
      const result = await new Deno.Command("node", {
        args: [join(f.global, "bin", "veryfront.js"), "dev"],
        cwd: f.project,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.code, 7);
      assertEquals(new TextDecoder().decode(result.stdout), "");
    } finally {
      await Deno.remove(f.root, { recursive: true });
    }
  });

  it("retains the global CLI when no project framework is installed", async () => {
    const f = await fixture(false);
    try {
      const result = await new Deno.Command("node", {
        args: [join(f.global, "bin", "veryfront.js"), "--version"],
        cwd: f.project,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
      assertEquals(JSON.parse(new TextDecoder().decode(result.stdout)), {
        react: "19.2.4",
        origin: "global",
        args: ["--version"],
      });
    } finally {
      await Deno.remove(f.root, { recursive: true });
    }
  });
});
