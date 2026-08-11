import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { withTempDir } from "#veryfront/testing";
import { doctorCommand, reportDoctorResults, resolveDoctorPort, streamCheck } from "./index.ts";
import { withTestContext } from "../../../tests/_helpers/context.ts";
import { clearConfigCache } from "#veryfront/config";
import { setJsonMode } from "../../shared/json-output.ts";

describe("CLI doctor command", () => {
  it("stops progress before propagating an unexpected check error", async () => {
    let stopCalls = 0;

    await assertRejects(
      () =>
        streamCheck(
          () => Promise.reject(new Error("check crashed")),
          [],
          () => ({
            update() {},
            success() {},
            error() {},
            stop() {
              stopCalls++;
            },
          }),
        ),
      Error,
      "check crashed",
    );

    assertEquals(stopCalls, 1);
  });

  it("emits exactly one JSON success envelope without decorated prose", async () => {
    const output: unknown[][] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => output.push(args);
    setJsonMode(true);

    try {
      await reportDoctorResults(
        [
          { name: "Runtime", status: "pass", message: "Supported" },
          { name: "Cache", status: "warn", message: "Not configured" },
        ],
        { port: 3000 },
      );

      assertEquals(output.length, 1);
      assertEquals(output[0]?.length, 1);
      assertEquals(JSON.parse(String(output[0]?.[0])), {
        success: true,
        command: "doctor",
        data: {
          port: 3000,
          strict: false,
          checks: [
            { name: "Runtime", status: "pass", message: "Supported" },
            { name: "Cache", status: "warn", message: "Not configured" },
          ],
          summary: { total: 2, passed: 1, warnings: 1, failed: 0 },
        },
      });
    } finally {
      setJsonMode(false);
      console.log = originalLog;
    }
  });

  it("keeps JSON failure and strict paths free of partial output", async () => {
    const output: unknown[][] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => output.push(args);
    setJsonMode(true);

    try {
      await assertRejects(
        () =>
          reportDoctorResults(
            [{ name: "Runtime", status: "fail", message: "Unsupported" }],
            { port: 3000 },
          ),
        Error,
        "Doctor checks failed",
      );
      await assertRejects(
        () =>
          reportDoctorResults(
            [{ name: "Cache", status: "warn", message: "Not configured" }],
            { port: 3000, strict: true },
          ),
        Error,
        "Doctor strict mode",
      );
      assertEquals(output, []);
    } finally {
      setJsonMode(false);
      console.log = originalLog;
    }
  });

  it("pluralizes warning counts in failure messages", async () => {
    const originalLog = console.log;
    console.log = () => {};

    try {
      const failure = await assertRejects(
        () =>
          reportDoctorResults([
            { name: "Runtime", status: "fail", message: "Unsupported" },
            { name: "Cache", status: "warn", message: "Not configured" },
          ], { port: 3000 }),
        Error,
      );

      assertInstanceOf(failure, Error);
      assertStringIncludes(failure.message, "1 warning");
      assertEquals(failure.message.includes("warning(s)"), false);
    } finally {
      console.log = originalLog;
    }
  });

  it("uses the configured server port unless an explicit port overrides it", async () => {
    await withTestContext("cli-doctor-port", async (context) => {
      clearConfigCache();
      await writeTextFile(
        join(context.projectDir, "veryfront.config.js"),
        "export default { dev: { port: 4321 } };",
      );

      assertEquals(await resolveDoctorPort(context.projectDir), 4321);
      assertEquals(await resolveDoctorPort(context.projectDir, 5432), 5432);
    });
  });

  it("reports no warnings for a freshly scaffolded app-router project", async () => {
    await withTempDir(async (projectDir) => {
      clearConfigCache();
      await mkdir(join(projectDir, "app", "api", "ag-ui"), { recursive: true });
      await mkdir(join(projectDir, "agents"), { recursive: true });
      await mkdir(join(projectDir, "tools"), { recursive: true });
      await writeTextFile(
        join(projectDir, "app", "page.tsx"),
        "export default function Page() {\n  return <div />;\n}\n",
      );
      await writeTextFile(join(projectDir, "agents", "assistant.ts"), "export default {};\n");
      await writeTextFile(join(projectDir, "tools", "calculator.ts"), "export default {};\n");

      const output: unknown[][] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => output.push(args);
      setJsonMode(true);

      try {
        await doctorCommand(projectDir);
      } finally {
        setJsonMode(false);
        console.log = originalLog;
      }

      const envelope = JSON.parse(String(output[0]?.[0])) as {
        data: {
          checks: { name: string; status: string; message: string }[];
          summary: { warnings: number };
        };
      };
      const checks = envelope.data.checks;
      const warnings = checks.filter((check) => check.status !== "pass");

      assertEquals(
        warnings,
        [],
        `a healthy scaffold must produce no warnings, got ${JSON.stringify(warnings)}`,
      );
      assertEquals(envelope.data.summary.warnings, 0);
      assertEquals(
        checks.some((check) => check.name.includes("RSC manifest")),
        false,
        "RSC endpoint probes must be skipped while the experimental flag is off",
      );
      assertEquals(
        checks.some((check) => check.message.includes("Disabled")),
        false,
        "a project with agents/ and tools/ must not be reported as AI-disabled",
      );
    }, { prefix: "doctor-scaffold-" });
  });

  it("runs without throwing", async () => {
    await withTestContext("cli-doctor", async (context) => {
      // Remove default app directory to use pages router
      await remove(join(context.projectDir, "app"), { recursive: true });

      // pages directory already exists from TestContext
      await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Hello");

      await doctorCommand(context.projectDir);

      assert(true);
    });
  });
});
