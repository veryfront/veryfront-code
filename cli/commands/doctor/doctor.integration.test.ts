import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { doctorCommand, reportDoctorResults, resolveDoctorPort } from "./index.ts";
import { withTestContext } from "../../../tests/_helpers/context.ts";
import { clearConfigCache } from "#veryfront/config";
import { setJsonMode } from "../../shared/json-output.ts";

describe("CLI doctor command", () => {
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
