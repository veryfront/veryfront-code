import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/testing/deno-compat.ts";
import { dirname, fromFileUrl, join } from "veryfront/platform/path";
import { vfCreateProject } from "../../../../../cli/mcp/tools/catalog-tools.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import { type TestContext, withTestContext } from "../../../../_helpers/context.ts";

const HOST_ONLY_SENTINEL = "VERYFRONT_TEST_HOST_ONLY_CHILD_SENTINEL";

async function createFakeNpm(binDir: string): Promise<void> {
  await Deno.mkdir(binDir);
  const logPath = join(binDir, "npm.log");
  const isWindows = Deno.build.os === "windows";
  const npmPath = join(binDir, isWindows ? "npm.cmd" : "npm");
  const script = isWindows
    ? [
      "@echo off",
      `>>"${logPath}" echo %CD% %*`,
      `if defined ${HOST_ONLY_SENTINEL} (>>"${logPath}" echo host-sentinel=%${HOST_ONLY_SENTINEL}%) else (>>"${logPath}" echo host-sentinel=unset)`,
      `>package-lock.json echo {"lockfileVersion":3,"packages":{}}`,
      "exit /b 0",
      "",
    ].join("\r\n")
    : `#!/usr/bin/env sh
printf '%s\n' "$PWD $*" >> "${logPath}"
printf 'host-sentinel=%s\n' "\${${HOST_ONLY_SENTINEL}-unset}" >> "${logPath}"
printf '%s\n' '{"lockfileVersion":3,"packages":{}}' > package-lock.json
exit 0
`;

  await Deno.writeTextFile(npmPath, script);
  if (!isWindows) await Deno.chmod(npmPath, 0o755);
}

async function withFakeNpm(
  parentDir: string,
  action: () => Promise<void>,
): Promise<void> {
  const binDir = join(parentDir, "fake-npm");
  await createFakeNpm(binDir);
  const pathDelimiter = Deno.build.os === "windows" ? ";" : ":";
  const originalDenoPath = getEnv("PATH");
  const nextPath = `${binDir}${pathDelimiter}${originalDenoPath ?? ""}`;
  const originalSentinel = getEnv(HOST_ONLY_SENTINEL);
  setEnv(HOST_ONLY_SENTINEL, "must-not-reach-child");
  try {
    await runWithProjectEnv({ PATH: nextPath }, action);
  } finally {
    if (originalSentinel === undefined) deleteEnv(HOST_ONLY_SENTINEL);
    else setEnv(HOST_ONLY_SENTINEL, originalSentinel);
  }
}

function projectTest(
  name: string,
  action: (parentDir: string, context: TestContext) => Promise<void>,
): void {
  it(name, async () => {
    await withTestContext(name, async (context) => {
      const { projectDir } = context;
      const parentDir = join(projectDir, "parent");
      await Deno.mkdir(parentDir);
      await action(parentDir, context);
    });
  });
}

describe("vfCreateProject filesystem conflicts", () => {
  projectTest(
    "refuses a directory holding files the scaffold would overwrite",
    async (parentDir) => {
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
    },
  );

  projectTest("scaffolds into an existing empty directory", async (parentDir) => {
    const projectDir = join(parentDir, "example-app");
    await Deno.mkdir(projectDir);

    await withFakeNpm(parentDir, async () => {
      const result = await vfCreateProject.execute({
        name: "Example App",
        template: "minimal",
        directory: parentDir,
      });

      assertEquals(result.success, true);
      assertEquals(result.projectDir, projectDir);
      const npmLog = await Deno.readTextFile(join(parentDir, "fake-npm", "npm.log"));
      assertStringIncludes(npmLog, `${projectDir} install`);
      assertStringIncludes(npmLog, "host-sentinel=unset");
      assertEquals(npmLog.includes("must-not-reach-child"), false);
    });
  });

  projectTest("keeps host-only variables out of dependency installers", async (parentDir) => {
    const modulePath = fromFileUrl(import.meta.url);
    const configPath = fromFileUrl(
      new URL("../../../../../deno.json", import.meta.url),
    );
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-all",
        `--config=${configPath}`,
        modulePath,
        "--host-environment-probe",
        parentDir,
      ],
      clearEnv: true,
      env: {
        ...Deno.env.toObject(),
        [HOST_ONLY_SENTINEL]: "must-not-reach-child",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!output.success) {
      throw new Error(new TextDecoder().decode(output.stderr));
    }

    const npmLog = await Deno.readTextFile(join(parentDir, "fake-npm", "npm.log"));
    assertStringIncludes(npmLog, "host-env-app install");
    assertStringIncludes(npmLog, "host-sentinel=unset");
    assertEquals(npmLog.includes("must-not-reach-child"), false);
  });

  projectTest(
    "refuses a linked project directory instead of scaffolding outside the parent",
    async (parentDir) => {
      const outside = join(parentDir, "outside");
      await Deno.mkdir(outside);
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
    },
  );

  projectTest("refuses a linked .gitignore instead of merging through it", async (parentDir) => {
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

  projectTest("refuses a .gitignore directory before partially scaffolding", async (parentDir) => {
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

  projectTest("refuses a non-file .gitignore before partially scaffolding", async (parentDir) => {
    if (Deno.build.os === "windows") return;

    const projectDir = join(parentDir, "example-app");
    await Deno.mkdir(projectDir, { recursive: true });
    const output = await new Deno.Command("mkfifo", {
      args: [join(projectDir, ".gitignore")],
    }).output();
    assertEquals(output.success, true, new TextDecoder().decode(output.stderr));

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

  projectTest(
    "refuses a package lock before dependency installation can replace it",
    async (parentDir) => {
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
    },
  );

  projectTest(
    "refuses npm hidden lockfile before dependency installation can replace it",
    async (parentDir) => {
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
    },
  );

  projectTest(
    "refuses npm shrinkwrap before dependency installation can replace it",
    async (parentDir) => {
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
    },
  );

  projectTest(
    "refuses existing node_modules before dependency installation can prune it",
    async (parentDir) => {
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
    },
  );
});

if (import.meta.main && Deno.args[0] === "--host-environment-probe") {
  const parentDir = Deno.args[1];
  if (!parentDir) throw new Error("Host environment probe requires a parent directory");
  const binDir = join(parentDir, "fake-npm");
  await createFakeNpm(binDir);
  const pathDelimiter = Deno.build.os === "windows" ? ";" : ":";
  const path = `${binDir}${pathDelimiter}${Deno.env.get("PATH") ?? ""}`;
  const result = await runWithProjectEnv({ PATH: path }, () =>
    vfCreateProject.execute({
      name: "Host Env App",
      template: "minimal",
      directory: parentDir,
    }));
  if (!result.success) throw new Error(result.message);
}
