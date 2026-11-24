import { assertEquals, assertRejects } from "#std/assert";
import { fromFileUrl } from "#std/path";
import {
  type CoverageIdentity,
  recordSourceCoverage,
  selectSourceCoverage,
  SOURCE_COVERAGE_LABELS,
} from "./source-coverage-artifacts.ts";

const ID: CoverageIdentity = { source: "a".repeat(40), run: "123", attempt: 2 };
const LCOV = "SF:src/example.ts\nDA:1,1\nend_of_record\n";

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "source-coverage-" });
  try {
    await Deno.mkdir(`${root}/receipts`);
    await run(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function receipt(root: string, stage: string, attempt = 1, lcov = LCOV): Promise<string> {
  const path = `${root}/receipts/coverage-source-${stage}-attempt-${attempt}`;
  await Deno.mkdir(path);
  await Deno.writeTextFile(`${path}/lcov.info`, lcov);
  await recordSourceCoverage(stage, path, { ...ID, attempt });
  return path;
}

Deno.test("current-run successful receipts survive a consumer-only retry", () =>
  fixture(async (root) => {
    for (const stage of SOURCE_COVERAGE_LABELS) await receipt(root, stage);
    await selectSourceCoverage(`${root}/receipts`, `${root}/output`, ID);
    for (const stage of SOURCE_COVERAGE_LABELS) {
      assertEquals(await Deno.readTextFile(`${root}/output/coverage-${stage}/lcov.info`), LCOV);
    }
  }));

Deno.test("each producer selects its latest available attempt without merging duplicate coverage", () =>
  fixture(async (root) => {
    await receipt(root, "context-ownership");
    const latest = LCOV.replace("DA:1,1", "DA:1,2");
    await receipt(root, "context-ownership", 2, latest);
    await receipt(root, "connected-local");
    await selectSourceCoverage(`${root}/receipts`, `${root}/output`, ID);
    assertEquals(
      await Deno.readTextFile(`${root}/output/coverage-context-ownership/lcov.info`),
      latest,
    );
  }));

Deno.test("a missing producer never writes a partial report", () =>
  fixture(async (root) => {
    await receipt(root, "context-ownership");
    await assertRejects(
      () => selectSourceCoverage(`${root}/receipts`, `${root}/output`, ID),
      Error,
      "Missing",
    );
    await assertRejects(() => Deno.stat(`${root}/output`), Deno.errors.NotFound);
  }));

for (const field of ["source", "run", "attempt", "stage", "schema", "sha256", "extra"]) {
  Deno.test(`receipt ${field} contamination fails before either report is written`, () =>
    fixture(async (root) => {
      await receipt(root, "context-ownership");
      const path = await receipt(root, "connected-local");
      const manifest = JSON.parse(await Deno.readTextFile(`${path}/source-coverage.json`));
      manifest[field] = field === "attempt" || field === "schema" ? 99 : "wrong";
      await Deno.writeTextFile(`${path}/source-coverage.json`, JSON.stringify(manifest));
      await assertRejects(() => selectSourceCoverage(`${root}/receipts`, `${root}/output`, ID));
      await assertRejects(() => Deno.stat(`${root}/output`), Deno.errors.NotFound);
    }));
}

Deno.test("modified LCOV bytes cannot reuse a valid receipt", () =>
  fixture(async (root) => {
    for (const stage of SOURCE_COVERAGE_LABELS) await receipt(root, stage);
    await Deno.writeTextFile(
      `${root}/receipts/coverage-source-connected-local-attempt-1/lcov.info`,
      LCOV.replace("DA:1,1", "DA:1,0"),
    );
    await assertRejects(
      () => selectSourceCoverage(`${root}/receipts`, `${root}/output`, ID),
      Error,
      "digest",
    );
  }));

Deno.test("future attempts, extra payloads and unsafe file types are rejected", () =>
  fixture(async (root) => {
    await receipt(root, "context-ownership");
    const path = await receipt(root, "connected-local", 3);
    await assertRejects(
      () => selectSourceCoverage(`${root}/receipts`, `${root}/output`, ID),
      Error,
      "Unexpected",
    );
    await Deno.rename(path, path.replace("attempt-3", "attempt-1"));
    const manifestPath = `${path.replace("attempt-3", "attempt-1")}/source-coverage.json`;
    const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
    manifest.attempt = 1;
    await Deno.writeTextFile(manifestPath, JSON.stringify(manifest));
    await Deno.writeTextFile(`${path.replace("attempt-3", "attempt-1")}/unexpected.txt`, "extra");
    await assertRejects(
      () => selectSourceCoverage(`${root}/receipts`, `${root}/output`, ID),
      Error,
      "Unexpected",
    );
    await Deno.remove(`${path.replace("attempt-3", "attempt-1")}/unexpected.txt`);
    await Deno.remove(`${path.replace("attempt-3", "attempt-1")}/lcov.info`);
    await Deno.mkdir(`${path.replace("attempt-3", "attempt-1")}/lcov.info`);
    await assertRejects(
      () => selectSourceCoverage(`${root}/receipts`, `${root}/output`, ID),
      Error,
      "Invalid",
    );
  }));

Deno.test("existing destinations are never overwritten", () =>
  fixture(async (root) => {
    for (const stage of SOURCE_COVERAGE_LABELS) await receipt(root, stage);
    await Deno.mkdir(`${root}/output/coverage-connected-local`, { recursive: true });
    await assertRejects(
      () => selectSourceCoverage(`${root}/receipts`, `${root}/output`, ID),
      Error,
      "already exists",
    );
    await assertRejects(
      () => Deno.stat(`${root}/output/coverage-context-ownership`),
      Deno.errors.NotFound,
    );
  }));

Deno.test("empty and truncated LCOV cannot produce receipts", () =>
  fixture(async (root) => {
    await Deno.writeTextFile(`${root}/lcov.info`, "SF:src/example.ts\nDA:1,1\n");
    await assertRejects(
      () => recordSourceCoverage("context-ownership", root, ID),
      Error,
      "complete LCOV",
    );
    await assertRejects(() => Deno.stat(`${root}/source-coverage.json`), Deno.errors.NotFound);
  }));

Deno.test("the workflow CLI records and selects both producer receipts", () =>
  fixture(async (root) => {
    const denoDir = Deno.env.get("DENO_DIR");
    const home = Deno.env.get("HOME");
    async function command(...args: string[]): Promise<boolean> {
      const result = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--config",
          fromFileUrl(new URL("../test.deno.json", import.meta.url)),
          "--no-npm",
          "--allow-read",
          "--allow-write",
          "--allow-env=GITHUB_SHA,GITHUB_RUN_ID,GITHUB_RUN_ATTEMPT",
          fromFileUrl(new URL("./source-coverage-artifacts.ts", import.meta.url)),
          ...args,
        ],
        clearEnv: true,
        env: {
          GITHUB_SHA: ID.source,
          GITHUB_RUN_ID: ID.run,
          GITHUB_RUN_ATTEMPT: "2",
          ...(denoDir ? { DENO_DIR: denoDir } : {}),
          ...(home ? { HOME: home } : {}),
        },
        signal: AbortSignal.timeout(10_000),
        stdout: "piped",
        stderr: "piped",
      }).output();
      return result.success;
    }
    for (const stage of SOURCE_COVERAGE_LABELS) {
      const directory = `${root}/receipts/coverage-source-${stage}-attempt-2`;
      await Deno.mkdir(directory);
      await Deno.writeTextFile(`${directory}/lcov.info`, LCOV);
      assertEquals(await command("record", stage, directory), true);
    }
    assertEquals(await command("select", `${root}/receipts`, `${root}/output`), true);
    assertEquals(
      await Deno.readTextFile(`${root}/output/coverage-connected-local/lcov.info`),
      LCOV,
    );
    assertEquals(await command("invalid", "first", "second"), false);
    assertEquals(await command("record"), false);
  }));
