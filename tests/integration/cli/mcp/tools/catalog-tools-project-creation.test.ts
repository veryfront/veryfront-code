import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join } from "veryfront/platform/path";
import { vfCreateProject } from "../../../../../cli/mcp/tools/catalog-tools.ts";

async function createFakeNpm(): Promise<string> {
  const binDir = await Deno.makeTempDir();
  const logPath = join(binDir, "npm.log");
  const isWindows = Deno.build.os === "windows";
  const npmPath = join(binDir, isWindows ? "npm.cmd" : "npm");
  const script = isWindows
    ? [
      "@echo off",
      `>>"${logPath}" echo %CD% %*`,
      `>package-lock.json echo {"lockfileVersion":3,"packages":{}}`,
      "exit /b 0",
      "",
    ].join("\r\n")
    : `#!/usr/bin/env sh
printf '%s\n' "$PWD $*" >> "${logPath}"
printf '%s\n' '{"lockfileVersion":3,"packages":{}}' > package-lock.json
exit 0
`;

  await Deno.writeTextFile(npmPath, script);
  if (!isWindows) await Deno.chmod(npmPath, 0o755);
  return binDir;
}

async function withFakeNpm(action: () => Promise<void>): Promise<void> {
  const binDir = await createFakeNpm();
  const pathDelimiter = Deno.build.os === "windows" ? ";" : ":";
  const originalDenoPath = Deno.env.get("PATH");
  const nextPath = `${binDir}${pathDelimiter}${originalDenoPath ?? ""}`;

  try {
    Deno.env.set("PATH", nextPath);
    await action();
  } finally {
    if (originalDenoPath === undefined) Deno.env.delete("PATH");
    else Deno.env.set("PATH", originalDenoPath);
    await Deno.remove(binDir, { recursive: true }).catch(() => {});
  }
}

