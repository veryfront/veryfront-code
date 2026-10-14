import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fileURLToPath } from "node:url";
import {
  buildTemporaryJunitPaths,
  buildTestFileCommandArgGroups,
  buildTestFileCommandArgs,
  getJunitPath,
  hasDenoNoRun,
  LOOPBACK_ALLOW_NET,
  mergeDenoJunitReports,
  PROVIDER_EGRESS_DENY_NET,
  rewriteSplitJunitPathForCommandArgGroups,
  runTestFileCommandGroups,
  TEST_FILE_ENV,
  type TestTargetFileSystem,
} from "./run-test-file.ts";

describe("test:file task command", () => {
  it("preserves test isolation flags while forwarding source paths and args", () => {
    const args = buildTestFileCommandArgs([
      "src/config/cicd-coverage-workflow.test.ts",
      "--filter",
      "cicd",
      "--shuffle=123",
    ]);

    assertEquals(TEST_FILE_ENV.DENO_TESTING, "1");
    assertEquals(args.includes("--preload=src/testing/preload.ts"), true);
    assertEquals(args.includes("--allow-all"), false);
    assertEquals(args.includes(PROVIDER_EGRESS_DENY_NET), false);
    assertEquals(args.includes(LOOPBACK_ALLOW_NET), true);
    assertEquals(args.slice(-4), [
      "src/config/cicd-coverage-workflow.test.ts",
      "--filter",
      "cicd",
      "--shuffle=123",
    ]);
  });

  it("uses the scripts config for script tests without dropping forwarded args", () => {
    const args = buildTestFileCommandArgs([
      "scripts/test/coverage-ci.test.ts",
      "--filter",
      "coverage",
    ]);

    assertEquals(args.includes("--config=scripts/test.deno.json"), true);
    assertEquals(args.includes("--preload=src/testing/preload.ts"), false);
    assertEquals(args.includes(PROVIDER_EGRESS_DENY_NET), false);
    assertEquals(args.includes(LOOPBACK_ALLOW_NET), true);
    assertEquals(args.slice(-3), [
      "scripts/test/coverage-ci.test.ts",
      "--filter",
      "coverage",
    ]);
  });

  it("splits mixed source and script targets across their matching configs", () => {
    const groups = buildTestFileCommandArgGroups([
      "src/config/cicd-coverage-workflow.test.ts",
      "scripts/security/audit-npm.test.ts",
      "--filter",
      "audit",
    ]);

    assertEquals(groups.length, 2);
    assertEquals(groups[0]!.includes("--preload=src/testing/preload.ts"), true);
    assertEquals(groups[0]!.includes("--config=scripts/test.deno.json"), false);
    assertEquals(
      groups[0]!.includes("src/config/cicd-coverage-workflow.test.ts"),
      true,
    );
    assertEquals(
      groups[0]!.includes("scripts/security/audit-npm.test.ts"),
      false,
    );
    assertEquals(groups[0]!.slice(-2), ["--filter", "audit"]);

    assertEquals(groups[1]!.includes("--config=scripts/test.deno.json"), true);
    assertEquals(
      groups[1]!.includes("--preload=src/testing/preload.ts"),
      false,
    );
    assertEquals(
      groups[1]!.includes("scripts/security/audit-npm.test.ts"),
      true,
    );
    assertEquals(
      groups[1]!.includes("src/config/cicd-coverage-workflow.test.ts"),
      false,
    );
    assertEquals(groups[1]!.slice(-2), ["--filter", "audit"]);
  });

  it("uses distinct temporary JUnit reports for split mixed target runs", () => {
    const groups = buildTestFileCommandArgGroups([
      "src/config/cicd-coverage-workflow.test.ts",
      "scripts/security/audit-npm.test.ts",
      "--junit-path",
      "reports/junit.xml",
      "--filter",
      "--junit-path=needle",
    ]);

    const rewritten = rewriteSplitJunitPathForCommandArgGroups(groups, [
      "/tmp/source-junit.xml",
      "/tmp/scripts-junit.xml",
    ]);

    assertEquals(rewritten.requestedJunitPath, "reports/junit.xml");
    assertEquals(
      rewritten.commandArgGroups[0]!.includes("/tmp/source-junit.xml"),
      true,
    );
    assertEquals(
      rewritten.commandArgGroups[0]!.includes("reports/junit.xml"),
      false,
    );
    assertEquals(
      rewritten.commandArgGroups[0]!.includes("--junit-path=needle"),
      true,
    );
    assertEquals(
      rewritten.commandArgGroups[0]!.includes(
        "src/config/cicd-coverage-workflow.test.ts",
      ),
      true,
    );
    assertEquals(
      rewritten.commandArgGroups[0]!.includes(
        "scripts/security/audit-npm.test.ts",
      ),
      false,
    );
    assertEquals(
      rewritten.commandArgGroups[1]!.includes("/tmp/scripts-junit.xml"),
      true,
    );
    assertEquals(
      rewritten.commandArgGroups[1]!.includes("reports/junit.xml"),
      false,
    );
    assertEquals(
      rewritten.commandArgGroups[1]!.includes("--junit-path=needle"),
      true,
    );
    assertEquals(
      rewritten.commandArgGroups[1]!.includes(
        "scripts/security/audit-npm.test.ts",
      ),
      true,
    );
    assertEquals(
      rewritten.commandArgGroups[1]!.includes(
        "src/config/cicd-coverage-workflow.test.ts",
      ),
      false,
    );
  });

  it("does not treat forwarded no-run text as cache-only mode", () => {
    assertEquals(
      hasDenoNoRun([
        "src/config/cicd-coverage-workflow.test.ts",
        "scripts/security/audit-npm.test.ts",
        "--filter",
        "--no-run",
      ]),
      false,
    );
    assertEquals(
      hasDenoNoRun([
        "src/config/cicd-coverage-workflow.test.ts",
        "scripts/security/audit-npm.test.ts",
        "--filter",
        "--no-run",
        "--no-run",
      ]),
      true,
    );
  });

  it("keeps running split target groups after the first failure", async () => {
    const calls: string[][] = [];
    const failedExitCode = await runTestFileCommandGroups({
      commandArgGroups: [["source-group"], ["script-group"]],
      environment: TEST_FILE_ENV,
      redirectTestStdoutToStderr: false,
      runCommand: ({ commandArgs }) => {
        calls.push(commandArgs);
        return Promise.resolve(
          commandArgs[0] === "source-group"
            ? { success: false, code: 7 }
            : { success: true, code: 0 },
        );
      },
    });

    assertEquals(failedExitCode, 7);
    assertEquals(calls, [["source-group"], ["script-group"]]);
  });

  it("treats bare JUnit path as stdout without swallowing following options", () => {
    assertEquals(
      getJunitPath([
        "src/foo.test.ts",
        "scripts/foo.test.ts",
        "--junit-path",
        "--filter",
        "needle",
      ]),
      "-",
    );

    const groups = buildTestFileCommandArgGroups([
      "src/foo.test.ts",
      "scripts/foo.test.ts",
      "--junit-path",
      "--filter",
      "needle",
    ]);
    assertEquals(groups.length, 2);
    assertEquals(groups[0]!.slice(-3), ["--junit-path", "--filter", "needle"]);
    assertEquals(groups[1]!.slice(-3), ["--junit-path", "--filter", "needle"]);

    const rewritten = rewriteSplitJunitPathForCommandArgGroups(groups, [
      "/tmp/source.xml",
      "/tmp/scripts.xml",
    ]);
    assertEquals(rewritten.requestedJunitPath, "-");
    assertEquals(groups[0]!.includes("--filter"), true);
    assertEquals(rewritten.commandArgGroups[0]!.slice(-4), [
      "--junit-path",
      "/tmp/source.xml",
      "--filter",
      "needle",
    ]);
    assertEquals(rewritten.commandArgGroups[1]!.slice(-4), [
      "--junit-path",
      "/tmp/scripts.xml",
      "--filter",
      "needle",
    ]);

    const explicitStdoutGroups = buildTestFileCommandArgGroups([
      "src/foo.test.ts",
      "scripts/foo.test.ts",
      "--junit-path",
      "-",
    ]);
    const explicitStdoutRewrite = rewriteSplitJunitPathForCommandArgGroups(
      explicitStdoutGroups,
      ["/tmp/source.xml", "/tmp/scripts.xml"],
    );
    assertEquals(explicitStdoutRewrite.requestedJunitPath, "-");
    assertEquals(explicitStdoutRewrite.commandArgGroups[0]!.slice(-2), [
      "--junit-path",
      "/tmp/source.xml",
    ]);
    assertEquals(explicitStdoutRewrite.commandArgGroups[1]!.slice(-2), [
      "--junit-path",
      "/tmp/scripts.xml",
    ]);
  });

  it("uses safe temporary JUnit paths when merged reports print to stdout", () => {
    const paths = buildTemporaryJunitPaths("-", 2, {
      id: "fixed",
      tempDirectory: "/tmp/sdk5015",
    });

    assertEquals(paths, [
      "/tmp/sdk5015/veryfront-test-file-junit-fixed.part-0-fixed.xml",
      "/tmp/sdk5015/veryfront-test-file-junit-fixed.part-1-fixed.xml",
    ]);
  });

  it("merges split Deno JUnit reports without dropping either suite", () => {
    const merged = mergeDenoJunitReports([
      `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="1" failures="0" errors="0" skipped="0" time="0.25"><testsuite name="source" tests="1" failures="0" errors="0" skipped="0" time="0.25"></testsuite></testsuites>
`,
      `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="2" failures="1" errors="0" skipped="1" time="0.75"><testsuite name="scripts" tests="2" failures="1" errors="0" skipped="1" time="0.75"></testsuite></testsuites>
`,
    ]);

    assertEquals(
      merged.includes(
        '<testsuites tests="3" failures="1" errors="0" skipped="1" time="1">',
      ),
      true,
    );
    assertEquals(merged.includes('name="source"'), true);
    assertEquals(merged.includes('name="scripts"'), true);
  });

  it("keeps integration paths on the provider deny-list", () => {
    const args = buildTestFileCommandArgs(["tests/integration/routes.test.ts"]);

    assertEquals(args.includes("--allow-all"), true);
    assertEquals(args.includes(PROVIDER_EGRESS_DENY_NET), true);
    assertEquals(args.includes(LOOPBACK_ALLOW_NET), false);
  });

  it("does not classify option values as integration targets", () => {
    const args = buildTestFileCommandArgs([
      "src/foo.test.ts",
      "--filter",
      "tests/integration",
    ]);

    assertEquals(args.includes("--allow-all"), false);
    assertEquals(args.includes(PROVIDER_EGRESS_DENY_NET), false);
    assertEquals(args.includes(LOOPBACK_ALLOW_NET), true);
  });

  it("does not classify short or preload option values as integration targets", () => {
    const args = buildTestFileCommandArgs([
      "src/foo.test.ts",
      "-c",
      "tests/integration/deno.json",
      "-L",
      "debug",
      "--preload",
      "tests/integration/setup.ts",
    ]);

    assertEquals(args.includes("--allow-all"), false);
    assertEquals(args.includes(PROVIDER_EGRESS_DENY_NET), false);
    assertEquals(args.includes(LOOPBACK_ALLOW_NET), true);
  });

  it("does not classify ignored paths or script arguments as integration targets", () => {
    for (
      const rawArgs of [
        ["src/foo.test.ts", "--ignore", "tests/integration"],
        ["src/foo.test.ts", "--", "tests/integration"],
      ]
    ) {
      const args = buildTestFileCommandArgs(rawArgs);
      assertEquals(args.includes("--allow-all"), false);
      assertEquals(args.includes(PROVIDER_EGRESS_DENY_NET), false);
      assertEquals(args.includes(LOOPBACK_ALLOW_NET), true);
    }
  });

  it("rejects invocations without a positional test target", () => {
    for (
      const rawArgs of [
        [],
        ["--filter", "unit name"],
        ["--ignore", "tests/integration"],
        ["--", "script argument"],
      ]
    ) {
      assertThrows(
        () => buildTestFileCommandArgs(rawArgs),
        Error,
        "test:file requires at least one test file or directory target",
      );
    }
  });

  it("rejects permission flags before Deno can widen the test profile", () => {
    for (
      const permissionFlag of [
        "--allow-all",
        "--allow-import=https://example.com",
        "--allow-net=api.openai.com",
        "--deny-net=localhost",
        "-A",
        "-N",
      ]
    ) {
      assertThrows(
        () => buildTestFileCommandArgs(["src/foo.test.ts", permissionFlag]),
        Error,
        "test:file does not accept forwarded permission flags",
      );
    }

    const scriptArg = buildTestFileCommandArgs([
      "src/foo.test.ts",
      "--",
      "--allow-all",
    ]);
    assertEquals(scriptArg.includes(LOOPBACK_ALLOW_NET), true);
  });

  it("keeps ambiguous filesystem targets on loopback-only permissions", () => {
    const permissionDenied = new Deno.errors.PermissionDenied(
      "test target is unreadable",
    );
    const failures: TestTargetFileSystem[] = [
      {
        statSync: () => {
          throw permissionDenied;
        },
        readDirSync: () => [],
      },
      {
        statSync: () => ({ isDirectory: true }),
        readDirSync: () => {
          throw permissionDenied;
        },
      },
      {
        statSync: () => ({ isDirectory: true }),
        readDirSync: function* () {
          for (let index = 0; index <= 10_000; index++) {
            yield {
              name: `entry-${index}`,
              isDirectory: false,
              isFile: true,
              isSymlink: false,
            };
          }
        },
      },
    ];

    for (const fileSystem of failures) {
      const args = buildTestFileCommandArgs(["ambiguous-target"], fileSystem);
      assertEquals(args.includes("--allow-all"), false);
      assertEquals(args.includes(PROVIDER_EGRESS_DENY_NET), false);
      assertEquals(args.includes(LOOPBACK_ALLOW_NET), true);
    }
  });

  it("uses integration permissions for source-root integration tests", () => {
    for (
      const target of [
        "cli/commands/deploy/deploy.integration.test.ts",
        "src/discovery/auto-discovery.integration.test.ts",
      ]
    ) {
      const args = buildTestFileCommandArgs([target]);
      assertEquals(args.includes("--allow-all"), true, target);
      assertEquals(args.includes(PROVIDER_EGRESS_DENY_NET), true, target);
      assertEquals(args.includes(LOOPBACK_ALLOW_NET), false, target);
    }
  });

  it("classifies absolute repository targets relative to the project root", () => {
    const root = fileURLToPath(new URL("../../", import.meta.url))
      .replaceAll("\\", "/")
      .replace(/\/$/, "");
    for (
      const target of [
        `${root}/tests/integration/routes.test.ts`,
        `${root}/src/discovery/auto-discovery.integration.test.ts`,
      ]
    ) {
      const args = buildTestFileCommandArgs([target]);
      assertEquals(args.includes("--allow-all"), true, target);
      assertEquals(args.includes(PROVIDER_EGRESS_DENY_NET), true, target);
      assertEquals(args.includes(LOOPBACK_ALLOW_NET), false, target);
    }

    const scriptArgs = buildTestFileCommandArgs([
      `${root}/scripts/test/run-test-file.test.ts`,
    ]);
    assertEquals(scriptArgs.includes("--config=scripts/test.deno.json"), true);
  });

  it("canonicalizes relative dot segments before classifying targets", () => {
    for (
      const target of [
        "src/../tests/integration/routes.test.ts",
        "cli/../src/discovery/auto-discovery.integration.test.ts",
      ]
    ) {
      const args = buildTestFileCommandArgs([target]);
      assertEquals(args.includes("--allow-all"), true, target);
      assertEquals(args.includes(PROVIDER_EGRESS_DENY_NET), true, target);
      assertEquals(args.includes(LOOPBACK_ALLOW_NET), false, target);
    }

    const scriptArgs = buildTestFileCommandArgs([
      "src/../scripts/test/run-test-file.test.ts",
    ]);
    assertEquals(scriptArgs.includes("--config=scripts/test.deno.json"), true);
  });

  it("uses integration permissions when a target directory contains integration tests", () => {
    const args = buildTestFileCommandArgs(["src/server/dev-server"]);

    assertEquals(args.includes("--allow-all"), true);
    assertEquals(args.includes(PROVIDER_EGRESS_DENY_NET), true);
    assertEquals(args.includes(LOOPBACK_ALLOW_NET), false);
  });
});

describe("buildTestFileCommandArgs leak tracing", () => {
  it("traces leaks, so the first failure names the source", () => {
    // These leaks are load-dependent and do not reproduce on demand. Without
    // the flag the run reports only "run again with --trace-leaks", advice that
    // cannot be taken for a failure that will not recur.
    assertEquals(
      buildTestFileCommandArgs(["a.test.ts"]).includes("--trace-leaks"),
      true,
    );
  });
});
