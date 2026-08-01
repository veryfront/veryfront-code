import { assertEquals, assertRejects, assertStringIncludes } from "#std/assert";
import {
  buildUnitTestCommandArgs,
  collectUnitTestFiles,
  partitionUnitTestFiles,
  SERIAL_CWD_UNIT_TESTS,
  sourceMutatesProcessCwd,
} from "./unit-test-runner.ts";

Deno.test("sourceMutatesProcessCwd detects direct and facade mutations without string false positives", () => {
  assertEquals(sourceMutatesProcessCwd("Deno.chdir('/tmp');"), true);
  assertEquals(sourceMutatesProcessCwd("process['chdir']('/tmp');"), true);
  assertEquals(
    sourceMutatesProcessCwd(
      'import { chdir as move } from "veryfront/platform"; move("/tmp");',
    ),
    true,
  );
  assertEquals(
    sourceMutatesProcessCwd("const { chdir: move } = Deno; move('/tmp');"),
    true,
  );
  assertEquals(
    sourceMutatesProcessCwd('assertEquals("chdir" in module, false);'),
    false,
  );
  assertEquals(
    sourceMutatesProcessCwd("// @veryfront-test-serial-cwd\nindirect();"),
    true,
  );
});

Deno.test("partitionUnitTestFiles fails closed for unreviewed and stale CWD classifications", async () => {
  const sources: Record<string, string> = {
    "safe.test.ts": "Deno.test('safe', () => {});",
    "serial.test.ts": "Deno.chdir('/tmp');",
  };
  const readTextFile = (path: string) => Promise.resolve(sources[path] ?? "");

  await assertRejects(
    () =>
      partitionUnitTestFiles(Object.keys(sources), {
        manifest: {},
        readTextFile,
      }),
    Error,
    "unreviewed CWD mutation: serial.test.ts",
  );
  await assertRejects(
    () =>
      partitionUnitTestFiles(["safe.test.ts"], {
        manifest: {
          "serial.test.ts": { category: "incidental", reason: "fixture" },
        },
        readTextFile,
      }),
    Error,
    "stale serial-CWD manifest entry: serial.test.ts",
  );

  assertEquals(
    await partitionUnitTestFiles(Object.keys(sources), {
      manifest: {
        "serial.test.ts": { category: "incidental", reason: "fixture" },
      },
      readTextFile,
    }),
    {
      parallelFiles: ["safe.test.ts"],
      serialCwdFiles: ["serial.test.ts"],
    },
  );
});

Deno.test("repository unit tests match the reviewed serial-CWD manifest", async () => {
  const partition = await partitionUnitTestFiles(await collectUnitTestFiles());
  assertEquals(
    partition.serialCwdFiles,
    Object.keys(SERIAL_CWD_UNIT_TESTS).sort(),
  );
  assertEquals(
    partition.parallelFiles.length > partition.serialCwdFiles.length,
    true,
  );
});

Deno.test("buildUnitTestCommandArgs guards only the parallel lane and forwards CLI flags", () => {
  const parallel = buildUnitTestCommandArgs(["safe.test.ts"], "parallel", [
    "--no-lock",
  ]);
  const serial = buildUnitTestCommandArgs(["serial.test.ts"], "serial-cwd");

  assertEquals(parallel.includes("--parallel"), true);
  assertEquals(parallel.includes("--no-lock"), true);
  assertEquals(
    parallel.includes("--preload=scripts/test/forbid-parallel-cwd-mutation.ts"),
    true,
  );
  assertEquals(serial.includes("--parallel"), false);
  assertEquals(
    serial.includes("--preload=scripts/test/forbid-parallel-cwd-mutation.ts"),
    false,
  );
});

Deno.test("parallel CWD guard rejects runtime mutations", async () => {
  const directory = await Deno.makeTempDir();
  const testPath = `${directory}/cwd-mutation.test.ts`;
  try {
    await Deno.writeTextFile(
      testPath,
      [
        'import process from "node:process";',
        "const guardedChdir = process.chdir;",
        "process.chdir = (path) => guardedChdir(path);",
        'Deno.test("mutation", () => process.chdir(Deno.cwd()));',
        "",
      ].join("\n"),
    );
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "test",
        "--no-check",
        "--allow-all",
        "--preload=scripts/test/forbid-parallel-cwd-mutation.ts",
        testPath,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();

    assertEquals(output.success, false);
    assertStringIncludes(
      new TextDecoder().decode(output.stdout) +
        new TextDecoder().decode(output.stderr),
      "Process-global CWD mutation is forbidden in the parallel unit-test lane",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