describe("vfCreateProject filesystem conflicts", () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    for (const dir of createdDirs.splice(0)) {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  });

  it("refuses a directory holding files the scaffold would overwrite", async () => {
    const parentDir = await Deno.makeTempDir();
    createdDirs.push(parentDir);
    const projectDir = join(parentDir, "example-app");
    await Deno.mkdir(projectDir);
    await Deno.writeTextFile(join(projectDir, "README.md"), "mine\n");

    const result = await vfCreateProject.execute({
      name: "Example App",
      template: "minimal",
      directory: parentDir,
    });

    assertEquals(result.success, false);
    assertEquals(result.projectDir, undefined);
    assertEquals(result.message.includes("already contains README.md"), true);
    assertEquals(await Deno.readTextFile(join(projectDir, "README.md")), "mine\n");
  });

  it("scaffolds into an existing empty directory", async () => {
    const parentDir = await Deno.makeTempDir();
    createdDirs.push(parentDir);
    const projectDir = join(parentDir, "example-app");
    await Deno.mkdir(projectDir);

    await withFakeNpm(async () => {
      const result = await vfCreateProject.execute({
        name: "Example App",
        template: "minimal",
        directory: parentDir,
      });

      assertEquals(result.success, true);
      assertEquals(result.projectDir, projectDir);
    });
  });

  it("refuses a linked project directory instead of scaffolding outside the parent", async () => {
    const parentDir = await Deno.makeTempDir();
    createdDirs.push(parentDir);
    const outside = await Deno.makeTempDir();
    createdDirs.push(outside);
    await Deno.symlink(outside, join(parentDir, "example-app"));

    const result = await vfCreateProject.execute({
      name: "Example App",
      template: "minimal",
      directory: parentDir,
    });

    assertEquals(result.success, false);
    assertEquals(result.projectDir, undefined);
    assertEquals(result.message.includes("is a link the scaffold cannot write through"), true);
    const written: string[] = [];
    for await (const entry of Deno.readDir(outside)) written.push(entry.name);
    assertEquals(written, []);
  });

  it("refuses a linked .gitignore instead of merging through it", async () => {
    const parentDir = await Deno.makeTempDir();
    createdDirs.push(parentDir);
    const projectDir = join(parentDir, "example-app");
    const outside = join(parentDir, "outside-gitignore");
    await Deno.mkdir(projectDir);
    await Deno.writeTextFile(outside, "keep-me\n");
    await Deno.symlink(outside, join(projectDir, ".gitignore"));

    const result = await vfCreateProject.execute({
      name: "Example App",
      template: "minimal",
      directory: parentDir,
    });

    assertEquals(result.success, false);
    assertEquals(result.projectDir, undefined);
    assertEquals(
      result.message.includes("already contains .gitignore as a file or a link"),
      true,
    );
    assertEquals(await Deno.readTextFile(outside), "keep-me\n");
    assertEquals(await Deno.readTextFile(join(projectDir, ".gitignore")), "keep-me\n");
  });

  it("refuses a .gitignore directory before partially scaffolding", async () => {
    const parentDir = await Deno.makeTempDir();
    createdDirs.push(parentDir);
    const projectDir = join(parentDir, "example-app");
    await Deno.mkdir(join(projectDir, ".gitignore"), { recursive: true });

    const result = await vfCreateProject.execute({
      name: "Example App",
      template: "minimal",
      directory: parentDir,
    });

    assertEquals(result.success, false);
    assertEquals(result.projectDir, undefined);
    assertEquals(
      result.message.includes("already contains .gitignore as a file or a link"),
      true,
    );
    assertEquals(
      await Deno.readTextFile(join(projectDir, ".gitignore", "README.md")).catch(
        () => "absent",
      ),
      "absent",
    );
    assertEquals(
      await Deno.readTextFile(join(projectDir, "README.md")).catch(() => "absent"),
      "absent",
    );
  });

  it("refuses a non-file .gitignore before partially scaffolding", async () => {
    if (Deno.build.os === "windows") return;

    const parentDir = await Deno.makeTempDir();
    createdDirs.push(parentDir);
    const projectDir = join(parentDir, "example-app");
    await Deno.mkdir(projectDir, { recursive: true });
    const output = await new Deno.Command("mkfifo", {
      args: [join(projectDir, ".gitignore")],
    }).output();
    if (!output.success) return;

    const result = await vfCreateProject.execute({
      name: "Example App",
      template: "minimal",
      directory: parentDir,
    });

    assertEquals(result.success, false);
    assertEquals(result.projectDir, undefined);
    assertEquals(
      result.message.includes("already contains .gitignore as a file or a link"),
      true,
    );
    assertEquals(
      await Deno.readTextFile(join(projectDir, "README.md")).catch(() => "absent"),
      "absent",
    );
  });

  it("refuses a package lock before dependency installation can replace it", async () => {
    const parentDir = await Deno.makeTempDir();
    createdDirs.push(parentDir);
    const projectDir = join(parentDir, "example-app");
    const lockfile = join(projectDir, "package-lock.json");
    await Deno.mkdir(projectDir);
    await Deno.writeTextFile(lockfile, "keep-me\n");

    const result = await vfCreateProject.execute({
      name: "Example App",
      template: "minimal",
      directory: parentDir,
    });

    assertEquals(result.success, false);
    assertEquals(result.projectDir, undefined);
    assertEquals(result.message.includes("already contains package-lock.json"), true);
    assertEquals(await Deno.readTextFile(lockfile), "keep-me\n");
    assertEquals(
      await Deno.readTextFile(join(projectDir, "README.md")).catch(() => "absent"),
      "absent",
    );
  });

  it("refuses npm hidden lockfile before dependency installation can replace it", async () => {
    const parentDir = await Deno.makeTempDir();
    createdDirs.push(parentDir);
    const projectDir = join(parentDir, "example-app");
    const lockfile = join(projectDir, "node_modules", ".package-lock.json");
    await Deno.mkdir(join(projectDir, "node_modules"), { recursive: true });
    await Deno.writeTextFile(lockfile, "keep-me\n");

    const result = await vfCreateProject.execute({
      name: "Example App",
      template: "minimal",
      directory: parentDir,
    });

    assertEquals(result.success, false);
    assertEquals(result.projectDir, undefined);
    assertEquals(
      result.message.includes("already contains node_modules/.package-lock.json"),
      true,
    );
    assertEquals(await Deno.readTextFile(lockfile), "keep-me\n");
    assertEquals(
      await Deno.readTextFile(join(projectDir, "README.md")).catch(() => "absent"),
      "absent",
    );
  });

  it("refuses npm shrinkwrap before dependency installation can replace it", async () => {
    const parentDir = await Deno.makeTempDir();
    createdDirs.push(parentDir);
    const projectDir = join(parentDir, "example-app");
    const lockfile = join(projectDir, "npm-shrinkwrap.json");
    await Deno.mkdir(projectDir);
    await Deno.writeTextFile(lockfile, "keep-me\n");

    const result = await vfCreateProject.execute({
      name: "Example App",
      template: "minimal",
      directory: parentDir,
    });

    assertEquals(result.success, false);
    assertEquals(result.projectDir, undefined);
    assertEquals(result.message.includes("already contains npm-shrinkwrap.json"), true);
    assertEquals(await Deno.readTextFile(lockfile), "keep-me\n");
    assertEquals(
      await Deno.readTextFile(join(projectDir, "README.md")).catch(() => "absent"),
      "absent",
    );
  });

  it("refuses existing node_modules before dependency installation can prune it", async () => {
    const parentDir = await Deno.makeTempDir();
    createdDirs.push(parentDir);
    const projectDir = join(parentDir, "example-app");
    const userFile = join(projectDir, "node_modules", "user-owned", "data.txt");
    await Deno.mkdir(dirname(userFile), { recursive: true });
    await Deno.writeTextFile(userFile, "keep-me\n");

    const result = await vfCreateProject.execute({
      name: "Example App",
      template: "minimal",
      directory: parentDir,
    });

    assertEquals(result.success, false);
    assertEquals(result.projectDir, undefined);
    assertEquals(result.message.includes("already contains node_modules"), true);
    assertEquals(await Deno.readTextFile(userFile), "keep-me\n");
    assertEquals(
      await Deno.readTextFile(join(projectDir, "README.md")).catch(() => "absent"),
      "absent",
    );
  });
});
