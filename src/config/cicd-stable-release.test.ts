import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const decoder = new TextDecoder();
// Git hooks export repository-local GIT_* variables that must not leak into fixtures.
const commandEnv = Object.fromEntries(
  Object.entries(Deno.env.toObject()).filter(([key]) => !key.startsWith("GIT_")),
);

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
  const result = await new Deno.Command(command, {
    args,
    clearEnv: true,
    cwd,
    env: commandEnv,
    stdout: "piped",
    stderr: "piped",
  }).output();

  return {
    code: result.code,
    stdout: decoder.decode(result.stdout).trim(),
    stderr: decoder.decode(result.stderr).trim(),
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await runCommand("git", args, cwd);
  assertEquals(result.code, 0, result.stderr);
  return result.stdout;
}

async function commitAll(cwd: string, message: string): Promise<void> {
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", message);
}

async function createRepository(): Promise<{
  cwd: string;
  before: string;
  scriptPath: string;
}> {
  const cwd = await Deno.makeTempDir();
  const scriptPath = await Deno.realPath(
    new URL("../../scripts/ci/stable-release-requested.sh", import.meta.url),
  );

  await git(cwd, "init", "--quiet");
  await git(cwd, "config", "user.name", "CI Test");
  await git(cwd, "config", "user.email", "ci@example.test");
  await git(cwd, "config", "commit.gpgsign", "false");
  await Deno.writeTextFile(
    `${cwd}/deno.json`,
    JSON.stringify({ version: "1.0.0" }),
  );
  await commitAll(cwd, "initial version");

  return {
    cwd,
    before: await git(cwd, "rev-parse", "HEAD"),
    scriptPath,
  };
}

async function detectRelease(
  cwd: string,
  scriptPath: string,
  eventName: string,
  currentVersion: string,
  before: string,
): Promise<CommandResult> {
  return await runCommand(
    "bash",
    [scriptPath, eventName, currentVersion, before],
    cwd,
  );
}

describe("stable release intent", () => {
  it("skips publication when a multi-commit push keeps the version unchanged", async () => {
    const repository = await createRepository();
    try {
      await Deno.writeTextFile(`${repository.cwd}/first.txt`, "first");
      await commitAll(repository.cwd, "first feature commit");
      await Deno.writeTextFile(`${repository.cwd}/second.txt`, "second");
      await commitAll(repository.cwd, "second feature commit");

      const result = await detectRelease(
        repository.cwd,
        repository.scriptPath,
        "push",
        "1.0.0",
        repository.before,
      );

      assertEquals(result.code, 0);
      assertEquals(result.stdout, "false");
      assertEquals(result.stderr, "");
    } finally {
      await Deno.remove(repository.cwd, { recursive: true });
    }
  });

  it("requests publication when the pushed version changed", async () => {
    const repository = await createRepository();
    try {
      await Deno.writeTextFile(
        `${repository.cwd}/deno.json`,
        JSON.stringify({ version: "1.0.1" }),
      );
      await commitAll(repository.cwd, "bump version");

      const result = await detectRelease(
        repository.cwd,
        repository.scriptPath,
        "push",
        "1.0.1",
        repository.before,
      );

      assertEquals(result.code, 0);
      assertEquals(result.stdout, "true");
      assertEquals(result.stderr, "");
    } finally {
      await Deno.remove(repository.cwd, { recursive: true });
    }
  });

  it("requests publication when the version bump is not in the final commit", async () => {
    const repository = await createRepository();
    try {
      await Deno.writeTextFile(
        `${repository.cwd}/deno.json`,
        JSON.stringify({ version: "1.0.1" }),
      );
      await commitAll(repository.cwd, "bump version");
      await Deno.writeTextFile(`${repository.cwd}/follow-up.txt`, "follow-up");
      await commitAll(repository.cwd, "follow-up commit");

      const result = await detectRelease(
        repository.cwd,
        repository.scriptPath,
        "push",
        "1.0.1",
        repository.before,
      );

      assertEquals(result.code, 0, "the detection script must exit cleanly");
      assertEquals(
        result.stdout,
        "true",
        "a multi-commit push must compare against the pushed BEFORE revision, not HEAD~1",
      );
      assertEquals(result.stderr, "", "the detection script must not warn");
    } finally {
      await Deno.remove(repository.cwd, { recursive: true });
    }
  });

  it("skips publication when deno.json changes without a version bump", async () => {
    const repository = await createRepository();
    try {
      await Deno.writeTextFile(
        `${repository.cwd}/deno.json`,
        JSON.stringify({ version: "1.0.0", imports: {} }),
      );
      await commitAll(repository.cwd, "add an import map");

      const result = await detectRelease(
        repository.cwd,
        repository.scriptPath,
        "push",
        "1.0.0",
        repository.before,
      );

      assertEquals(result.code, 0, "the detection script must exit cleanly");
      assertEquals(
        result.stdout,
        "false",
        "only the .version field decides release intent",
      );
      assertEquals(result.stderr, "", "the detection script must not warn");
    } finally {
      await Deno.remove(repository.cwd, { recursive: true });
    }
  });

  it("treats manual dispatch as explicit release intent", async () => {
    const repository = await createRepository();
    try {
      const result = await detectRelease(
        repository.cwd,
        repository.scriptPath,
        "workflow_dispatch",
        "1.0.0",
        "",
      );

      assertEquals(result.code, 0);
      assertEquals(result.stdout, "true");
      assertEquals(result.stderr, "");
    } finally {
      await Deno.remove(repository.cwd, { recursive: true });
    }
  });

  it("fails open to collision checks when the prior revision is unavailable", async () => {
    const repository = await createRepository();
    try {
      const result = await detectRelease(
        repository.cwd,
        repository.scriptPath,
        "push",
        "1.0.0",
        "0000000000000000000000000000000000000000",
      );

      assertEquals(result.code, 0);
      assertEquals(result.stdout, "true");
      assert(result.stderr.includes("preserving the collision-checked release path"));
    } finally {
      await Deno.remove(repository.cwd, { recursive: true });
    }
  });
});
