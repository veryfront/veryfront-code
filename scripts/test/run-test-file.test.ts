import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildTestFileCommandArgs,
  LOOPBACK_ALLOW_NET,
  PROVIDER_EGRESS_DENY_NET,
  TEST_FILE_ENV,
  type TestTargetFileSystem,
} from "./run-test-file.ts";

describe("test:file task command", () => {
  it("preserves test isolation flags while forwarding source paths and args", () => {
    const args = buildTestFileCommandArgs([
      "src/config/cicd-coverage-workflow.test.ts",
      "--filter",
      "cicd",
      "--allow-net=api.openai.com",
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
      "--allow-net=api.openai.com",
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
