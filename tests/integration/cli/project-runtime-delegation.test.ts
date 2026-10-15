import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { join } from "#std/path";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";

const wrapper = await Deno.readTextFile(
  new URL("../../../scripts/build/bin-wrapper.js", import.meta.url),
);
const engine = await Deno.readTextFile(
  new URL(
    "../../../scripts/build/node-engine-precondition.js",
    import.meta.url,
  ),
);

async function fixture(local: boolean) {
  const root = await makeTempDir({ prefix: "vf-cli-peer-graph-" });
  const global = join(root, "global", "veryfront");
  const project = join(root, "project");
  await Deno.mkdir(project, { recursive: true });
  await Deno.writeTextFile(
    join(project, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  async function install(directory: string, version: string, origin: string) {
    await Deno.mkdir(join(directory, "bin"), { recursive: true });
    await Deno.mkdir(join(directory, "esm", "cli"), { recursive: true });
    await Deno.mkdir(join(directory, "node_modules", "react"), {
      recursive: true,
    });
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
    await Deno.writeTextFile(
      join(directory, "bin", "node-engine-precondition.js"),
      engine,
    );
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
  if (local) {
    await install(
      join(project, "node_modules", "veryfront"),
      "19.2.5",
      "project",
    );
  }
  return { root, global, project };
}

describe("project runtime delegation", () => {
  it("keeps launcher Boolean option arity aligned with the canonical CLI parser", async () => {
    const source = await Deno.readTextFile(
      new URL("../../../cli/shared/args.ts", import.meta.url),
    );
    const canonical = source.match(
      /export const BOOLEAN_FLAGS[^=]*= new Set\(\[([\s\S]*?)\]\);/,
    );
    const launcher = wrapper.match(
      /const booleanFlags = new Set\(\[([\s\S]*?)\]\);/,
    );
    const names = (text: string | undefined) => {
      if (text === undefined) {
        throw new Error("Boolean option declarations missing");
      }
      return Array.from(text.matchAll(/"([^"\n]+)"/g), (match) => match[1])
        .sort();
    };
    assertEquals(names(launcher?.[1]), names(canonical?.[1]));
  });

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
  it("selects the explicitly requested project framework from outside its directory", async () => {
    const f = await fixture(true);
    try {
      for (
        const args of [
          ["dev", "--project", f.project],
          ["dev", `--project=${f.project}`],
          [
            "start",
            "--project-dir",
            f.project,
          ],
          ["start", `--project-dir=${f.project}`],
          ["--project", f.project, "dev"],
          ["--project-dir", f.project],
          ["--port", "3456", "dev", "--project", f.project],
          ["-p", "3456", "dev", "--project", f.project],
          ["--port", "3456", "--project-dir", f.project],
          ["-p", "3456", "--project-dir", f.project],
          ["schedule", "run", "owned-task", "--project-dir", f.project],
          ["routes", `--project-dir=${f.project}`],
          ["routes", "--dir", f.project],
          ["schedule", "run", "owned-task", "-d", f.project],
          ["-d", f.project, "schedule", "run", "owned-task"],
          ["dev", "-d", "--project", f.project],
          ["--branch", "dev", "-d", f.project, "pull"],
          ["--environment", "start", "--dir", f.project, "deploy"],
          ["--debug", "dev", "--project", f.project],
          ["projects", "delete", "-d", f.project],
        ]
      ) {
        const result = await new Deno.Command("node", {
          args: [join(f.global, "bin", "veryfront.js"), ...args],
          cwd: f.root,
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
        assertEquals(JSON.parse(new TextDecoder().decode(result.stdout)), {
          react: "19.2.5",
          origin: "project",
          args,
        });
      }
    } finally {
      await Deno.remove(f.root, { recursive: true });
    }
  });

  it("selects a Plug'n'Play project without a physical node_modules framework", async () => {
    const f = await fixture(true);
    try {
      const store = join(f.project, ".package-store", "veryfront");
      await Deno.mkdir(join(f.project, ".package-store"), { recursive: true });
      await Deno.rename(join(f.project, "node_modules", "veryfront"), store);
      await Deno.remove(join(f.project, "node_modules"));
      await Deno.writeTextFile(
        join(f.project, ".pnp.cjs"),
        'const fs = require("node:fs"); const path = require("node:path"); const root = JSON.parse(fs.readFileSync(path.join(__dirname, "pnp-fixture.json"), "utf8")).root; exports.setup = () => { process.versions.pnp = "3"; }; exports.resolveToUnqualified = (name) => { if (name !== "veryfront") throw new Error("unexpected request"); return root; };',
      );
      await Deno.writeTextFile(
        join(f.project, "pnp-fixture.json"),
        JSON.stringify({ root: store }),
      );
      await Deno.writeTextFile(
        join(f.project, ".pnp.loader.mjs"),
        "export function resolve(specifier, context, next) { return next(specifier, context); }",
      );
      const result = await new Deno.Command("node", {
        args: [join(f.global, "bin", "veryfront.js"), "dev"],
        cwd: f.project,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
      assertEquals(new TextDecoder().decode(result.stderr), "");
      assertEquals(JSON.parse(new TextDecoder().decode(result.stdout)), {
        react: "19.2.5",
        origin: "project",
        args: ["dev"],
      });
      const outside = await new Deno.Command("node", {
        args: [
          join(f.global, "bin", "veryfront.js"),
          "dev",
          "--project",
          f.project,
        ],
        cwd: f.root,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(outside.code, 0, new TextDecoder().decode(outside.stderr));
      assertEquals(new TextDecoder().decode(outside.stderr), "");
      assertEquals(JSON.parse(new TextDecoder().decode(outside.stdout)), {
        react: "19.2.5",
        origin: "project",
        args: ["dev", "--project", f.project],
      });
      await Deno.writeTextFile(join(f.project, ".pnp.loader.mjs"), "export const = invalid;");
      for (const args of [["deploy", "--json"], ["project", "runs", "list", "--ndjson"]]) {
        const outputFile = join(f.root, "reports", `${args[0]}.json`);
        const failed = await new Deno.Command("node", {
          args: [join(f.global, "bin", "veryfront.js"), ...args, "--output", outputFile],
          cwd: f.project,
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(failed.code, 1);
        assertEquals(new TextDecoder().decode(failed.stderr), "");
        const output = new TextDecoder().decode(failed.stdout);
        assertEquals(JSON.parse(output).error.slug, "command-failed");
        assertEquals(output.includes(f.root), false);
        assertEquals(JSON.parse(await Deno.readTextFile(outputFile)), JSON.parse(output));
      }
    } finally {
      await Deno.remove(f.root, { recursive: true });
    }
  });

  it("sanitizes failures during the child PnP setup before CLI loading", async () => {
    const f = await fixture(true);
    try {
      const store = join(f.project, "node_modules", "veryfront");
      await Deno.writeTextFile(
        join(f.project, ".pnp.cjs"),
        `if (process.argv[1]?.endsWith("veryfront.js") && process.execArgv.includes("--import")) throw new Error(__filename + " private preload failure"); exports.setup = () => {}; exports.resolveToUnqualified = () => ${
          JSON.stringify(store)
        };`,
      );
      await Deno.writeTextFile(
        join(f.project, ".pnp.loader.mjs"),
        "export function resolve(s,c,n) { return n(s,c); }",
      );
      for (const args of [["deploy", "--json"], ["project", "runs", "list", "--ndjson"]]) {
        const outputFile = join(f.root, "reports", `${args[0]}.json`);
        const failed = await new Deno.Command("node", {
          args: [join(f.global, "bin", "veryfront.js"), ...args, "--output", outputFile],
          cwd: f.project,
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(failed.code, 1);
        assertEquals(new TextDecoder().decode(failed.stderr), "");
        const output = new TextDecoder().decode(failed.stdout);
        assertEquals(JSON.parse(output).error.slug, "command-failed");
        assertEquals(output.includes(f.root), false);
        assertEquals(JSON.parse(await Deno.readTextFile(outputFile)), JSON.parse(output));
      }
    } finally {
      await Deno.remove(f.root, { recursive: true });
    }
  });

  it("keeps global commands available in a PnP project without Veryfront", async () => {
    const f = await fixture(false);
    try {
      await Deno.writeTextFile(
        join(f.project, ".pnp.cjs"),
        'exports.setup = () => {}; exports.resolveToUnqualified = () => { const error = new Error("not declared"); error.pnpCode = "UNDECLARED_DEPENDENCY"; throw error; };',
      );
      const result = await new Deno.Command("node", {
        args: [join(f.global, "bin", "veryfront.js"), "--version"],
        cwd: f.project,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
      assertEquals(
        JSON.parse(new TextDecoder().decode(result.stdout)).origin,
        "global",
      );
    } finally {
      await Deno.remove(f.root, { recursive: true });
    }
  });
  for (const source of ['import "./missing.js";', "export const = invalid;"]) {
    it(`sanitizes delegated CLI load failures in JSON mode: ${source}`, async () => {
      const f = await fixture(true);
      try {
        await Deno.writeTextFile(
          join(f.project, "node_modules", "veryfront", "bin", "veryfront.js"),
          source,
        );
        const result = await new Deno.Command("node", {
          args: [join(f.global, "bin", "veryfront.js"), "deploy", "--json"],
          cwd: f.project,
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(result.code, 1);
        const stdout = new TextDecoder().decode(result.stdout);
        assertEquals(JSON.parse(stdout), {
          success: false,
          command: "deploy",
          error: {
            code: "RUNTIME_ERROR",
            slug: "command-failed",
            message:
              "Project CLI setup failed; verify the project directory and reinstall its dependencies",
          },
        });
        assertEquals(new TextDecoder().decode(result.stderr), "");
        assertEquals(stdout.includes(f.root), false);
      } finally {
        await Deno.remove(f.root, { recursive: true });
      }
    });
  }
  for (const json of [false, true]) {
    it(`refuses a PnP framework without its ESM loader with structured mode ${json}`, async () => {
      const f = await fixture(true);
      try {
        await Deno.writeTextFile(
          join(f.project, "pnp-fixture.json"),
          JSON.stringify({ root: join(f.project, "node_modules", "veryfront") }),
        );
        await Deno.writeTextFile(
          join(f.project, ".pnp.cjs"),
          'const fs = require("node:fs"); const path = require("node:path"); const root = JSON.parse(fs.readFileSync(path.join(__dirname, "pnp-fixture.json"), "utf8")).root; exports.setup = () => {}; exports.resolveToUnqualified = () => root;',
        );
        const result = await new Deno.Command("node", {
          args: [join(f.global, "bin", "veryfront.js"), ...(json ? ["deploy", "--json"] : ["dev"])],
          cwd: f.project,
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(result.code, 1);
        const stdout = new TextDecoder().decode(result.stdout);
        const stderr = new TextDecoder().decode(result.stderr);
        const message =
          "Enable pnpEnableEsmLoader in .yarnrc.yml and run yarn install for the project CLI";
        if (json) {
          assertEquals(JSON.parse(stdout), {
            success: false,
            command: "deploy",
            error: { code: "RUNTIME_ERROR", slug: "command-failed", message },
          });
          assertEquals(stderr, "");
        } else {
          assertEquals(stdout, "");
          assertEquals(stderr.trim(), message);
        }
        assertEquals((stdout + stderr).includes(f.root), false);
        assertEquals((stdout + stderr).includes(" at "), false);
      } finally {
        await Deno.remove(f.root, { recursive: true });
      }
    });
  }

  it("refuses an escaping project CLI entry without falling back to global code", async () => {
    const f = await fixture(true);
    try {
      const packageFile = join(
        f.project,
        "node_modules",
        "veryfront",
        "package.json",
      );
      const pkg = JSON.parse(await Deno.readTextFile(packageFile));
      pkg.bin.veryfront = "../../outside.js";
      await Deno.writeTextFile(packageFile, JSON.stringify(pkg));
      await Deno.writeTextFile(
        join(f.project, "outside.js"),
        'console.log("escaped");',
      );
      const result = await new Deno.Command("node", {
        args: [join(f.global, "bin", "veryfront.js"), "dev"],
        cwd: f.project,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.code, 1);
      assertEquals(new TextDecoder().decode(result.stdout), "");
      assertEquals(
        new TextDecoder().decode(result.stderr).includes("escapes its package"),
        true,
      );
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
  for (const command of ["project", "projects"]) {
    for (const delegated of [false, true]) {
      it(`preserves NDJSON launcher failures for ${command} with delegated import ${delegated}`, async () => {
        const f = await fixture(true);
        try {
          if (delegated) {
            await Deno.writeTextFile(
              join(f.project, "node_modules", "veryfront", "esm", "cli", "main.js"),
              'import "./missing-dependency.js";',
            );
          } else {
            const manifest = join(f.project, "node_modules", "veryfront", "package.json");
            const pkg = JSON.parse(await Deno.readTextFile(manifest));
            pkg.name = "unexpected-package";
            await Deno.writeTextFile(manifest, JSON.stringify(pkg));
          }
          const outputFile = join(f.root, "reports", "failure.json");
          const output = await new Deno.Command("node", {
            args: [
              join(f.global, "bin", "veryfront.js"),
              command,
              "runs",
              "list",
              "--ndjson",
              "--output=" + outputFile,
            ],
            cwd: f.project,
            stdout: "piped",
            stderr: "piped",
          }).output();
          const stdout = new TextDecoder().decode(output.stdout);
          const result = JSON.parse(stdout);
          assertEquals(output.code, 1);
          assertEquals(result.success, false);
          assertEquals(result.command, command);
          assertEquals(result.error.slug, "command-failed");
          assertEquals(JSON.parse(await Deno.readTextFile(outputFile)), result);
          assertEquals(stdout.trim().split("\n").length, 1);
          assertEquals(new TextDecoder().decode(output.stderr), "");
          assertEquals(stdout.includes(f.root), false);
        } finally {
          await Deno.remove(f.root, { recursive: true });
        }
      });
    }
  }
});
