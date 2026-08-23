import { ensureDir } from "#std/fs/ensure-dir";
import { dirname, join } from "#std/path";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatSemanticAuditFailure } from "../lint/audit-test-semantic-dispositions.ts";
import { planSuiteFiles } from "./run-suite.ts";
import { discoverTests } from "./test-layout.ts";
import {
  collectSemanticAuditCandidates,
  collectSemanticMarkers,
  compareSemanticDispositionBaseline,
  parseSemanticDispositionBaselineSource,
  type SemanticDispositionEntry,
  validateSemanticDispositions,
  validateSemanticDispositionShape,
} from "./test-semantic-audit.ts";
import {
  TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES,
} from "./test-semantic-audit-migration.ts";

const UNIT_ROOTS = [
  "src",
  "cli",
  "extensions",
  "templates",
  "scripts",
  "react",
] as const;

describe("semantic unit boundary candidate discovery", () => {
  it("returns an empty candidate inventory when unit roots have no executable tests", async () => {
    const root = await Deno.makeTempDir();
    try {
      for (const unitRoot of UNIT_ROOTS) {
        await ensureDir(join(root, unitRoot));
      }

      const result = await collectSemanticAuditCandidates({
        root,
        dispositions: [],
      });

      assertEquals(result.candidates, []);
      assertEquals(result.errors, []);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("discovers one effect-bearing executable from each colocated unit root", async () => {
    const root = await Deno.makeTempDir();
    try {
      const fixturePaths = [
        "src/a.test.ts",
        "cli/b.test.ts",
        "extensions/pkg/c.test.ts",
        "templates/d.test.ts",
        "scripts/e.test.ts",
        "react/f.test.tsx",
      ];
      for (const path of fixturePaths) {
        await writeFixture(
          root,
          path,
          `Deno.test("x", async () => { await Deno.readTextFile("deno.json"); });`,
        );
      }
      await writeFixture(
        root,
        "tests/integration/ignored.test.ts",
        `Deno.test("x", () => Deno.listen({ port: 0 }));`,
      );
      await writeFixture(
        root,
        "tests/e2e/ignored.playwright.ts",
        `import { test } from "@playwright/test"; test("x", async ({ page }) => page.goto("/"));`,
      );

      const result = await collectSemanticAuditCandidates({
        root,
        dispositions: fixturePaths.map((path) =>
          disposition(path, "filesystem-read")
        ),
      });

      assertEquals(result.errors, []);
      assertEquals(result.candidates.map((candidate) => candidate.path), [
        "cli/b.test.ts",
        "extensions/pkg/c.test.ts",
        "react/f.test.tsx",
        "scripts/e.test.ts",
        "src/a.test.ts",
        "templates/d.test.ts",
      ]);
      assertEquals(
        result.candidates.every((candidate) =>
          candidate.markers.map((marker) => marker.effect).join(",") ===
            "filesystem-read"
        ),
        true,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("parses every supported colocated executable extension fail-closed", async () => {
    const root = await Deno.makeTempDir();
    try {
      const fixturePaths = [
        "src/a.test.ts",
        "src/b.test.tsx",
        "src/c.test.js",
        "src/d.test.mjs",
        "src/e.test.cjs",
      ];
      for (const path of fixturePaths) {
        await writeFixture(
          root,
          path,
          `Deno.test("x", async () => { await fetch("https://example.com"); });`,
        );
      }

      const result = await collectSemanticAuditCandidates({
        root,
        dispositions: fixturePaths.map((path) => disposition(path, "network")),
      });

      assertEquals(result.errors, []);
      assertEquals(result.candidates.map((candidate) => candidate.path), [
        "src/a.test.ts",
        "src/b.test.tsx",
        "src/c.test.js",
        "src/d.test.mjs",
        "src/e.test.cjs",
      ]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("grants hermetic reads only when every operand is proven repository-local", async () => {
    const root = await Deno.makeTempDir();
    try {
      await writeFixture(
        root,
        "src/repository-read.test.ts",
        `
await Deno.readTextFile("fixtures/data.json");
await Deno.readTextFile(new URL("./fixture.json", import.meta.url));
`,
      );
      await writeFixture(
        root,
        "src/external-read.test.ts",
        `await Deno.readTextFile("/etc/hosts");`,
      );
      await writeFixture(
        root,
        "src/unresolved-read.test.ts",
        `async function read(path: string) { await Deno.readTextFile(path); }`,
      );
      await writeFixture(
        root,
        "src/encoded-traversal-read.test.ts",
        `await Deno.readTextFile(new URL("%2e%2e/%2e%2e/etc/hosts", import.meta.url));`,
      );

      const dispositions: SemanticDispositionEntry[] = [
        "src/repository-read.test.ts",
        "src/external-read.test.ts",
        "src/unresolved-read.test.ts",
        "src/encoded-traversal-read.test.ts",
      ].map((path) => ({
        path,
        effects: ["filesystem-read"],
        disposition: "hermetic-unit",
        owner: "test-architecture",
        rationale: "Reads a checked-in repository fixture.",
      }));
      const result = await collectSemanticAuditCandidates({
        root,
        paths: dispositions.map((entry) => entry.path),
        dispositions,
      });

      assertEquals(result.errors, [
        "hermetic-unit filesystem read is not proven repository-local: src/external-read.test.ts:1 Deno.readTextFile",
        "hermetic-unit filesystem read is not proven repository-local: src/unresolved-read.test.ts:1 Deno.readTextFile",
        "hermetic-unit filesystem read is not proven repository-local: src/encoded-traversal-read.test.ts:1 Deno.readTextFile",
      ]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("fails closed on invalid TypeScript", async () => {
    const root = await Deno.makeTempDir();
    try {
      await writeFixture(root, "src/bad.test.ts", "const = ;");

      const result = await collectSemanticAuditCandidates({
        root,
        dispositions: [],
      });

      assertEquals(result.candidates, []);
      assertEquals(result.errors.length, 1);
      assertEquals(
        result.errors[0]?.includes("Unable to parse src/bad.test.ts"),
        true,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("validates the live repository inventory across all six unit roots", async () => {
    const result = await collectSemanticAuditCandidates({
      root: ".",
      dispositions: TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES,
    });

    assertEquals(result.errors, []);
    const layout = await discoverTests({ root: "." });
    const unitRootFiles = layout.inventory.filter((entry) =>
      entry.level === "unit" &&
      entry.kind === "canonical" &&
      UNIT_ROOTS.some((root) => entry.path.startsWith(`${root}/`))
    );
    assertEquals(result.consideredFiles, unitRootFiles.length);
    assertEquals(
      new Set(result.consideredRoots),
      new Set([...UNIT_ROOTS]),
    );
    assertEquals(result.candidates.length > 0, true);
    assertEquals(
      result.candidates.every((candidate) =>
        UNIT_ROOTS.some((root) => candidate.path.startsWith(`${root}/`))
      ),
      true,
    );
  });
});

describe("semantic marker classification", () => {
  it("classifies filesystem, process, server, network, browser, and shared-cwd effects in stable order", () => {
    const markers = collectSemanticMarkers(
      `
import { test } from "@playwright/test";
import { Command, spawn } from "node:child_process";
import fs from "node:fs";
import { existsSync, mkdtempSync, unlinkSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
const server = Deno.serve(() => new Response("ok"));
await Deno.readTextFile("deno.json");
await Deno.writeTextFile("tmp.txt", "x");
await Deno.create("tmp.txt");
new Deno.Command("git", { args: ["status"] });
new Command("git");
spawn("git");
existsSync("deno.json");
mkdtempSync("tmp");
unlinkSync("tmp.txt");
fs.existsSync("deno.json");
fs.unlinkSync("tmp.txt");
await readFile("deno.json");
await writeFile("tmp.txt", "x");
await fetch("https://example.com");
Deno.chdir("fixtures");
test("browser", async ({ page, browser }) => {
  await page.goto("/");
  await browser.newPage();
});
`,
      "src/effects.test.ts",
    );

    assertEquals(
      markers.map((marker) => [marker.effect, marker.line, marker.symbol]),
      [
        ["browser", 2, "@playwright/test"],
        ["server", 7, "Deno.serve"],
        ["filesystem-read", 8, "Deno.readTextFile"],
        ["filesystem-write", 9, "Deno.writeTextFile"],
        ["filesystem-write", 10, "Deno.create"],
        ["process", 11, "Deno.Command"],
        ["process", 12, "Command"],
        ["process", 13, "spawn"],
        ["filesystem-read", 14, "existsSync"],
        ["filesystem-write", 15, "mkdtempSync"],
        ["filesystem-write", 16, "unlinkSync"],
        ["filesystem-read", 17, "fs.existsSync"],
        ["filesystem-write", 18, "fs.unlinkSync"],
        ["filesystem-read", 19, "readFile"],
        ["filesystem-write", 20, "writeFile"],
        ["network", 21, "fetch"],
        ["shared-cwd", 22, "Deno.chdir"],
        ["browser", 24, "page.goto"],
        ["browser", 25, "browser.newPage"],
      ],
    );
  });

  it("treats a Playwright import alone as browser usage", () => {
    assertEquals(
      collectSemanticMarkers(
        `import { test, expect } from "@playwright/test";`,
        "src/playwright-import.test.ts",
      ),
      [{
        effect: "browser",
        line: 1,
        symbol: "@playwright/test",
      }],
    );
  });

  it("ignores erased Playwright imports while retaining mixed value imports", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import type { Page } from "@playwright/test";
import { type Browser } from "playwright";
`,
        "src/playwright-types.test.ts",
      ),
      [],
    );
    assertEquals(
      collectSemanticMarkers(
        `import { test, type Page } from "@playwright/test";`,
        "src/playwright-mixed.test.ts",
      ),
      [{
        effect: "browser",
        line: 1,
        symbol: "@playwright/test",
      }],
    );
  });

  it("ignores comments, strings, templates, local fakes, and shadowed globals", () => {
    const markers = collectSemanticMarkers(
      `
// await Deno.readTextFile("deno.json");
const sample = "fetch('https://example.com')";
const template = \`Deno.serve(() => {})\`;
const Deno = {
  env: { get: () => "fake" },
  readTextFile: () => "fake",
  Command: class {},
  serve: () => {},
  chdir: () => {},
};
const process = { env: { MODE: "fake" }, exit: () => undefined };
function fetch() {}
class Command {}
const page = { goto: () => undefined };
Deno.readTextFile("deno.json");
Deno.env.get("MODE");
new Deno.Command("git");
Deno.serve(() => undefined);
Deno.chdir("fixtures");
process.env.MODE;
process.exit(0);
fetch("https://example.com");
new Command("git");
page.goto("/");
`,
      "src/decoys.test.ts",
    );

    assertEquals(markers, []);
  });

  it("ignores imported bindings that shadow runtime globals", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import { Deno, globalThis, process } from "./runtime-fakes.ts";
Deno.env.get("MODE");
process.env.MODE;
globalThis.fetch("https://example.com");
`,
        "src/imported-runtime-fakes.test.ts",
      ),
      [],
    );
  });

  it("keeps imported filesystem/process bindings shadow-aware", () => {
    const markers = collectSemanticMarkers(
      `
import { readFile } from "node:fs/promises";
import * as childProcess from "node:child_process";
function later(readFile: () => string, childProcess: { spawn: () => void }) {
  readFile();
  childProcess.spawn();
}
await readFile("deno.json");
childProcess.spawn("git");
`,
      "src/shadowed-imports.test.ts",
    );

    assertEquals(
      markers.map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-read", "readFile"],
        ["process", "childProcess.spawn"],
      ],
    );
  });

  it("classifies synchronous child-process execution across import shapes", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import { execFileSync as runFileSync, execSync } from "node:child_process";
import * as childProcess from "child_process";
const run = execSync;
execSync("git status");
runFileSync("git", ["status"]);
childProcess.execSync("git status");
const { execFileSync: namespaceRunFile } = childProcess;
namespaceRunFile("git", ["status"]);
run("git status");
function local(
  execSync: (command: string) => void,
  childProcess: { execFileSync(command: string): void },
) {
  execSync("git status");
  childProcess.execFileSync("git");
}
`,
        "src/synchronous-child-process.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["process", "execSync"],
        ["process", "runFileSync"],
        ["process", "childProcess.execSync"],
        ["process", "namespaceRunFile"],
        ["process", "run"],
      ],
    );
  });

  it("classifies canonical compat filesystem and process imports", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import { remove, stat } from "#veryfront/compat/fs.ts";
import { writeTextFile } from "#veryfront/platform/compat/fs.ts";
import {
  deleteEnv,
  getEnvNumber,
  runCommand,
  setEnv,
} from "#veryfront/compat/process.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
await stat("fixture.txt");
await remove("fixture.txt");
await writeTextFile("fixture.txt", "value");
getEnvNumber("TEST_KEY");
setEnv("TEST_KEY", "value");
deleteEnv("TEST_KEY");
await runCommand({ command: "deno", args: ["--version"] });
cwd();
`,
        "src/canonical-compat-imports.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-read", "stat"],
        ["filesystem-write", "remove"],
        ["filesystem-write", "writeTextFile"],
        ["process", "getEnvNumber"],
        ["process", "setEnv"],
        ["process", "deleteEnv"],
        ["process", "runCommand"],
        ["shared-cwd", "cwd"],
      ],
    );
  });

  it("classifies repo-relative compat filesystem and process imports from importer path", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import { runCommand } from "../process.ts";
import { remove } from "../fs.ts";
runCommand({ command: "deno" });
await remove("tmp.txt");
`,
        "src/platform/compat/nested/parent-relative.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["process", "runCommand"],
        ["filesystem-write", "remove"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
import { setEnv } from "./process.ts";
import { stat } from "./fs.ts";
setEnv("TEST_KEY", "value");
await stat("fixture.txt");
`,
        "src/platform/compat/sibling-relative.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["process", "setEnv"],
        ["filesystem-read", "stat"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
import { deleteEnv } from "./compat/process.ts";
import { remove } from "./compat/fs.ts";
deleteEnv("TEST_KEY");
await remove("tmp.txt");
`,
        "src/platform/compat-child-relative.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["process", "deleteEnv"],
        ["filesystem-write", "remove"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
import { runCommand } from "../process.ts";
import { remove } from "../fs.ts";
function local(runCommand: () => void, remove: () => void) {
  runCommand();
  remove();
}
`,
        "src/platform/compat/nested/shadowed-relative.test.ts",
      ),
      [],
    );
    assertEquals(
      collectSemanticMarkers(
        `
import { runCommand } from "../process.ts";
import { remove } from "../fs.ts";
runCommand({ command: "deno" });
await remove("tmp.txt");
`,
        "src/not-platform/compat/nested/unrelated-relative.test.ts",
      ),
      [],
    );
    assertEquals(
      collectSemanticMarkers(
        `
import { runCommand } from "./process/index.ts";
runCommand({ command: "deno" });
`,
        "src/platform/compat/unrelated-index.test.ts",
      ),
      [],
    );
    assertEquals(
      collectSemanticMarkers(
        `
import { runCommand } from "../../src/platform/compat/process.ts";
runCommand({ command: "deno" });
`,
        "src/escaped-relative.test.ts",
      ),
      [],
    );
  });

  it("classifies process namespace and default env access", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import processDefault from "node:process";
import * as proc from "node:process";
proc.env.MODE = "test";
const mode = proc.env.MODE;
processDefault.env.MODE = "prod";
const other = processDefault.env.MODE;
let runtime = process;
if (maybe) runtime = Deno;
const conditionalEnv = runtime.env;
const conditionalMode = runtime.env.MODE;
runtime.env.MODE = "next";
`,
        "src/process-namespace-env.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["process", "proc.env.MODE"],
        ["process", "proc.env.MODE"],
        ["process", "processDefault.env.MODE"],
        ["process", "processDefault.env.MODE"],
        ["process", "runtime.env"],
        ["process", "runtime.env.MODE"],
        ["process", "runtime.env.MODE"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
const proc = { env: { MODE: "test" } };
proc.env.MODE = "local";
const mode = proc.env.MODE;
`,
        "src/local-process-namespace-env.test.ts",
      ),
      [],
    );
  });

  it("classifies repo-relative compat loader expressions from importer path", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import { createRequire } from "node:module";
const compatProcess = require("../process.ts");
compatProcess.runCommand({ command: "deno" });
const compatFs = await import("../fs.ts");
await compatFs.remove("tmp.txt");
const compatRequire = createRequire(import.meta.url);
const requiredProcess = compatRequire("../process.ts");
requiredProcess.setEnv("TEST_KEY", "value");
`,
        "src/platform/compat/nested/relative-loader.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["process", "compatProcess.runCommand"],
        ["filesystem-write", "compatFs.remove"],
        ["process", "requiredProcess.setEnv"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
function require(_specifier: string) {
  return { runCommand: () => undefined };
}
const compatProcess = require("../process.ts");
compatProcess.runCommand({ command: "deno" });
`,
        "src/platform/compat/nested/shadowed-relative-loader.test.ts",
      ),
      [],
    );
  });

  it("classifies effect bindings loaded through require and dynamic import", () => {
    const markers = collectSemanticMarkers(
      `
import { createRequire } from "node:module";
const childProcess = createRequire(import.meta.url)("node:child_process");
childProcess.spawn = () => undefined;
const { createServer } = await import("node:http");
createServer(() => undefined);
const net = await import("node:net");
net.createServer(() => undefined);
const http = await import("node:http");
http.get("http://127.0.0.1");
const fs = require("node:fs/promises");
await fs.readFile("deno.json");
const directWrite = require("node:fs").promises.writeFile;
await directWrite("tmp.txt", "x");
const { default: defaultFs } = await import("node:fs");
await defaultFs.promises.readFile("deno.json");
const importedWrite = (await import("node:fs")).promises.writeFile;
await importedWrite("tmp.txt", "x");
import legacyFs = require("node:fs");
await legacyFs.promises.readFile("deno.json");
await (await import("node:fs")).writeFile("tmp.txt", "x");
await (await import("node:fs")).promises.writeFile("tmp.txt", "x");
(await import("node:http")).get("http://127.0.0.1");
require("node:fs").writeFile("tmp.txt", "x", () => undefined);
require("node:fs").promises.writeFile("tmp.txt", "x");
require("node:http").get("http://127.0.0.1");
await (await import("node:fs/promises")).open("deno.json", "r");
await require("node:fs").promises.open("tmp.txt", "w");
`,
      "src/runtime-loads.test.ts",
    );

    assertEquals(
      markers.map((marker) => [marker.effect, marker.line, marker.symbol]),
      [
        ["process", 4, "childProcess.spawn"],
        ["server", 6, "createServer"],
        ["server", 8, "net.createServer"],
        ["network", 10, "http.get"],
        ["filesystem-read", 12, "fs.readFile"],
        ["filesystem-write", 14, "directWrite"],
        ["filesystem-read", 16, "defaultFs.promises.readFile"],
        ["filesystem-write", 18, "importedWrite"],
        ["filesystem-read", 20, "legacyFs.promises.readFile"],
        ["filesystem-write", 21, "writeFile"],
        ["filesystem-write", 22, "writeFile"],
        ["network", 23, "get"],
        ["filesystem-write", 24, "writeFile"],
        ["filesystem-write", 25, "writeFile"],
        ["network", 26, "get"],
        ["filesystem-read", 27, "open"],
        ["filesystem-write", 28, "open"],
      ],
    );
  });

  it("propagates imported and local effect bindings through aliases", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import { writeFile } from "node:fs/promises";
const write = writeFile;
const writeAgain = write;
await writeAgain("tmp.txt", "x");
const fs = await import("node:fs/promises");
const aliasedFs = fs;
await aliasedFs.readFile("deno.json");
const watcher = Deno.watchFs;
const watcherAgain = watcher;
watcherAgain(".");
`,
        "src/aliased-effects.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "writeAgain"],
        ["filesystem-read", "aliasedFs.readFile"],
        ["filesystem-watch", "watcherAgain"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
function local(Deno: { watchFs(path: string): unknown }) {
  const watcher = Deno.watchFs;
  watcher(".");
}
`,
        "src/shadowed-global-runtime-method-alias.test.ts",
      ),
      [],
    );
  });

  it("unwraps exported runtime-binding declarations", () => {
    assertEquals(
      collectSemanticMarkers(
        `
export const fs = await import("node:fs");
await fs.writeFile("tmp.txt", "x");
export const childProcess = require("node:child_process");
childProcess.spawn("deno", ["--version"]);
export const NativeArray = Array;
Object.defineProperty(NativeArray.prototype, "constructor", {});
`,
        "src/exported-runtime-bindings.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "fs.writeFile"],
        ["process", "childProcess.spawn"],
        [
          "process",
          "Object.defineProperty(NativeArray.prototype.constructor)",
        ],
      ],
    );
  });

  it("classifies fs.promises namespaces and aliases", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import fs from "node:fs";
import * as nodeFs from "fs";
import { default as namedDefaultFs } from "node:fs";
await fs.promises.readFile("deno.json");
await fs.promises.writeFile("tmp.txt", "x");
await nodeFs.promises.rm("tmp.txt");
await namedDefaultFs.promises.readFile("deno.json");
const promised = fs.promises;
await promised.stat("deno.json");
const { promises: destructured } = nodeFs;
await destructured.appendFile("tmp.txt", "x");
function local(fs: { promises: { writeFile(): void } }) {
  fs.promises.writeFile();
}
function shadowNamedDefault(namedDefaultFs: { promises: { readFile(): void } }) {
  namedDefaultFs.promises.readFile();
}
`,
        "src/fs-promises-namespaces.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-read", "fs.promises.readFile"],
        ["filesystem-write", "fs.promises.writeFile"],
        ["filesystem-write", "nodeFs.promises.rm"],
        ["filesystem-read", "namedDefaultFs.promises.readFile"],
        ["filesystem-read", "promised.stat"],
        ["filesystem-write", "destructured.appendFile"],
      ],
    );
  });

  it("classifies standard fs imports and loaders", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import stdFs from "#std/fs";
import * as stdFsAlias from "#std/fs.ts";
import * as stdWalk from "#std/fs/walk";
import { ensureDir, walk as walkTree, emptyDir, copy, move } from "@std/fs";
const loadedStdFs = require("@std/fs");
const loadedStdWalk = await import("@std/fs/walk");
const loadedEnsureDir = await import("@std/fs/ensure-dir");
const aliasEnsureDir = ensureDir;
await aliasEnsureDir("tmp");
for await (const entry of walkTree(".")) entry.path;
await emptyDir("tmp");
await copy("source", "target");
await move("source", "target");
await stdFs.ensureDir("tmp");
await stdFsAlias.ensureDir("tmp");
for await (const entry of stdWalk.walk(".")) entry.path;
await loadedStdFs.emptyDir("tmp");
for await (const entry of loadedStdWalk.walk(".")) entry.path;
await loadedEnsureDir.ensureDir("tmp");
const { ensureDir: destructuredEnsureDir } = stdFs;
await destructuredEnsureDir("tmp");
function local(
  ensureDir: (path: string) => Promise<void>,
  stdFs: { ensureDir(path: string): Promise<void> },
) {
  ensureDir("local");
  stdFs.ensureDir("local");
}
`,
        "src/std-fs-imports.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "aliasEnsureDir"],
        ["filesystem-read", "walkTree"],
        ["filesystem-write", "emptyDir"],
        ["filesystem-write", "copy"],
        ["filesystem-write", "move"],
        ["filesystem-write", "stdFs.ensureDir"],
        ["filesystem-write", "stdFsAlias.ensureDir"],
        ["filesystem-read", "stdWalk.walk"],
        ["filesystem-write", "loadedStdFs.emptyDir"],
        ["filesystem-read", "loadedStdWalk.walk"],
        ["filesystem-write", "loadedEnsureDir.ensureDir"],
        ["filesystem-write", "destructuredEnsureDir"],
      ],
    );
  });

  it("classifies repository testing runtime wrappers", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import * as testingDeno from "#veryfront/testing/deno-compat";
import {
  cwd,
  env,
  exit,
  getArgs,
  getEnv,
  makeTempDir,
  readTextFile,
  remove,
  setEnv,
  waitFor,
  withEnv,
  withTempDir,
  withTempFile,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import {
  env as barrelEnv,
  withEnv as barrelWithEnv,
  withTempDir as barrelWithTempDir,
} from "#veryfront/testing";
const loadedTesting = await import("#veryfront/testing/deno-compat.ts");
await makeTempDir();
await readTextFile("deno.json");
await remove("tmp", { recursive: true });
setEnv("KEY", "value");
getEnv("KEY");
getArgs();
cwd();
env();
await withTempDir(async () => {});
await withTempFile(async () => {});
await withEnv({ KEY: "value" }, async () => {});
await writeTextFile("tmp.txt", "x");
exit(1);
await testingDeno.readTextFile("deno.json");
testingDeno.setEnv("KEY", "value");
testingDeno.env();
await loadedTesting.makeTempFile();
loadedTesting.env();
barrelEnv();
await barrelWithEnv({ KEY: "value" }, async () => {});
await barrelWithTempDir(async () => {});
await waitFor(() => true);
function local(
  makeTempDir: () => Promise<string>,
  testingDeno: { setEnv(name: string, value: string): void },
  env: () => Record<string, string>,
) {
  makeTempDir();
  testingDeno.setEnv("KEY", "value");
  env();
}
`,
        "src/testing-runtime-wrappers.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "makeTempDir"],
        ["filesystem-read", "readTextFile"],
        ["filesystem-write", "remove"],
        ["process", "setEnv"],
        ["process", "getEnv"],
        ["process", "getArgs"],
        ["shared-cwd", "cwd"],
        ["process", "env"],
        ["filesystem-write", "withTempDir"],
        ["filesystem-write", "withTempFile"],
        ["process", "withEnv"],
        ["filesystem-write", "writeTextFile"],
        ["process", "exit"],
        ["filesystem-read", "testingDeno.readTextFile"],
        ["process", "testingDeno.setEnv"],
        ["process", "testingDeno.env"],
        ["filesystem-write", "loadedTesting.makeTempFile"],
        ["process", "loadedTesting.env"],
        ["process", "barrelEnv"],
        ["process", "barrelWithEnv"],
        ["filesystem-write", "barrelWithTempDir"],
      ],
    );
  });

  it("classifies repository mock-fetch helpers as network effects", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import {
  installMockFetch,
  restoreMockFetch as restoreFetch,
  withMockFetch,
} from "#veryfront/testing/mock-fetch.ts";
import * as mockFetchHelpers from "#veryfront/testing/mock-fetch";
import { withMockFetch as relativeWithMockFetch } from "./testing/mock-fetch.ts";
const loadedMockFetch = await import("#veryfront/testing/mock-fetch.ts");
await withMockFetch(undefined, async () => {});
installMockFetch(fetch);
restoreFetch();
await mockFetchHelpers.withMockFetch(undefined, async () => {});
mockFetchHelpers.installMockFetch(fetch);
mockFetchHelpers.restoreMockFetch();
await relativeWithMockFetch(undefined, async () => {});
await loadedMockFetch.withMockFetch(undefined, async () => {});
function local(
  withMockFetch: (mock: undefined, run: () => Promise<void>) => Promise<void>,
  mockFetchHelpers: { restoreMockFetch(): void },
) {
  withMockFetch(undefined, async () => {});
  mockFetchHelpers.restoreMockFetch();
}
`,
        "src/example.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["network", "withMockFetch"],
        ["network", "installMockFetch"],
        ["network", "restoreFetch"],
        ["network", "mockFetchHelpers.withMockFetch"],
        ["network", "mockFetchHelpers.installMockFetch"],
        ["network", "mockFetchHelpers.restoreMockFetch"],
        ["network", "relativeWithMockFetch"],
        ["network", "loadedMockFetch.withMockFetch"],
      ],
    );
  });

  it("preserves callable effects through statically known object literals", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import { readFile } from "node:fs/promises";
import * as fs from "node:fs";
import dns from "node:dns";
const ops = { request: fetch, read: readFile };
await ops.request("https://example.com");
await ops.read("fixtures/data.json");
const nested = { io: { request: fetch } };
await nested.io.request("https://example.com");
const spread = { ...ops };
await spread.request("https://example.com");
const spreadFs = { ...fs };
spreadFs.writeFileSync("tmp.txt", "x");
const spreadDns = { ...dns };
spreadDns.lookup("example.com", () => {});
const { writeFileSync: spreadWrite } = { ...fs };
spreadWrite("tmp.txt", "x");
const overridden = { ...fs, writeFileSync: () => undefined };
overridden.writeFileSync("tmp.txt", "x");
const restored = { writeFileSync: () => undefined, ...fs };
restored.writeFileSync("tmp.txt", "x");
function local(fetch: () => Promise<Response>) {
  const helpers = { request: fetch };
  return helpers.request();
}
`,
        "src/object-literal-effects.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["network", "ops.request"],
        ["filesystem-read", "ops.read"],
        ["network", "nested.io.request"],
        ["network", "spread.request"],
        ["filesystem-write", "spreadFs.writeFileSync"],
        ["network", "spreadDns.lookup"],
        ["filesystem-write", "spreadWrite"],
        ["filesystem-write", "restored.writeFileSync"],
      ],
    );
  });

  it("tracks callable effects assigned to statically known object properties", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import * as fs from "node:fs";
const ops = {};
ops.run = fetch;
await ops.run("https://example.com/assigned");
ops.run = () => undefined;
ops.run("https://example.com/cleared");
ops.run = Deno.writeTextFile;
await ops.run("tmp.txt", "x");
const nested = {};
nested.io = {};
nested.io.run = fetch;
await nested.io.run("https://example.com/nested");
const computed = {};
computed["run"] = fetch;
await computed.run("https://example.com/computed");
const conditional = {};
if (maybe) conditional.run = fetch;
await conditional.run("https://example.com/conditional");
const cleared = { run: fetch };
cleared.run = () => undefined;
cleared.run("https://example.com/not-network");
const clearedAliasSource = { run: fetch };
clearedAliasSource.run = () => undefined;
const clearedRun = clearedAliasSource.run;
clearedRun("https://example.com/not-network-alias");
const { run: clearedDestructuredRun } = clearedAliasSource;
clearedDestructuredRun("https://example.com/not-network-destructured");
const clearedSpread = { ...fs };
clearedSpread.writeFileSync = () => undefined;
const clearedSpreadWrite = clearedSpread.writeFileSync;
clearedSpreadWrite("not-a-write.txt", "x");
const { writeFileSync: clearedDestructuredWrite } = clearedSpread;
clearedDestructuredWrite("not-a-destructured-write.txt", "x");
const conditionallyCleared = { run: fetch };
if (maybe) conditionallyCleared.run = () => undefined;
const { run: possibleRun } = conditionallyCleared;
await possibleRun("https://example.com/possible");
const rebound = { run: () => undefined };
rebound.run = fetch;
const reboundRun = rebound.run;
await reboundRun("https://example.com/rebound-alias");
const { run: reboundDestructuredRun } = rebound;
await reboundDestructuredRun("https://example.com/rebound-destructured");
function local(fetch: () => Promise<Response>) {
  const localOps = {};
  localOps.run = fetch;
  return localOps.run();
}
`,
        "src/assigned-object-property-effects.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["network", "ops.run"],
        ["filesystem-write", "ops.run"],
        ["network", "nested.io.run"],
        ["network", "computed.run"],
        ["network", "conditional.run"],
        ["network", "possibleRun"],
        ["network", "reboundRun"],
        ["network", "reboundDestructuredRun"],
      ],
    );
  });

  it("classifies Node DNS modules as network effects", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import { lookup, resolve4 as resolveIpv4 } from "node:dns";
import dns from "node:dns/promises";
import * as legacyDns from "dns";
import dnsCallback from "node:dns";
import {
  promises as dnsPromises,
  Resolver as CallbackResolver,
} from "node:dns";
import { Resolver as PromiseResolver } from "node:dns/promises";
const loadedDns = await import("dns/promises");
const requiredDns = require("node:dns");
const lookupAlias = lookup;
lookupAlias("example.com", () => {});
resolveIpv4("example.com", () => {});
await dns.resolve("example.com");
legacyDns.reverse("127.0.0.1", () => {});
await loadedDns.resolveTxt("example.com");
await dnsCallback.promises.resolve4("example.com");
await legacyDns.promises.resolve6("example.com");
await dnsPromises.resolveCname("example.com");
await requiredDns.promises.resolveMx("example.com");
const callbackResolver = new CallbackResolver();
callbackResolver.resolve4("example.com", () => {});
callbackResolver.cancel();
const promiseResolver = new PromiseResolver();
await promiseResolver.resolveTxt("example.com");
promiseResolver.setServers(["1.1.1.1"]);
const defaultResolver = new dnsCallback.Resolver();
defaultResolver.resolveNs("example.com", () => {});
const namespaceResolver = new legacyDns.Resolver();
namespaceResolver.resolveSoa("example.com", () => {});
const requiredResolver = new requiredDns.Resolver();
await requiredResolver.reverse("127.0.0.1");
const reflectedResolver = Reflect.construct(PromiseResolver, []);
await reflectedResolver.resolve4("example.com");
reflectedResolver.cancel();
const { construct: constructResolver } = Reflect;
const destructuredResolver = constructResolver(CallbackResolver, []);
destructuredResolver.resolve6("example.com", () => {});
const boundResolverConstruct = Reflect.construct.bind(Reflect);
const boundResolver = boundResolverConstruct(PromiseResolver, []);
await boundResolver.resolveCaa("example.com");
function local(
  lookup: () => void,
  dns: { resolve(): void },
  Resolver: new () => { resolve(): void },
) {
  lookup();
  dns.resolve();
  const resolver = new Resolver();
  resolver.resolve();
}
function localReflect(
  Reflect: { construct(constructor: unknown, args: unknown[]): unknown },
) {
  const resolver = Reflect.construct(PromiseResolver, []);
  resolver.resolve4("example.com");
}
`,
        "src/node-dns-effects.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["network", "lookupAlias"],
        ["network", "resolveIpv4"],
        ["network", "dns.resolve"],
        ["network", "legacyDns.reverse"],
        ["network", "loadedDns.resolveTxt"],
        ["network", "dnsCallback.promises.resolve4"],
        ["network", "legacyDns.promises.resolve6"],
        ["network", "dnsPromises.resolveCname"],
        ["network", "requiredDns.promises.resolveMx"],
        ["network", "callbackResolver.resolve4"],
        ["network", "promiseResolver.resolveTxt"],
        ["network", "defaultResolver.resolveNs"],
        ["network", "namespaceResolver.resolveSoa"],
        ["network", "requiredResolver.reverse"],
        ["network", "reflectedResolver.resolve4"],
        ["network", "destructuredResolver.resolve6"],
        ["network", "boundResolver.resolveCaa"],
      ],
    );
  });

  it("classifies runtime argument reads as process effects", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import processDefault from "node:process";
import * as processRuntime from "node:process";
const loadedProcess = await import("node:process");
const denoArgs = Deno.args;
const processArgs = process.argv;
const globalDenoArgs = globalThis.Deno.args;
const globalProcessArgs = globalThis.process.argv;
const defaultArgs = processDefault.argv;
const namespaceArgs = processRuntime.argv;
const loadedArgs = loadedProcess.argv;
denoArgs.length;
processArgs.length;
globalDenoArgs.length;
globalProcessArgs.length;
defaultArgs.length;
namespaceArgs.length;
loadedArgs.length;
function local(
  Deno: { args: string[] },
  process: { argv: string[] },
  processRuntime: { argv: string[] },
) {
  Deno.args[0];
  process.argv[0];
  processRuntime.argv[0];
}
`,
        "src/runtime-argument-reads.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["process", "Deno.args"],
        ["process", "process.argv"],
        ["process", "globalThis.Deno.args"],
        ["process", "globalThis.process.argv"],
        ["process", "processDefault.argv"],
        ["process", "processRuntime.argv"],
        ["process", "loadedProcess.argv"],
        ["process", "denoArgs.length"],
        ["process", "processArgs.length"],
        ["process", "globalDenoArgs.length"],
        ["process", "globalProcessArgs.length"],
        ["process", "defaultArgs.length"],
        ["process", "namespaceArgs.length"],
        ["process", "loadedArgs.length"],
      ],
    );
  });

  it("classifies extracted fs.promises methods from static namespace paths", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import fs from "node:fs";
const readFromPromises = fs.promises.readFile;
const writeFromPromises = fs.promises.writeFile;
await readFromPromises("deno.json");
await writeFromPromises("tmp.txt", "x");
const {
  promises: {
    readFile: nestedReadFile,
    rm: nestedRm,
    writeFile: nestedWriteFile,
  },
} = fs;
await nestedReadFile("deno.json");
await nestedRm("tmp.txt");
await nestedWriteFile("tmp.txt", "x");
`,
        "src/extracted-fs-promises-methods.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-read", "readFromPromises"],
        ["filesystem-write", "writeFromPromises"],
        ["filesystem-read", "nestedReadFile"],
        ["filesystem-write", "nestedRm"],
        ["filesystem-write", "nestedWriteFile"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
function local(fs: { promises: { readFile(): void } }) {
  const readFromPromises = fs.promises.readFile;
  readFromPromises();
  const { promises: { rm } } = fs;
  rm();
}
`,
        "src/local-extracted-fs-promises-methods.test.ts",
      ),
      [],
    );
  });

  it("classifies literal computed runtime properties", () => {
    const markers = collectSemanticMarkers(
      `
await Deno["writeTextFile"]("tmp.txt", "x");
await Deno["readTextFile"]("deno.json");
process["exit"](0);
globalThis["fetch"]("https://example.com");
`,
      "src/computed-runtime.test.ts",
    );

    assertEquals(
      markers.map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "Deno.writeTextFile"],
        ["filesystem-read", "Deno.readTextFile"],
        ["process", "process.exit"],
        ["network", "globalThis.fetch"],
      ],
    );
  });

  it("fails closed for unknown computed properties on runtime receivers", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import * as fs from "node:fs";
const denoMethod = "writeTextFile";
await Deno[denoMethod]("tmp.txt", "x");
await Deno["write" + "TextFile"]("tmp.txt", "x");
const fsMethod = "writeFileSync";
fs[fsMethod]("tmp.txt", "x");
`,
        "src/unknown-computed-runtime.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-read", "Deno.*"],
        ["filesystem-watch", "Deno.*"],
        ["filesystem-write", "Deno.*"],
        ["network", "Deno.*"],
        ["process", "Deno.*"],
        ["server", "Deno.*"],
        ["shared-cwd", "Deno.*"],
        ["filesystem-read", "Deno.*"],
        ["filesystem-watch", "Deno.*"],
        ["filesystem-write", "Deno.*"],
        ["network", "Deno.*"],
        ["process", "Deno.*"],
        ["server", "Deno.*"],
        ["shared-cwd", "Deno.*"],
        ["filesystem-read", "fs.*"],
        ["filesystem-watch", "fs.*"],
        ["filesystem-write", "fs.*"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
const Deno = { writeTextFile: () => undefined };
const method = "writeTextFile";
Deno[method]("tmp.txt", "x");
function local(fs: { writeFileSync(): void }, method: string) {
  fs[method]();
}
`,
        "src/shadowed-unknown-computed-runtime.test.ts",
      ),
      [],
    );
  });

  it("bounds conservative lookup across cyclic runtime aliases", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const holder = { run: Deno.writeTextFile };
holder.self = holder;
holder[key]("self-cycle.txt", "x");

const left = { run: Deno.writeTextFile };
const right = { peer: left };
left.peer = right;
right[key]("mutual-cycle.txt", "x");
`,
        "src/cyclic-runtime-aliases.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "holder.*"],
        ["filesystem-write", "right.*"],
      ],
    );
  });

  it("bounds conservative lookup across deep acyclic runtime aliases", () => {
    const depth = 16_384;
    const aliases = Array.from(
      { length: depth },
      (_, index) => `const alias${index + 1} = { peer: alias${index} };`,
    ).join("\n");
    assertEquals(
      collectSemanticMarkers(
        `
const alias0 = { run: Deno.writeTextFile };
${aliases}
alias${depth}[key]("deep-alias.txt", "x");
`,
        "src/deep-runtime-aliases.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["filesystem-write", `alias${depth}.*`]],
    );
    const spreads = Array.from(
      { length: depth },
      (_, index) => `const spread${index + 1} = { ...spread${index} };`,
    ).join("\n");
    assertEquals(
      collectSemanticMarkers(
        `
const spread0 = { run: Deno.writeTextFile };
${spreads}
spread${depth}[key]("deep-spread.txt", "x");
`,
        "src/deep-runtime-spreads.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["filesystem-write", `spread${depth}.*`]],
    );
    assertEquals(
      collectSemanticMarkers(
        `
const mutationSpread0 = { run: () => undefined };
${
          Array.from(
            { length: depth },
            (_, index) =>
              `const mutationSpread${
                index + 1
              } = { ...mutationSpread${index} };`,
          ).join("\n")
        }
mutationSpread${depth}.run = Deno.writeTextFile;
mutationSpread${depth}.run("deep-spread-mutation.txt", "x");
`,
        "src/deep-runtime-spread-mutation.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["filesystem-write", `mutationSpread${depth}.run`]],
    );
  });

  it("retains runtime provenance stored through unknown computed properties", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const key = "write";
const otherKey = "write";
const assigned = {};
assigned[key] = Deno.writeTextFile;
assigned.write("assigned.txt", "x");
assigned[otherKey]("assigned-computed.txt", "x");
const literal = { [key]: Deno.writeTextFile };
literal.write("literal.txt", "x");
literal[otherKey]("literal-computed.txt", "x");
const literalAlias = literal[otherKey];
literalAlias("literal-alias.txt", "x");
const known = { write: Deno.writeTextFile };
const knownAlias = known[otherKey];
knownAlias("known-alias.txt", "x");
const { [otherKey]: knownDestructuredAlias } = known;
knownDestructuredAlias("known-destructured-alias.txt", "x");
class ComputedInstanceField {
  [key] = Deno.writeTextFile;
  run() {
    this.write("instance-field.txt", "x");
  }
}
class ComputedStaticField {
  static [key] = Deno.writeTextFile;
  static run() {
    this.write("static-field-this.txt", "x");
    ComputedStaticField.write("static-field-name.txt", "x");
  }
}
const indexed = [Deno.writeTextFile];
indexed[0]("indexed.txt", "x");
const dynamicIndex = 0;
indexed[dynamicIndex]("indexed-dynamic.txt", "x");
const indexedAlias = indexed[dynamicIndex];
indexedAlias("indexed-alias.txt", "x");
const assignedIndexed = [];
assignedIndexed[0] = Deno.writeTextFile;
assignedIndexed[0]("assigned-indexed.txt", "x");
`,
        "src/unknown-computed-storage.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "assigned.write"],
        ["filesystem-write", "assigned.*"],
        ["filesystem-write", "literal.write"],
        ["filesystem-write", "literal.*"],
        ["filesystem-write", "literalAlias"],
        ["filesystem-write", "knownAlias"],
        ["filesystem-write", "knownDestructuredAlias"],
        ["filesystem-write", "this.write"],
        ["filesystem-write", "this.write"],
        ["filesystem-write", "ComputedStaticField.write"],
        ["filesystem-write", "indexed.0"],
        ["filesystem-write", "indexed.*"],
        ["filesystem-write", "indexedAlias"],
        ["filesystem-write", "assignedIndexed.0"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
const key = "write";
const otherKey = "write";
const assigned = {};
assigned[key] = () => undefined;
assigned.write();
assigned[otherKey]();
const literal = { [key]: () => undefined };
literal.write();
literal[otherKey]();
const literalAlias = literal[otherKey];
literalAlias();
const known = { write: () => undefined };
const knownAlias = known[otherKey];
knownAlias();
const { [otherKey]: knownDestructuredAlias } = known;
knownDestructuredAlias();
class LocalComputedField {
  [key] = () => undefined;
  run() {
    this.write();
  }
}
const indexed = [() => undefined];
indexed[0]();
const dynamicIndex = 0;
indexed[dynamicIndex]();
const indexedAlias = indexed[dynamicIndex];
indexedAlias();
`,
        "src/local-unknown-computed-storage.test.ts",
      ),
      [],
    );
  });

  it("keeps repeated unknown property writes bounded", () => {
    const writes = Array.from(
      { length: 30 },
      (_, index) => `holder[key${index}] = Deno.writeTextFile;`,
    ).join("\n");
    const conditionalWrites = Array.from(
      { length: 30 },
      (_, index) =>
        `if (maybe${index}) conditionalHolder.write = Deno.writeTextFile;`,
    ).join("\n");
    assertEquals(
      collectSemanticMarkers(
        `
const holder = {};
${writes}
const selected = "write";
holder[selected]("bounded.txt", "x");
const conditionalHolder = {};
${conditionalWrites}
conditionalHolder.write("conditional-bounded.txt", "x");
`,
        "src/repeated-unknown-property-writes.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "holder.*"],
        ["filesystem-write", "conditionalHolder.write"],
      ],
    );
  });

  it("propagates runtime provenance through array destructuring", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const [declared] = [Deno.writeTextFile];
declared("declared.txt", "x");
let assigned;
[assigned] = [Deno.writeTextFile];
assigned("assigned.txt", "x");
const { fns: [nested] } = { fns: [Deno.writeTextFile] };
nested("nested.txt", "x");
const [defaulted = Deno.writeTextFile] = [];
defaulted("defaulted.txt", "x");
const [exact = Deno.readTextFile] = [Deno.writeTextFile];
exact("exact.txt", "x");
const [conditionalDefault = fetch] = [
  maybe ? Deno.writeTextFile : undefined,
];
await conditionalDefault("conditional-default.txt", "x");
const [prefixBeforeSpread] = [
  Deno.writeTextFile,
  ...[() => undefined],
];
prefixBeforeSpread("prefix-before-spread.txt", "x");
const postSpreadValues = [() => undefined, Deno.writeTextFile];
const [, postSpreadSelected] = [
  ...postSpreadValues,
  () => undefined,
];
postSpreadSelected("post-spread-selected.txt", "x");
const [, knownPostSpreadEffect] = [
  ...[() => undefined],
  Deno.writeTextFile,
];
knownPostSpreadEffect("known-post-spread-effect.txt", "x");
const unknownSpreadValues = maybe ? [] : [() => undefined];
const [unknownPostSpreadEffect] = [
  ...unknownSpreadValues,
  Deno.writeTextFile,
];
unknownPostSpreadEffect("unknown-post-spread-effect.txt", "x");
const unknownEffectSpreadValues = maybe ? [] : [Deno.writeTextFile];
const [, unknownSpreadEffect] = [
  () => undefined,
  ...unknownEffectSpreadValues,
];
unknownSpreadEffect("unknown-spread-effect.txt", "x");
const [, ...rest] = [() => undefined, Deno.writeTextFile];
rest[0]("rest.txt", "x");
const knownArraySource = [() => undefined, Deno.writeTextFile];
const [, ...knownArrayRest] = knownArraySource;
knownArrayRest[0]("known-array-rest.txt", "x");
const dynamic = [() => undefined];
dynamic[Math.random()] = Deno.writeTextFile;
const [...dynamicRest] = dynamic;
dynamicRest[0]("dynamic-rest.txt", "x");

class ArrayClass {}
const [ArrayAlias] = [ArrayClass];
ArrayAlias.write = Deno.writeTextFile;
ArrayClass.write("array-class.txt", "x");

class ArrayExactClass {}
class ArrayUnusedDefaultClass {}
const [ArrayExactAlias = ArrayUnusedDefaultClass] = [ArrayExactClass];
ArrayExactAlias.write = Deno.writeTextFile;
ArrayExactClass.write("array-exact-class.txt", "x");
ArrayUnusedDefaultClass.write("array-unused-default-class.txt", "x");

class ArrayRestClass {}
const [, ...classes] = [class {}, ArrayRestClass];
const RestClassAlias = classes[0];
RestClassAlias.write = Deno.writeTextFile;
ArrayRestClass.write("array-rest-class.txt", "x");

class PostSpreadClass {}
const postSpreadClasses = [class {}, PostSpreadClass];
const [, PostSpreadAlias] = [...postSpreadClasses, class {}];
PostSpreadAlias.write = Deno.writeTextFile;
PostSpreadClass.write("post-spread-class.txt", "x");
`,
        "src/runtime-array-destructuring.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "declared"],
        ["filesystem-write", "assigned"],
        ["filesystem-write", "nested"],
        ["filesystem-write", "defaulted"],
        ["filesystem-write", "exact"],
        ["filesystem-write", "conditionalDefault"],
        ["network", "conditionalDefault"],
        ["filesystem-write", "prefixBeforeSpread"],
        ["filesystem-write", "postSpreadSelected"],
        ["filesystem-write", "knownPostSpreadEffect"],
        ["filesystem-write", "unknownPostSpreadEffect"],
        ["filesystem-write", "unknownSpreadEffect"],
        ["filesystem-write", "rest.0"],
        ["filesystem-write", "knownArrayRest.0"],
        ["filesystem-write", "dynamicRest.0"],
        ["filesystem-write", "ArrayClass.write"],
        ["filesystem-write", "ArrayExactClass.write"],
        ["filesystem-write", "ArrayRestClass.write"],
        ["filesystem-write", "PostSpreadClass.write"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
const numericObjectSource = {
  0: Deno.writeTextFile,
  1: () => undefined,
};
const [, ...objectRest] = numericObjectSource;
objectRest[0]("numeric-object-rest.txt", "x");
`,
        "src/runtime-numeric-object-rest.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["filesystem-write", "objectRest.0"]],
    );
    const nestedKnownSpreads = Array.from(
      { length: 24 },
      (_, index) =>
        `const spread${index + 1} = [...spread${index}, ...spread${index}];`,
    ).join("\n");
    assertEquals(
      collectSemanticMarkers(
        `
const spread0 = [Deno.writeTextFile];
${nestedKnownSpreads}
spread24[0]("bounded-nested-spread.txt", "x");
`,
        "src/runtime-bounded-nested-array-spreads.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["filesystem-write", "spread24.0"]],
    );
    assertEquals(
      collectSemanticMarkers(
        `
const [declared] = [() => undefined];
declared();
let assigned;
[assigned] = [() => undefined];
assigned();
const { fns: [nested] } = { fns: [() => undefined] };
nested();
const [defaulted = () => undefined] = [];
defaulted();
const [, ...rest] = [() => undefined, () => undefined];
rest[0]();
const [discardedEffect, ...localRest] = [
  Deno.writeTextFile,
  () => undefined,
];
localRest[0]();
const knownLocalArraySource = [Deno.writeTextFile, () => undefined];
const [, ...knownLocalArrayRest] = knownLocalArraySource;
knownLocalArrayRest[0]();
const [localPrefixBeforeSpread] = [
  () => undefined,
  ...[Deno.writeTextFile],
];
localPrefixBeforeSpread();
const possibleEffectTail = maybe ? [] : [Deno.writeTextFile];
const [localPrefixBeforeUnknownSpread] = [
  () => undefined,
  ...possibleEffectTail,
];
localPrefixBeforeUnknownSpread();
class LocalArrayClass {}
const [LocalArrayAlias] = [LocalArrayClass];
LocalArrayAlias.write = () => undefined;
LocalArrayClass.write();
class BeforeRestClass {}
const [BeforeRestAlias, ...localClasses] = [BeforeRestClass, {}];
const LocalClassAlias = localClasses[0];
LocalClassAlias.write = Deno.writeTextFile;
BeforeRestClass.write("before-rest-class.txt", "x");
`,
        "src/local-array-destructuring.test.ts",
      ),
      [],
    );
  });

  it("keeps post-spread array positions conservative until length is proven", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const dynamic = [() => undefined];
dynamic[Math.random()] = Deno.writeTextFile;
const [, possibleDynamicWrite] = [...dynamic, () => undefined];
possibleDynamicWrite("possible-dynamic-write.txt", "x");

const [, knownLocal, knownWrite] = [
  ...[() => undefined, () => undefined],
  Deno.writeTextFile,
];
knownLocal();
knownWrite("known-write.txt", "x");
`,
        "src/post-spread-array-positions.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "possibleDynamicWrite"],
        ["filesystem-write", "knownWrite"],
      ],
    );
  });

  it("widens exact arrays after call-based mutations", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const pushed = [() => undefined];
pushed.push(Deno.writeTextFile);
const [, pushedWrite] = [...pushed, () => undefined];
pushedWrite("pushed.txt", "x");

const assigned = [() => undefined];
Object.assign(assigned, { 1: Deno.writeTextFile });
const [, assignedWrite] = [...assigned, () => undefined];
assignedWrite("assigned.txt", "x");

const defined = [() => undefined];
Object.defineProperty(defined, "1", { value: Deno.writeTextFile });
const [, definedWrite] = [...defined, () => undefined];
definedWrite("defined.txt", "x");

const reflected = [() => undefined];
Reflect.set(reflected, "1", Deno.writeTextFile);
const [, reflectedWrite] = [...reflected, () => undefined];
reflectedWrite("reflected.txt", "x");

const numericReflected = [() => undefined, () => undefined];
Reflect.set(numericReflected, 1, Deno.writeTextFile);
const [numericReflectedLocal, numericReflectedWrite] = numericReflected;
numericReflectedLocal();
numericReflectedWrite("numeric-reflected.txt", "x");

const aliasedTarget = [() => undefined];
const targetAlias = aliasedTarget;
targetAlias.unshift(Deno.writeTextFile);
const [aliasedWrite] = [...aliasedTarget, () => undefined];
aliasedWrite("aliased.txt", "x");

const nested = { values: [() => undefined] };
nested.values.splice(1, 0, Deno.writeTextFile);
const [, nestedWrite] = [...nested.values, () => undefined];
nestedWrite("nested.txt", "x");

const reordered = [() => undefined, Deno.writeTextFile];
reordered.reverse();
const [reorderedWrite] = [...reordered, () => undefined];
reorderedWrite("reordered.txt", "x");

const directReordered = [() => undefined, Deno.writeTextFile];
directReordered.reverse();
const [directReorderedWrite] = directReordered;
directReorderedWrite("direct-reordered.txt", "x");

const copiedWithin = [() => undefined, Deno.writeTextFile];
copiedWithin.copyWithin(0, 1, 2);
const [copiedWithinWrite] = copiedWithin;
copiedWithinWrite("copied-within.txt", "x");

const copiedFromDefaultStart = [Deno.writeTextFile, () => undefined];
copiedFromDefaultStart.copyWithin(1);
copiedFromDefaultStart[1]("copied-default-start.txt", "x");

const shifted = [() => undefined, Deno.writeTextFile];
shifted.shift();
const [shiftedWrite] = shifted;
shiftedWrite("shifted.txt", "x");

const sorted = [() => undefined, Deno.writeTextFile];
sorted.sort();
const [sortedWrite] = sorted;
sortedWrite("sorted.txt", "x");

const spliced = [() => undefined, Deno.writeTextFile];
spliced.splice(0, 1);
const [splicedWrite] = spliced;
splicedWrite("spliced.txt", "x");

const unshifted = [Deno.writeTextFile, () => undefined];
unshifted.unshift(() => undefined);
const [, unshiftedWrite] = unshifted;
unshiftedWrite("unshifted.txt", "x");

const prototypeReordered = [() => undefined, Deno.writeTextFile];
Array.prototype.reverse.call(prototypeReordered);
const [prototypeReorderedWrite] = prototypeReordered;
prototypeReorderedWrite("prototype-reordered.txt", "x");

const reflectedReorder = [() => undefined, Deno.writeTextFile];
Reflect.apply(Array.prototype.copyWithin, reflectedReorder, [0, 1, 2]);
const [reflectedReorderWrite] = reflectedReorder;
reflectedReorderWrite("reflected-reorder.txt", "x");

const boundReorder = [() => undefined, Deno.writeTextFile];
const boundShift = Array.prototype.shift.bind(boundReorder);
boundShift();
const [boundReorderWrite] = boundReorder;
boundReorderWrite("bound-reorder.txt", "x");

const filled = [() => undefined];
filled.fill(Deno.writeTextFile, 0, 1);
const [filledWrite] = [...filled];
filledWrite("filled.txt", "x");

const definedMany = [() => undefined];
Object.defineProperties(definedMany, {
  1: { value: Deno.writeTextFile },
});
const [, definedManyWrite] = [...definedMany, () => undefined];
definedManyWrite("defined-many.txt", "x");

const definedNamedProperties = { safe: () => undefined };
Object.defineProperties(definedNamedProperties, {
  safe: { value: () => undefined },
  write: { value: Deno.writeTextFile },
});
definedNamedProperties.safe();
definedNamedProperties.write("defined-named-properties.txt", "x");

const definedNamedAccessors = { safe: () => undefined };
Object.defineProperties(definedNamedAccessors, {
  safe: { get: () => () => undefined },
  write: { get: () => Deno.writeTextFile },
});
definedNamedAccessors.safe();
definedNamedAccessors.write("defined-named-accessors.txt", "x");

const computedDefinedProperties = { safe: () => undefined };
declare const computedDescriptorName: string;
Object.defineProperties(computedDefinedProperties, {
  [computedDescriptorName]: { value: Deno.writeTextFile },
});
computedDefinedProperties.safe("computed-defined-properties.txt", "x");

const reflectDefined = [() => undefined];
Reflect.defineProperty(reflectDefined, "1", {
  value: Deno.writeTextFile,
});
const [, reflectDefinedWrite] = [...reflectDefined, () => undefined];
reflectDefinedWrite("reflect-defined.txt", "x");

const prototypeCall = [() => undefined];
Array.prototype.push.call(prototypeCall, Deno.writeTextFile);
const [, prototypeCallWrite] = [...prototypeCall, () => undefined];
prototypeCallWrite("prototype-call.txt", "x");

const prototypeApply = [() => undefined];
Array.prototype.push.apply(prototypeApply, [Deno.writeTextFile]);
const [, prototypeApplyWrite] = [...prototypeApply, () => undefined];
prototypeApplyWrite("prototype-apply.txt", "x");

const reflectApply = [() => undefined];
Reflect.apply(Array.prototype.push, reflectApply, [Deno.writeTextFile]);
const [, reflectApplyWrite] = [...reflectApply, () => undefined];
reflectApplyWrite("reflect-apply.txt", "x");

const aliasedCall = [() => undefined];
const push = aliasedCall.push;
push.call(aliasedCall, Deno.writeTextFile);
const [, aliasedCallWrite] = [...aliasedCall, () => undefined];
aliasedCallWrite("aliased-call.txt", "x");

const dynamicCall = [() => undefined];
const method = "push";
dynamicCall[method](Deno.writeTextFile);
const [, dynamicCallWrite] = [...dynamicCall, () => undefined];
dynamicCallWrite("dynamic-call.txt", "x");

const getterDefined = [() => undefined];
Object.defineProperty(getterDefined, "1", {
  get: () => Deno.writeTextFile,
});
const [, getterDefinedWrite] = [...getterDefined, () => undefined];
getterDefinedWrite("getter-defined.txt", "x");

const getterDefinedMany = [() => undefined];
Object.defineProperties(getterDefinedMany, {
  1: { get: () => Deno.writeTextFile },
});
const [, getterDefinedManyWrite] = [
  ...getterDefinedMany,
  () => undefined,
];
getterDefinedManyWrite("getter-defined-many.txt", "x");

const prototypeObject = [() => undefined];
Object.setPrototypeOf(prototypeObject, { 1: Deno.writeTextFile });
const [, prototypeObjectWrite] = [...prototypeObject, () => undefined];
prototypeObjectWrite("prototype-object.txt", "x");

const prototypeReflect = [() => undefined];
Reflect.setPrototypeOf(prototypeReflect, { 1: Deno.writeTextFile });
const [, prototypeReflectWrite] = [...prototypeReflect, () => undefined];
prototypeReflectWrite("prototype-reflect.txt", "x");

const assignedGetter = [() => undefined];
Object.assign(assignedGetter, {
  get 1() {
    return Deno.writeTextFile;
  },
});
const [, assignedGetterWrite] = [...assignedGetter, () => undefined];
assignedGetterWrite("assigned-getter.txt", "x");

const assignedDynamicGetter = [() => undefined];
const assignedDynamicKey = "1";
Object.assign(assignedDynamicGetter, {
  get [assignedDynamicKey]() {
    return Deno.writeTextFile;
  },
});
const [, assignedDynamicGetterWrite] = [
  ...assignedDynamicGetter,
  () => undefined,
];
assignedDynamicGetterWrite("assigned-dynamic-getter.txt", "x");

const boundTarget = [() => undefined];
const boundPush = Array.prototype.push.bind(boundTarget);
boundPush(Deno.writeTextFile);
const [, boundWrite] = [...boundTarget, () => undefined];
boundWrite("bound.txt", "x");

const applyValues = [Deno.writeTextFile];
const variableApply = [() => undefined];
Array.prototype.push.apply(variableApply, applyValues);
const [, variableApplyWrite] = [...variableApply, () => undefined];
variableApplyWrite("variable-apply.txt", "x");

const reflectVariableApply = [() => undefined];
Reflect.apply(Array.prototype.push, reflectVariableApply, applyValues);
const [, reflectVariableApplyWrite] = [
  ...reflectVariableApply,
  () => undefined,
];
reflectVariableApplyWrite("reflect-variable-apply.txt", "x");

const popArgument = [Deno.writeTextFile];
popArgument.pop(popArgument[0]("pop-argument.txt", "x"));
`,
        "src/runtime-call-mutated-array-spreads.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "pushedWrite"],
        ["filesystem-write", "assignedWrite"],
        ["filesystem-write", "definedWrite"],
        ["filesystem-write", "reflectedWrite"],
        ["filesystem-write", "numericReflectedWrite"],
        ["filesystem-write", "aliasedWrite"],
        ["filesystem-write", "nestedWrite"],
        ["filesystem-write", "reorderedWrite"],
        ["filesystem-write", "directReorderedWrite"],
        ["filesystem-write", "copiedWithinWrite"],
        ["filesystem-write", "copiedFromDefaultStart.1"],
        ["filesystem-write", "shiftedWrite"],
        ["filesystem-write", "sortedWrite"],
        ["filesystem-write", "splicedWrite"],
        ["filesystem-write", "unshiftedWrite"],
        ["filesystem-write", "prototypeReorderedWrite"],
        ["filesystem-write", "reflectedReorderWrite"],
        ["filesystem-write", "boundReorderWrite"],
        ["filesystem-write", "filledWrite"],
        ["filesystem-write", "definedManyWrite"],
        ["filesystem-write", "definedNamedProperties.write"],
        ["filesystem-write", "definedNamedAccessors.write"],
        ["filesystem-write", "computedDefinedProperties.safe"],
        ["filesystem-write", "reflectDefinedWrite"],
        ["filesystem-write", "prototypeCallWrite"],
        ["filesystem-write", "prototypeApplyWrite"],
        ["filesystem-write", "reflectApplyWrite"],
        ["filesystem-write", "aliasedCallWrite"],
        ["filesystem-write", "dynamicCallWrite"],
        ["filesystem-write", "getterDefinedWrite"],
        ["filesystem-write", "getterDefinedManyWrite"],
        ["filesystem-write", "prototypeObjectWrite"],
        ["filesystem-write", "prototypeReflectWrite"],
        ["filesystem-write", "assignedGetterWrite"],
        ["filesystem-write", "assignedDynamicGetterWrite"],
        ["filesystem-write", "boundWrite"],
        ["filesystem-write", "variableApplyWrite"],
        ["filesystem-write", "reflectVariableApplyWrite"],
        ["filesystem-write", "popArgument.0"],
      ],
    );
    const repeatedReorders = "values.sort();\n".repeat(1_000);
    assertEquals(
      collectSemanticMarkers(
        `
const values = [() => undefined, Deno.writeTextFile];
${repeatedReorders}
values[0]("repeated-reorders.txt", "x");
`,
        "src/repeated-array-reorders.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["filesystem-write", "values.0"]],
    );
    assertEquals(
      collectSemanticMarkers(
        `
const stable = [Deno.writeTextFile];
stable.slice();
const [, stableLocal] = [...stable, () => undefined];
stableLocal();

const fake = { push(_value: unknown) {} };
fake.push(Deno.writeTextFile);

const emptyPrototype = [() => undefined];
Object.setPrototypeOf(emptyPrototype, {});
const [, emptyPrototypeLocal] = [...emptyPrototype, () => undefined];
emptyPrototypeLocal();

const nullPrototype = [() => undefined];
Object.setPrototypeOf(nullPrototype, null);
const [, nullPrototypeLocal] = [...nullPrototype, () => undefined];
nullPrototypeLocal();

function shadow(Array: { prototype: { push: { call(...args: unknown[]): void } } }) {
  const values = [() => undefined];
  Array.prototype.push.call(values, Deno.writeTextFile);
  const [, run] = [...values, () => undefined];
  run("shadowed.txt", "x");
}

const overridden = [() => undefined];
overridden.push = () => undefined;
overridden.push(Deno.writeTextFile);
const [, overriddenRun] = [...overridden, () => undefined];
overriddenRun("overridden.txt", "x");

const reversed = [() => undefined];
reversed.reverse(Deno.writeTextFile);
const [reversedRun] = [...reversed];
reversedRun();

const copied = [() => undefined];
copied.copyWithin(Deno.writeTextFile, 0);
const [copiedRun] = [...copied];
copiedRun();

const popped = [() => undefined, Deno.writeTextFile];
popped.pop();
const [poppedRun] = popped;
poppedRun();

const shifted = [Deno.writeTextFile, () => undefined];
shifted.shift();
const [shiftedRun] = shifted;
shiftedRun();

const definedNamed = { run: () => undefined };
Object.defineProperty(definedNamed, "write", {
  value: Deno.writeTextFile,
});
definedNamed.run();

const reflectedNamed = { run: () => undefined };
Reflect.set(reflectedNamed, "write", Deno.writeTextFile);
reflectedNamed.run();

const definedBulkNamed = { safe: () => undefined };
Object.defineProperties(definedBulkNamed, {
  safe: { value: () => undefined },
  write: { value: Deno.writeTextFile },
});
definedBulkNamed.safe();
`,
        "src/local-non-mutating-array-calls.test.ts",
      ),
      [],
    );
    assertEquals(
      collectSemanticMarkers(
        `
declare const descriptor: PropertyDescriptor;
const unknownAccessor = [() => undefined];
Object.defineProperty(unknownAccessor, "1", descriptor);
const [, unknownAccessorCall] = [
  ...unknownAccessor,
  () => undefined,
];
unknownAccessorCall();
`,
        "src/runtime-unknown-array-accessor.test.ts",
      ).map((marker) => marker.effect),
      [
        "browser",
        "filesystem-read",
        "filesystem-watch",
        "filesystem-write",
        "network",
        "process",
        "server",
        "shared-cwd",
        "browser",
        "filesystem-read",
        "filesystem-watch",
        "filesystem-write",
        "network",
        "process",
        "server",
        "shared-cwd",
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
declare const prototype: object;
const unknownPrototype = [() => undefined];
Object.setPrototypeOf(unknownPrototype, prototype);
const [, unknownPrototypeCall] = [
  ...unknownPrototype,
  () => undefined,
];
unknownPrototypeCall();
`,
        "src/runtime-unknown-array-prototype.test.ts",
      ).map((marker) => marker.effect),
      [
        "browser",
        "filesystem-read",
        "filesystem-watch",
        "filesystem-write",
        "network",
        "process",
        "server",
        "shared-cwd",
      ],
    );
  });

  it("preserves mutation API return-value provenance", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const poppedValues = [Deno.remove];
const popped = poppedValues.pop();
popped("popped.txt");

const shiftedValues = [Deno.remove];
const shifted = shiftedValues.shift();
shifted("shifted.txt");

const splicedValues = [Deno.remove];
const [spliced] = splicedValues.splice(0, 1);
spliced("spliced.txt");

const reversedValues = [Deno.remove];
const reversed = reversedValues.reverse();
reversed[0]("reversed.txt");

const sortedValues = [Deno.remove];
const sorted = sortedValues.sort();
sorted[0]("sorted.txt");

const filledValues = [() => undefined];
const filled = filledValues.fill(Deno.remove);
filled[0]("filled.txt");

const copiedValues = [Deno.remove];
const copied = copiedValues.copyWithin(0, 0, 1);
copied[0]("copied.txt");

const sortedWithEffect = [2, 1];
sortedWithEffect.sort(Deno.remove);

const assigned = Object.assign({}, { run: Deno.remove });
assigned.run("assigned.txt");

const assignedNamedReturn = Object.assign(
  { safe: () => undefined },
  { write: Deno.remove },
);
assignedNamedReturn.safe();

const assignedNamedTarget = { safe: () => undefined };
Object.assign(assignedNamedTarget, { write: Deno.remove });
assignedNamedTarget.safe();

const prototypeReturn = Object.setPrototypeOf({}, { run: Deno.remove });
prototypeReturn.run("prototype.txt");

const defined = Object.defineProperty({}, "run", { value: Deno.remove });
defined.run("defined.txt");

const definedGetter = Object.defineProperty({}, "run", {
  get: () => Deno.remove,
});
definedGetter.run("defined-getter.txt");

const definedSetter = Object.defineProperty({}, "path", {
  set: Deno.remove,
});
definedSetter.path = "defined-setter.txt";

const frozen = Object.freeze({ run: Deno.remove });
frozen.run("frozen.txt");

const sealed = Object.seal({ run: Deno.remove });
sealed.run("sealed.txt");

const prevented = Object.preventExtensions({ run: Deno.remove });
prevented.run("prevented.txt");

const localPoppedValues = [Deno.remove, () => undefined];
const localPopped = localPoppedValues.pop();
localPopped();

const localShiftedValues = [() => undefined, Deno.remove];
const localShifted = localShiftedValues.shift();
localShifted();

const definedNamedReturn = Object.defineProperty(
  { safe: () => undefined },
  "write",
  { value: Deno.remove },
);
definedNamedReturn.safe();

const definedManyNamedReturn = Object.defineProperties(
  { safe: () => undefined },
  {
    safe: { value: () => undefined },
    write: { value: Deno.remove },
  },
);
definedManyNamedReturn.safe();
`,
        "src/runtime-mutation-return-values.test.ts",
      ).map((marker) => marker.effect),
      Array.from({ length: 16 }, () => "filesystem-write"),
    );
  });

  it("fails closed for unknown Object.assign sources without retaining overwritten values", () => {
    assertEquals(
      collectSemanticMarkers(
        `
declare const source: Record<string, unknown>;

const target = { safe: () => undefined };
Object.assign(target, source);
target.safe();

const returned = Object.assign({ safe: () => undefined }, source);
returned.safe();

const spreadReturned = Object.assign(
  { safe: () => undefined },
  { ...source },
);
spreadReturned.safe();

function assignDefaultedSource(defaultedSource = {}) {
  const defaultedTarget = { safe: () => undefined };
  Object.assign(defaultedTarget, defaultedSource);
  defaultedTarget.safe();
}
assignDefaultedSource();

const overwrittenReturn = Object.assign(
  { write: Deno.remove },
  { write: () => undefined },
);
overwrittenReturn.write("local-return.txt");

const overwrittenTarget = { write: Deno.remove };
Object.assign(overwrittenTarget, { write: () => undefined });
overwrittenTarget.write("local-target.txt");

const knownSafeTarget = { safe: () => undefined };
Object.assign(knownSafeTarget, { ...{ safe: () => undefined } });
knownSafeTarget.safe();

declare const maybe: boolean;
const conditionalTarget = { write: Deno.remove };
if (maybe) Object.assign(conditionalTarget, { write: () => undefined });
conditionalTarget.write("conditional.txt");
`,
        "src/runtime-object-assign-unknown-source.test.ts",
      ).map((marker) => marker.effect),
      Array.from(
        { length: 4 },
        () => [
          "browser",
          "filesystem-read",
          "filesystem-watch",
          "filesystem-write",
          "network",
          "process",
          "server",
          "shared-cwd",
        ],
      ).flat().concat("filesystem-write"),
    );
  });

  it("fails closed when only part of a copied source resolves", () => {
    const expectedEffects = [
      "browser",
      "filesystem-read",
      "filesystem-watch",
      "filesystem-write",
      "network",
      "process",
      "server",
      "shared-cwd",
    ];
    const cases = [
      {
        name: "direct",
        source: `
declare const maybe: boolean;
declare function loadSource(): object;
const source = maybe ? { run: Deno.cwd } : loadSource();
Object.assign({}, source).run();
`,
      },
      {
        name: "property",
        source: `
declare const maybe: boolean;
declare function loadSource(): object;
const box = { source: maybe ? { run: Deno.cwd } : loadSource() };
Object.assign({}, box.source).run();
`,
      },
      {
        name: "nested",
        source: `
declare const maybe: boolean;
declare const other: boolean;
declare function loadSource(): object;
const nested = maybe
  ? (other ? { run: Deno.cwd } : loadSource())
  : { run: Deno.cwd };
Object.assign({}, nested).run();
`,
      },
      {
        name: "descriptor-getter",
        source: `
declare const maybe: boolean;
declare function loadSource(): object;
const source = maybe ? { run: Deno.cwd } : loadSource();
const getterBox = {};
Object.defineProperty(getterBox, "source", { get: () => source });
Object.assign({}, getterBox.source).run();
`,
      },
      {
        name: "returned-descriptor-getter",
        source: `
declare const maybe: boolean;
declare function loadSource(): object;
const source = maybe ? { run: Deno.cwd } : loadSource();
const returnedGetterBox = Object.defineProperty({}, "source", {
  get: () => source,
});
Object.assign({}, returnedGetterBox.source).run();
`,
      },
      {
        name: "literal-getter",
        source: `
declare const maybe: boolean;
declare function loadSource(): object;
const source = maybe ? { run: Deno.cwd } : loadSource();
const literalGetterBox = {
  get source() {
    return source;
  },
};
Object.assign({}, literalGetterBox.source).run();
`,
      },
      {
        name: "copied-attributed-property",
        source: `
declare const maybe: boolean;
declare function loadSource(): object;
const source = maybe ? { run: Deno.cwd } : loadSource();
const attributedBox = { source };
Object.defineProperty(attributedBox, "source", { enumerable: true });
const copiedBox = Object.assign({}, attributedBox);
Object.assign({}, copiedBox.source).run();
`,
      },
      {
        name: "copied-property",
        source: `
declare const maybe: boolean;
declare function loadSource(): object;
const source = maybe ? { run: Deno.cwd } : loadSource();
const copiedBox = Object.assign({}, { source });
Object.assign({}, copiedBox.source).run();
`,
      },
      {
        name: "copied-descriptor-getter",
        source: `
declare const maybe: boolean;
declare function loadSource(): object;
const source = maybe ? { run: Deno.cwd } : loadSource();
const getterBox = {};
Object.defineProperty(getterBox, "source", {
  enumerable: true,
  get: () => source,
});
const copiedBox = Object.assign({}, getterBox);
Object.assign({}, copiedBox.source).run();
`,
      },
      {
        name: "object-spread",
        source: `
declare const maybe: boolean;
declare function loadSource(): object;
const source = maybe ? { run: Deno.cwd } : loadSource();
({ ...source }).run();
`,
      },
    ] as const;
    for (const testCase of cases) {
      assertEquals(
        [
          ...new Set(
            collectSemanticMarkers(
              testCase.source,
              `src/runtime-object-assign-partial-source-${testCase.name}.test.ts`,
            ).map((marker) => marker.effect),
          ),
        ].sort(),
        expectedEffects,
        testCase.name,
      );
    }
  });

  it("preserves every possible sort comparator effect", () => {
    assertEquals(
      collectSemanticMarkers(
        `
declare const maybe: boolean;
const conditionalComparator = maybe ? Deno.remove : fetch;
const conditionalValues = [2, 1];
conditionalValues.sort(conditionalComparator);

const comparators = { remove: Deno.remove, request: fetch };
declare const comparatorName: string;
const computedValues = [2, 1];
computedValues.sort(comparators[comparatorName]);

const localValues = [2, 1];
localValues.sort(() => 0);
`,
        "src/runtime-sort-comparator-effects.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "conditionalValues.sort(comparator)"],
        ["network", "conditionalValues.sort(comparator)"],
        ["filesystem-write", "computedValues.sort(comparator)"],
        ["network", "computedValues.sort(comparator)"],
      ],
    );
  });

  it("preserves partial bindings through object destructuring", () => {
    const cases = [
      {
        name: "declaration",
        source: `
declare const maybe: boolean;
declare function loadSource(): object;
const source = maybe ? { run: () => undefined } : loadSource();
const { run: declaredRun } = source;
declaredRun();
`,
      },
      {
        name: "assignment",
        source: `
declare const maybe: boolean;
declare function loadSource(): object;
const source = maybe ? { run: () => undefined } : loadSource();
let assignedRun;
({ run: assignedRun } = source);
assignedRun();
`,
      },
    ] as const;
    for (const testCase of cases) {
      const effects = collectSemanticMarkers(
        testCase.source,
        `src/runtime-partial-object-destructuring-${testCase.name}.test.ts`,
      ).map((marker) => marker.effect);
      assertEquals(effects, [
        "browser",
        "filesystem-read",
        "filesystem-watch",
        "filesystem-write",
        "network",
        "process",
        "server",
        "shared-cwd",
      ]);
    }
  });

  it("preserves partial bindings through computed object destructuring", () => {
    const effects = collectSemanticMarkers(
      `
declare const maybe: boolean;
declare const key: string;
declare function loadSource(): object;
const source = maybe ? { choice: () => undefined } : loadSource();
const { [key]: picked } = source;
picked();
`,
      "src/runtime-partial-computed-object-destructuring.test.ts",
    ).map((marker) => marker.effect);
    assertEquals(effects, [
      "browser",
      "filesystem-read",
      "filesystem-watch",
      "filesystem-write",
      "network",
      "process",
      "server",
      "shared-cwd",
    ]);
  });

  it("preserves partial bindings through array rest destructuring", () => {
    const effects = collectSemanticMarkers(
      `
declare const maybe: boolean;
declare function loadSource(): object;
const source = maybe ? [{ run: Deno.cwd }] : loadSource();
const [...rest] = source;
Object.assign({}, rest[0]).run();
`,
      "src/runtime-partial-array-rest-destructuring.test.ts",
    ).map((marker) => marker.effect);
    assertEquals(effects, [
      "shared-cwd",
      "browser",
      "filesystem-read",
      "filesystem-watch",
      "filesystem-write",
      "network",
      "process",
      "server",
      "shared-cwd",
    ]);
  });

  it("preserves partial bindings through destructuring defaults", () => {
    const effects = collectSemanticMarkers(
      `
declare const maybe: boolean;
declare function loadSource(): object;
const source = maybe ? { nested: { run: Deno.cwd } } : loadSource();
let nested;
({ nested = { run: Deno.cwd } } = source);
Object.assign({}, nested).run();
`,
      "src/runtime-partial-defaulted-object-destructuring.test.ts",
    ).map((marker) => marker.effect);
    assertEquals(effects.includes("shared-cwd"), true);
    assertEquals(effects.includes("filesystem-write"), true);
  });

  it("keeps statically named Object.assign overwrites precise", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const target = { safe: () => undefined };
Object.assign(target, { write: Deno.remove });
target.safe();

const overwrittenTarget = { run: Deno.remove };
Object.assign(overwrittenTarget, { run: () => undefined });
overwrittenTarget.run();

const result = Object.assign(
  {},
  { run: Deno.remove },
  { run: () => undefined },
);
result.run();
`,
        "src/runtime-object-assign-overwrites.test.ts",
      ),
      [],
    );

    assertEquals(
      collectSemanticMarkers(
        `
const target = { safe: () => undefined };
Object.assign(target, { write: Deno.remove });
target.write("target.txt");
`,
        "src/runtime-object-assign-named-write.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["filesystem-write", "target.write"]],
    );
  });

  it("retains data properties when Reflect mutations may fail", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const setTarget = {};
Object.defineProperty(setTarget, "run", { value: Deno.remove });
Reflect.set(setTarget, "run", () => undefined);
setTarget.run("set.txt");

const deleteTarget = {};
Object.defineProperty(deleteTarget, "run", { value: Deno.remove });
Reflect.deleteProperty(deleteTarget, "run");
deleteTarget.run("delete.txt");

const defineTarget = {};
Object.defineProperty(defineTarget, "run", { value: Deno.remove });
Reflect.defineProperty(defineTarget, "run", { value: () => undefined });
defineTarget.run("define.txt");

const assignTarget = {};
Object.defineProperty(assignTarget, "run", { value: Deno.remove });
try {
  Object.assign(assignTarget, { run: () => undefined });
} catch {}
assignTarget.run("assign.txt");

const caughtDefineTarget = {};
Object.defineProperty(caughtDefineTarget, "run", { value: Deno.remove });
try {
  Object.defineProperty(caughtDefineTarget, "run", {
    value: () => undefined,
  });
} catch {}
caughtDefineTarget.run("caught-define.txt");

const caughtDefineManyTarget = {};
Object.defineProperty(caughtDefineManyTarget, "run", { value: Deno.remove });
try {
  Object.defineProperties(caughtDefineManyTarget, {
    run: { value: () => undefined },
  });
} catch {}
caughtDefineManyTarget.run("caught-define-many.txt");
`,
        "src/runtime-reflect-failed-mutations.test.ts",
      ).map((marker) => marker.effect),
      Array.from({ length: 6 }, () => "filesystem-write"),
    );
  });

  it("writes explicit Reflect.set receivers without mutating the target", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const target = { run: () => undefined };
const receiver = {};
Reflect.set(target, "run", Deno.remove, receiver);
target.run();
receiver.run("receiver.txt");
`,
        "src/runtime-reflect-set-receiver.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["filesystem-write", "receiver.run"]],
    );
  });

  it("stops Object.defineProperties after the first failed descriptor", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const target = { run: Deno.remove };
Object.defineProperty(target, "locked", { value: 1 });
try {
  Object.defineProperties(target, {
    locked: { configurable: true },
    run: { value: () => undefined },
  });
} catch {}
target.run("retained.txt");
`,
        "src/runtime-define-properties-short-circuit.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["filesystem-write", "target.run"]],
    );
  });

  it("preserves every callable comparator and setter effect", () => {
    assertEquals(
      collectSemanticMarkers(
        `
declare const maybe: boolean;
const values = [2, 1];
values.sort(maybe ? Deno.remove : fetch);
values.sort(Deno.open);

const conditionalSetter = Object.defineProperty({}, "path", {
  set: maybe ? Deno.remove : fetch,
});
conditionalSetter.path = "conditional.txt";

declare const unknownDescriptor: PropertyDescriptor;
const unknownSetter = Object.defineProperty({}, "path", unknownDescriptor);
unknownSetter.path = "unknown.txt";

const openSetter = Object.defineProperty({}, "path", {
  set: Deno.open.bind(Deno, "setter.txt", { write: true, create: true }),
});
openSetter.path = "ignored";

const openComparatorValues = [2, 1];
openComparatorValues.sort(
  Deno.open.bind(Deno, "sort.txt", { write: true, create: true }),
);
`,
        "src/runtime-multi-effect-callables.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "values.sort(comparator)"],
        ["network", "values.sort(comparator)"],
        ["filesystem-read", "values.sort(comparator)"],
        ["filesystem-write", "conditionalSetter.path setter"],
        ["network", "conditionalSetter.path setter"],
        ["browser", "unknownSetter.path setter"],
        ["filesystem-read", "unknownSetter.path setter"],
        ["filesystem-watch", "unknownSetter.path setter"],
        ["filesystem-write", "unknownSetter.path setter"],
        ["network", "unknownSetter.path setter"],
        ["process", "unknownSetter.path setter"],
        ["server", "unknownSetter.path setter"],
        ["shared-cwd", "unknownSetter.path setter"],
        ["filesystem-write", "openSetter.path setter"],
        ["filesystem-write", "openComparatorValues.sort(comparator)"],
      ],
    );
  });

  it("preserves receiver and prototype provenance through returned Object APIs", () => {
    assertEquals(
      collectSemanticMarkers(
        `
Object.freeze({ run: Deno.remove }).run("freeze.txt");
Object.seal({ run: Deno.remove }).run("seal.txt");
Object.preventExtensions({ run: Deno.remove }).run("prevent-extensions.txt");
Object.setPrototypeOf({}, { run: Deno.remove }).run("prototype.txt");
Object.setPrototypeOf(
  { safe: () => undefined },
  { run: Deno.remove },
).safe();
Object.setPrototypeOf(
  { run: () => undefined },
  { run: Deno.remove },
).run();
const prototypeTarget = { run: () => undefined };
Object.setPrototypeOf(prototypeTarget, { run: Deno.remove });
prototypeTarget.run();

const target = { safe: () => undefined };
Object.setPrototypeOf(target, { run: Deno.remove });
target.safe();
target.run("target-prototype.txt");

const deleted = { run: () => undefined };
Object.setPrototypeOf(deleted, { run: Deno.remove });
delete deleted.run;
deleted.run("deleted-prototype.txt");

const reflectedDelete = { run: () => undefined };
Object.setPrototypeOf(reflectedDelete, { run: Deno.remove });
Reflect.deleteProperty(reflectedDelete, "run");
reflectedDelete.run("reflected-delete-prototype.txt");

const replacedPrototype = {};
Object.setPrototypeOf(replacedPrototype, { run: Deno.remove });
Object.setPrototypeOf(replacedPrototype, null);
replacedPrototype.run();

const retainedPrototype = {};
Object.setPrototypeOf(retainedPrototype, { run: Deno.remove });
Object.preventExtensions(retainedPrototype);
try {
  Object.setPrototypeOf(retainedPrototype, null);
} catch {}
retainedPrototype.run("retained-prototype.txt");
`,
        "src/runtime-object-receiver-returns.test.ts",
      ).map((marker) => marker.effect),
      Array.from({ length: 8 }, () => "filesystem-write"),
    );
  });

  it("keeps frozen and sealed property provenance after failed mutations", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const frozen = Object.freeze({ run: Deno.remove });
Reflect.set(frozen, "run", () => undefined);
Reflect.deleteProperty(frozen, "run");
Reflect.defineProperty(frozen, "run", { value: () => undefined });
frozen.run("frozen.txt");

const sealed = Object.seal({ run: Deno.remove });
Reflect.deleteProperty(sealed, "run");
try {
  Object.defineProperty(sealed, "run", { value: () => undefined });
} catch {}
sealed.run("sealed.txt");

const frozenRedefined = Object.freeze({ run: Deno.remove });
Reflect.defineProperty(frozenRedefined, "run", { value: () => undefined });
frozenRedefined.run("frozen-redefined.txt");

const sealedRedefined = Object.seal({ run: Deno.remove });
Reflect.defineProperty(sealedRedefined, "run", { value: () => undefined });
sealedRedefined.run("sealed-redefined.txt");

const sealedLocked = { run: Deno.remove };
Object.defineProperty(sealedLocked, "run", { writable: false });
Object.seal(sealedLocked);
Reflect.defineProperty(sealedLocked, "run", { value: () => undefined });
sealedLocked.run("sealed-locked.txt");

const prevented = Object.preventExtensions({ run: Deno.remove });
Reflect.defineProperty(prevented, "run", { value: () => undefined });
prevented.run("prevented.txt");
`,
        "src/runtime-property-integrity-levels.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "frozen.run"],
        ["filesystem-write", "sealed.run"],
        ["filesystem-write", "frozenRedefined.run"],
        ["filesystem-write", "sealedLocked.run"],
      ],
    );
  });

  it("retains exact array elements when removals may fail", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const frozenPopped = Object.freeze([Deno.remove]);
try {
  frozenPopped.pop();
} catch {}
frozenPopped[0]("frozen.txt");

const sealedShifted = Object.seal([Deno.remove]);
try {
  sealedShifted.shift();
} catch {}
sealedShifted[0]("sealed.txt");

const locked = [Deno.remove];
Object.defineProperty(locked, "0", { configurable: false });
try {
  locked.pop();
} catch {}
locked[0]("locked.txt");

const lockedShift = [Deno.remove, () => undefined];
Object.defineProperty(lockedShift, "0", { writable: false });
try {
  lockedShift.shift();
} catch {}
lockedShift[0]("locked-shift.txt");

const lockedLength = [Deno.remove];
Object.defineProperty(lockedLength, "length", { writable: false });
try {
  lockedLength.pop();
} catch {}
lockedLength[0]("locked-length.txt");
`,
        "src/runtime-failed-exact-array-removals.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "frozenPopped.0"],
        ["filesystem-write", "sealedShifted.0"],
        ["filesystem-write", "locked.0"],
        ["filesystem-write", "lockedShift.0"],
        ["filesystem-write", "lockedLength.0"],
      ],
    );
  });

  it("retains outer array elements across unevaluated function mutations", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const retained = [Deno.remove];
function unused() {
  retained.pop();
}
retained[0]("retained.txt");
`,
        "src/runtime-unevaluated-array-removal.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["filesystem-write", "retained.0"]],
    );
  });

  it("clears exact removals that succeed on non-extensible arrays", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const popped = Object.preventExtensions([Deno.remove]);
popped.pop();
popped[0]?.("popped.txt");

const shifted = Object.preventExtensions([() => undefined, Deno.remove]);
shifted.shift();
shifted[1]?.("shifted.txt");
`,
        "src/runtime-non-extensible-exact-array-removals.test.ts",
      ),
      [],
    );
  });

  it("keeps exact array removal and bulk descriptor return provenance", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const popped = [Deno.remove, () => undefined].pop();
popped();
const shifted = [() => undefined, Deno.remove].shift();
shifted();
const [spliced] = [() => undefined, Deno.remove].splice(0, 1);
spliced();
const [negativeSpliced] = [Deno.remove, () => undefined].splice(-1, 1);
negativeSpliced();
`,
        "src/runtime-exact-array-removal-results.test.ts",
      ),
      [],
    );

    assertEquals(
      collectSemanticMarkers(
        `
const defined = Object.defineProperties({}, {
  safe: { value: () => undefined },
  run: { value: Deno.remove },
  nested: { get: () => ({ run: Deno.remove }) },
  [1]: { value: Deno.remove },
  ["computed"]: { get: () => Deno.remove },
});
defined.safe();
defined.run("run.txt");
defined.nested.run("nested.txt");
defined[1]("numeric.txt");
defined.computed("computed.txt");
`,
        "src/runtime-bulk-descriptor-return-values.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "defined.run"],
        ["filesystem-write", "defined.nested.run"],
        ["filesystem-write", "defined.1"],
        ["filesystem-write", "defined.computed"],
      ],
    );
  });

  it("invokes descriptor setters on writes without exposing them to reads", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const direct = {};
Object.defineProperty(direct, "path", { set: Deno.remove });
direct.path = "direct.txt";
direct.path = "direct-again.txt";
direct.path++;

const definedMany = {};
Object.defineProperties(definedMany, {
  path: { set: Deno.writeTextFile },
});
Reflect.set(definedMany, "path", "many.txt");

const remove = Deno.remove;
const aliased = {};
Object.defineProperty(aliased, "path", { set: remove });
aliased.path = "aliased.txt";

const bound = {};
Object.defineProperty(bound, "path", { set: Deno.remove.bind(Deno) });
bound.path = "bound.txt";

const unread = {};
Object.defineProperty(unread, "path", { set: Deno.remove });
unread.path;

declare const unknownProperty: string;
declare const maybe: boolean;
const multiple = {};
Object.defineProperty(multiple, "path", { set: Deno.remove });
Object.defineProperty(multiple, "url", { set: fetch });
multiple[unknownProperty] = "unknown";
Reflect.set(multiple, unknownProperty, "unknown");

const conditional = {};
Object.defineProperty(conditional, "path", {
  set: maybe ? Deno.remove : fetch,
});
conditional.path = "conditional.txt";

const assigned = {};
Object.defineProperty(assigned, "path", { set: Deno.remove });
Object.assign(assigned, { path: "assigned.txt" });
assigned.path = "assigned-again.txt";
`,
        "src/runtime-descriptor-setters.test.ts",
      ).map((marker) => marker.effect),
      [
        "filesystem-write",
        "filesystem-write",
        "filesystem-write",
        "filesystem-write",
        "filesystem-write",
        "filesystem-write",
        "filesystem-write",
        "network",
        "filesystem-write",
        "network",
        "filesystem-write",
        "network",
        "filesystem-write",
        "filesystem-write",
      ],
    );
  });

  it("classifies filesystem-open setters with their assigned values", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const direct = {};
Object.defineProperty(direct, "options", {
  set: Deno.open.bind(Deno, "direct.txt"),
});
direct.options = { write: true, create: true };

const loop = {};
Object.defineProperty(loop, "options", {
  set: Deno.open.bind(Deno, "loop.txt"),
});
for (loop.options of [{ write: true, create: true }]) {}

const assigned = {};
Object.defineProperty(assigned, "options", {
  set: Deno.open.bind(Deno, "assigned.txt"),
});
Object.assign(assigned, { options: { write: true, create: true } });
`,
        "src/runtime-filesystem-open-setters.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "direct.options setter"],
        ["filesystem-write", "loop.options setter"],
        ["filesystem-write", "assigned.options setter"],
      ],
    );
  });

  it("invokes inherited descriptor setters without bypassing own properties", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const prototype = {};
Object.defineProperty(prototype, "path", { set: Deno.remove });

const direct = Object.setPrototypeOf({}, prototype);
direct.path = "direct.txt";

const assigned = Object.setPrototypeOf({}, prototype);
Object.assign(assigned, { path: "assigned.txt" });

const openPrototype = {};
Object.defineProperty(openPrototype, "options", {
  set: Deno.open.bind(Deno, "inherited.txt"),
});
const opened = Object.setPrototypeOf({}, openPrototype);
opened.options = { write: true, create: true };

const own = Object.setPrototypeOf(
  { path: "safe" },
  prototype,
);
own.path = "still-safe";
`,
        "src/runtime-inherited-setters.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "direct.path setter"],
        ["filesystem-write", "assigned.path setter"],
        ["filesystem-write", "opened.options setter"],
      ],
    );
  });

  it("preserves Object.create prototype provenance without inventing a null prototype", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const created = Object.create({ run: Deno.remove });
created.run("created.txt");
`,
        "src/runtime-object-create-property.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["filesystem-write", "created.run"]],
    );

    assertEquals(
      collectSemanticMarkers(
        `
const prototype = {};
Object.defineProperty(prototype, "path", { set: Deno.remove });
const created = Object.create(prototype);
created.path = "created.txt";
`,
        "src/runtime-object-create-setter.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["filesystem-write", "created.path setter"]],
    );

    assertEquals(
      collectSemanticMarkers(
        `
const nullPrototype = Object.create(null);
nullPrototype.run = () => undefined;
nullPrototype.run();

const ownDescriptor = Object.create(
  { run: () => undefined },
  { run: { value: Deno.remove } },
);
ownDescriptor.run("descriptor.txt");
`,
        "src/runtime-object-create-descriptors.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["filesystem-write", "ownDescriptor.run"]],
    );

    assertEquals(
      [
        ...new Set(
          collectSemanticMarkers(
            `
declare function loadPrototype(): object;
const created = Object.create(loadPrototype());
created.run();
`,
            "src/runtime-object-create-unknown-prototype.test.ts",
          ).map((marker) => marker.effect),
        ),
      ].sort(),
      [
        "browser",
        "filesystem-read",
        "filesystem-watch",
        "filesystem-write",
        "network",
        "process",
        "server",
        "shared-cwd",
      ],
    );
  });

  it("invokes descriptor setters through destructuring assignments", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const target = {};
Object.defineProperty(target, "write", { set: Deno.writeTextFile });
({ x: target.write } = { x: "object.txt" });
[target.write] = ["array.txt"];
({ x: target.write = "object-default.txt" } = { x: undefined });
[target.write = "array-default.txt"] = [undefined];
for (target.write of ["loop-of.txt"]) {}
for (target.write in { "loop-in.txt": true }) {}

const getterOnly = {};
Object.defineProperty(getterOnly, "write", {
  get: () => Deno.writeTextFile,
});
const { write: unusedGetter } = getterOnly;
void unusedGetter;
`,
        "src/runtime-descriptor-setter-destructuring.test.ts",
      ).map((marker) => marker.effect),
      [
        "filesystem-write",
        "filesystem-write",
        "filesystem-write",
        "filesystem-write",
        "filesystem-write",
        "filesystem-write",
      ],
    );
  });

  it("passes assigned values to bound filesystem-open setters", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const target = {};
Object.defineProperty(target, "options", {
  set: Deno.open.bind(Deno, "assigned.txt"),
});
target.options = { write: true, create: true };
for (target.options of [{ write: true, create: true }]) {}
`,
        "src/runtime-bound-open-setter-values.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "target.options setter"],
        ["filesystem-write", "target.options setter"],
      ],
    );
  });

  it("preserves setters after Object.assign invokes them", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const target = {};
Object.defineProperty(target, "path", { set: Deno.remove });
const returned = Object.assign(target, { path: "first.txt" });
returned.path = "second.txt";

const getterTarget = {};
Object.defineProperty(getterTarget, "path", { set: Deno.remove });
const getterSource = {};
Object.defineProperty(getterSource, "path", {
  enumerable: true,
  get: () => "first.txt",
});
const getterReturned = Object.assign(getterTarget, getterSource);
getterReturned.path = "second.txt";
`,
        "src/runtime-object-assign-setter-preservation.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "target.path setter"],
        ["filesystem-write", "returned.path setter"],
        ["filesystem-write", "runtime effect setter"],
        ["filesystem-write", "getterReturned.path setter"],
      ],
    );
  });

  it("preserves returned target properties skipped by Object.assign", () => {
    const markers = collectSemanticMarkers(
      `
const target = { run: Deno.remove };
const source = {};
Object.defineProperty(source, "run", { value: () => undefined });
Object.defineProperty(source, "observed", {
  enumerable: true,
  get: Deno.cwd,
});
Object.assign(target, source).run("retained.txt");
`,
      "src/runtime-object-assign-non-enumerable-return.test.ts",
    );
    assertEquals(
      markers.map((marker) => [marker.effect, marker.symbol]),
      [
        ["shared-cwd", "Deno.cwd"],
        ["filesystem-write", "run"],
        ["shared-cwd", "Object.assign(source getter)"],
      ],
    );
  });

  it("preserves descriptor attributes omitted by redefinition", () => {
    const effects = collectSemanticMarkers(
      `
const source = {};
Object.defineProperty(source, "run", {
  configurable: true,
  enumerable: true,
  value: () => undefined,
});
Object.defineProperty(source, "run", { value: Deno.remove });
Object.assign({}, source).run("copied.txt");
Reflect.defineProperty(source, "run", { value: () => undefined });
source.run("cleared.txt");
`,
      "src/runtime-descriptor-redefinition-attributes.test.ts",
    ).map((marker) => marker.effect);
    assertEquals(effects, ["filesystem-write"]);
  });

  it("clears accessors replaced by descriptor definitions", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const target = {};
Object.defineProperty(target, "path", {
  configurable: true,
  set: Deno.remove,
});
Object.defineProperty(target, "path", { set: () => undefined });
target.path = "safe.txt";

const retained = {};
Object.defineProperty(retained, "path", {
  configurable: true,
  set: Deno.remove,
});
Object.defineProperty(retained, "path", { enumerable: true });
retained.path = "retained.txt";
`,
        "src/runtime-descriptor-accessor-redefinition.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["filesystem-write", "retained.path setter"]],
    );
  });

  it("clears accessors only when direct deletion can succeed", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const retained = {};
Object.defineProperty(retained, "path", { set: Deno.remove });
delete retained.path;
retained.path = "retained.txt";

const retainedGetter = {};
Object.defineProperty(retainedGetter, "path", {
  get: () => Deno.remove,
});
delete retainedGetter.path;
retainedGetter.path("retained-getter.txt");

const cleared = {};
Object.defineProperty(cleared, "path", {
  configurable: true,
  set: Deno.remove,
});
delete cleared.path;
cleared.path = "cleared.txt";

const clearedGetter = {};
Object.defineProperty(clearedGetter, "path", {
  configurable: true,
  get: () => Deno.remove,
});
delete clearedGetter.path;
clearedGetter.path?.("cleared-getter.txt");

declare const opaqueDescriptor: PropertyDescriptor;
const opaque = Object.defineProperty({}, "path", opaqueDescriptor);
delete opaque.path;
opaque.path;
`,
        "src/runtime-descriptor-delete-configurability.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "retained.path setter"],
        ["filesystem-write", "retainedGetter.path"],
        ["browser", "opaque.path getter"],
        ["filesystem-read", "opaque.path getter"],
        ["filesystem-watch", "opaque.path getter"],
        ["filesystem-write", "opaque.path getter"],
        ["network", "opaque.path getter"],
        ["process", "opaque.path getter"],
        ["server", "opaque.path getter"],
        ["shared-cwd", "opaque.path getter"],
      ],
    );
  });

  it("preserves both outcomes when delete configurability is unknown", () => {
    assertEquals(
      collectSemanticMarkers(
        `
declare const configurable: boolean;
const deleted = { run: Deno.cwd };
Object.defineProperty(deleted, "run", { configurable });
Object.setPrototypeOf(deleted, { run: Deno.remove });
delete deleted.run;
deleted.run("delete.txt");

const reflected = { run: Deno.cwd };
Object.defineProperty(reflected, "run", { configurable });
Object.setPrototypeOf(reflected, { run: Deno.remove });
Reflect.deleteProperty(reflected, "run");
reflected.run("reflect-delete.txt");
`,
        "src/runtime-unknown-property-delete.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["shared-cwd", "Deno.cwd"],
        ["filesystem-write", "deleted.run"],
        ["shared-cwd", "deleted.run"],
        ["shared-cwd", "Deno.cwd"],
        ["filesystem-write", "reflected.run"],
        ["shared-cwd", "reflected.run"],
      ],
    );
  });

  it("retains properties when Reflect.defineProperty can fail", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const retainedValue = {};
Object.defineProperty(retainedValue, "run", { value: Deno.remove });
Reflect.defineProperty(retainedValue, "run", { value: () => undefined });
retainedValue.run("retained-value.txt");

const retainedGetter = {};
Object.defineProperty(retainedGetter, "run", {
  get: () => Deno.remove,
});
Reflect.defineProperty(retainedGetter, "run", {
  get: () => () => undefined,
});
retainedGetter.run("retained-getter.txt");

const retainedSetter = {};
Object.defineProperty(retainedSetter, "path", { set: Deno.remove });
Reflect.defineProperty(retainedSetter, "path", {
  set: () => undefined,
});
retainedSetter.path = "retained-setter.txt";

const clearedValue = {};
Object.defineProperty(clearedValue, "run", {
  configurable: true,
  value: Deno.remove,
});
Reflect.defineProperty(clearedValue, "run", { value: () => undefined });
clearedValue.run("cleared-value.txt");

const clearedGetter = {};
Object.defineProperty(clearedGetter, "run", {
  configurable: true,
  get: () => Deno.remove,
});
Reflect.defineProperty(clearedGetter, "run", {
  get: () => () => undefined,
});
clearedGetter.run("cleared-getter.txt");

const clearedSetter = {};
Object.defineProperty(clearedSetter, "path", {
  configurable: true,
  set: Deno.remove,
});
Reflect.defineProperty(clearedSetter, "path", {
  set: () => undefined,
});
clearedSetter.path = "cleared-setter.txt";
`,
        "src/runtime-reflect-define-property-configurability.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "retainedValue.run"],
        ["filesystem-write", "retainedGetter.run"],
        ["filesystem-write", "retainedSetter.path setter"],
      ],
    );
  });

  it("invokes descriptor getters on property reads and copies", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const direct = {};
Object.defineProperty(direct, "path", { get: Deno.cwd });
direct.path;

const source = {};
Object.defineProperty(source, "path", { get: Deno.cwd, enumerable: true });
Object.assign({}, source);
const spread = { ...source };
void spread;

const hidden = {};
Object.defineProperty(hidden, "request", { get: fetch });
Object.assign({}, hidden);
const hiddenSpread = { ...hidden };
void hiddenSpread;

const enumerableSource = {};
Object.defineProperty(enumerableSource, "path", {
  get: Deno.cwd,
  enumerable: true,
});
Object.assign({}, enumerableSource);
const enumerableSpread = { ...enumerableSource };
void enumerableSpread;

const hiddenReturn = Object.defineProperty({}, "run", {
  get: () => Deno.remove,
});
Object.assign({}, hiddenReturn).run();

const hiddenData = Object.defineProperty({}, "run", {
  value: Deno.remove,
});
Object.assign({}, hiddenData).run();

const visibleData = {};
Object.defineProperty(visibleData, "run", {
  configurable: true,
  enumerable: true,
  value: () => undefined,
});
Object.defineProperty(visibleData, "run", { value: Deno.remove });
Object.assign({}, visibleData).run("visible-data.txt");

const ordinaryData = { run: () => undefined };
Object.defineProperty(ordinaryData, "run", { value: Deno.remove });
Object.assign({}, ordinaryData).run("ordinary-data.txt");

const hiddenPreserved = { run: Deno.remove };
Object.assign(hiddenPreserved, hiddenReturn).run("preserved.txt");

const madeEnumerable = {};
Object.defineProperty(madeEnumerable, "run", {
  configurable: true,
  get: () => Deno.remove,
});
Object.defineProperty(madeEnumerable, "run", { enumerable: true });
Object.assign({}, madeEnumerable).run("enumerable.txt");

declare const chooseEnumerable: boolean;
const hiddenAlternative = {};
Object.defineProperty(hiddenAlternative, "run", {
  configurable: true,
  get: () => undefined,
});
const visibleAlternative = {};
Object.defineProperty(visibleAlternative, "run", {
  configurable: true,
  enumerable: true,
  get: () => undefined,
});
const mixedEnumerable = chooseEnumerable
  ? hiddenAlternative
  : visibleAlternative;
Object.defineProperty(mixedEnumerable, "run", { get: () => Deno.remove });
Object.assign({}, mixedEnumerable).run("mixed-enumerable.txt");

const returned = Object.defineProperty({}, "path", { get: Deno.cwd });
returned.path;
`,
        "src/runtime-descriptor-getters.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["shared-cwd", "Deno.cwd"],
        ["shared-cwd", "direct.path getter"],
        ["shared-cwd", "Deno.cwd"],
        ["shared-cwd", "Object.assign(source getter)"],
        ["shared-cwd", "source.* getter"],
        ["shared-cwd", "Deno.cwd"],
        ["shared-cwd", "Object.assign(enumerableSource getter)"],
        ["shared-cwd", "enumerableSource.* getter"],
        ["filesystem-write", "run"],
        ["filesystem-write", "run"],
        ["filesystem-write", "run"],
        ["filesystem-write", "run"],
        ["filesystem-write", "run"],
        ["shared-cwd", "Deno.cwd"],
        ["shared-cwd", "returned.path getter"],
      ],
    );
  });

  it("copies only own enumerable descriptor properties", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const hidden = {};
Object.defineProperty(hidden, "run", {
  value: Deno.remove,
});
Object.assign({}, hidden).run("hidden-assign.txt");
({ ...hidden }).run("hidden-spread.txt");
`,
        "src/runtime-hidden-descriptor-enumerability.test.ts",
      ),
      [],
    );

    assertEquals(
      collectSemanticMarkers(
        `
declare const descriptorKey: "enumerable" | "configurable";
const maybeEnumerable = {};
Object.defineProperty(maybeEnumerable, "run", {
  value: Deno.remove,
  [descriptorKey]: true,
});
Object.assign({}, maybeEnumerable).run("maybe-enumerable-assign.txt");
({ ...maybeEnumerable }).run("maybe-enumerable-spread.txt");
`,
        "src/runtime-computed-descriptor-attributes.test.ts",
      ).filter((marker) =>
        marker.effect === "filesystem-write" && marker.symbol === "run"
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "run"],
        ["filesystem-write", "run"],
      ],
    );

    assertEquals(
      collectSemanticMarkers(
        `
const visible = {};
Object.defineProperty(visible, "run", {
  value: Deno.remove,
  enumerable: true,
});
Object.assign({}, visible).run("visible-assign.txt");
({ ...visible }).run("visible-spread.txt");

const revealed = {};
Object.defineProperty(revealed, "run", {
  value: () => undefined,
  configurable: true,
});
Object.defineProperty(revealed, "run", {
  value: Deno.remove,
  enumerable: true,
});
Object.assign({}, revealed).run("revealed-assign.txt");
({ ...revealed }).run("revealed-spread.txt");

const preservedEnumerable = {};
Object.defineProperty(preservedEnumerable, "run", {
  value: Deno.remove,
  enumerable: true,
  configurable: true,
});
Object.defineProperty(preservedEnumerable, "run", {
  value: Deno.remove,
});
Object.assign({}, preservedEnumerable).run("preserved-assign.txt");
({ ...preservedEnumerable }).run("preserved-spread.txt");
`,
        "src/runtime-visible-descriptor-enumerability.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "run"],
        ["filesystem-write", "run"],
        ["filesystem-write", "run"],
        ["filesystem-write", "run"],
        ["filesystem-write", "run"],
        ["filesystem-write", "run"],
      ],
    );

    assertEquals(
      collectSemanticMarkers(
        `
const prototype = {};
Object.defineProperty(prototype, "run", {
  value: Deno.remove,
  enumerable: true,
});
const inherited = Object.setPrototypeOf({}, prototype);
Object.assign({}, inherited).run("inherited-assign.txt");
({ ...inherited }).run("inherited-spread.txt");
`,
        "src/runtime-inherited-descriptor-enumerability.test.ts",
      ),
      [],
    );

    assertEquals(
      collectSemanticMarkers(
        `
const prototype = {};
Object.defineProperty(prototype, "run", {
  value: () => undefined,
  enumerable: true,
});
const target = {};
Object.setPrototypeOf(target, prototype);
Object.defineProperty(target, "run", { value: Deno.remove });
Object.assign({}, target).run("new-own-assign.txt");
({ ...target }).run("new-own-spread.txt");
`,
        "src/runtime-new-own-descriptor-defaults.test.ts",
      ),
      [],
    );
  });

  it("distinguishes new own descriptors from inherited and blocked definitions", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const prototype = { run: Deno.remove };

const defined = Object.setPrototypeOf({}, prototype);
Object.defineProperty(defined, "run", {});
defined.run("defined.txt");

const attributed = Object.setPrototypeOf({}, prototype);
Object.defineProperty(attributed, "run", { enumerable: true });
attributed.run("attributed.txt");

const reflected = Object.setPrototypeOf({}, prototype);
Reflect.defineProperty(reflected, "run", {});
reflected.run("reflected.txt");

const definedMany = Object.setPrototypeOf({}, prototype);
Object.defineProperties(definedMany, { run: {} });
definedMany.run("defined-many.txt");

const own = { run: Deno.remove };
Object.defineProperty(own, "run", { enumerable: true });
own.run("own.txt");

const blockedObject = Object.setPrototypeOf(
  Object.preventExtensions({}),
  prototype,
);
try {
  Object.defineProperty(blockedObject, "run", {});
} catch {}
blockedObject.run("blocked-object.txt");

const blockedReflect = Object.setPrototypeOf(
  Object.preventExtensions({}),
  prototype,
);
Reflect.defineProperty(blockedReflect, "run", {});
blockedReflect.run("blocked-reflect.txt");

const blockedInPlace = Object.setPrototypeOf({}, prototype);
Object.preventExtensions(blockedInPlace);
try {
  Object.defineProperty(blockedInPlace, "run", {});
} catch {}
blockedInPlace.run("blocked-in-place.txt");

const blockedReflectInPlace = Object.setPrototypeOf({}, prototype);
Reflect.preventExtensions(blockedReflectInPlace);
Reflect.defineProperty(blockedReflectInPlace, "run", {});
blockedReflectInPlace.run("blocked-reflect-in-place.txt");

const blockedMany = Object.setPrototypeOf(
  Object.preventExtensions({}),
  prototype,
);
try {
  Object.defineProperties(blockedMany, { run: {} });
} catch {}
blockedMany.run("blocked-many.txt");
`,
        "src/runtime-descriptor-ownness.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "own.run"],
        ["filesystem-write", "blockedObject.run"],
        ["filesystem-write", "blockedReflect.run"],
        ["filesystem-write", "blockedInPlace.run"],
        ["filesystem-write", "blockedReflectInPlace.run"],
        ["filesystem-write", "blockedMany.run"],
      ],
    );
  });

  it("fails closed when an opaque descriptor may contain a getter", () => {
    assertEquals(
      collectSemanticMarkers(
        `
declare const descriptor: PropertyDescriptor;

const direct = {};
Object.defineProperty(direct, "path", descriptor);
direct.path;
Object.assign({}, direct);
const directSpread = { ...direct };
void directSpread;

const returned = Object.defineProperty({}, "path", descriptor);
returned.path;

const bulk = Object.defineProperties({}, { path: descriptor });
bulk.path;

const deleted = {};
Object.defineProperty(deleted, "path", descriptor);
delete deleted.path;
`,
        "src/runtime-opaque-descriptor-getters.test.ts",
      ).map((marker) => marker.effect),
      [
        "browser",
        "filesystem-read",
        "filesystem-watch",
        "filesystem-write",
        "network",
        "process",
        "server",
        "shared-cwd",
        "browser",
        "filesystem-read",
        "filesystem-watch",
        "filesystem-write",
        "network",
        "process",
        "server",
        "shared-cwd",
        "browser",
        "filesystem-read",
        "filesystem-watch",
        "filesystem-write",
        "network",
        "process",
        "server",
        "shared-cwd",
        "browser",
        "filesystem-read",
        "filesystem-watch",
        "filesystem-write",
        "network",
        "process",
        "server",
        "shared-cwd",
        "browser",
        "filesystem-read",
        "filesystem-watch",
        "filesystem-write",
        "network",
        "process",
        "server",
        "shared-cwd",
      ],
    );
  });

  it("preserves both branches of logical property assignments", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const nullish = [() => undefined];
nullish[1] ??= Deno.writeTextFile;
const [, nullishRun] = [...nullish, () => undefined];
nullishRun("nullish.txt", "x");

const disjoined = [() => undefined];
disjoined[1] ||= Deno.writeTextFile;
const [, disjoinedRun] = [...disjoined, () => undefined];
disjoinedRun("disjoined.txt", "x");

const conjoined = [() => undefined, () => undefined];
conjoined[1] &&= Deno.writeTextFile;
const [, conjoinedRun] = [...conjoined, () => undefined];
conjoinedRun("conjoined.txt", "x");

const resultHolder = {};
const disjoinedResult = (resultHolder.write ||= Deno.writeTextFile);
disjoinedResult("disjoined-result.txt", "x");

const nullishResultHolder = {};
const nullishResult = (nullishResultHolder.write ??= Deno.writeTextFile);
nullishResult("nullish-result.txt", "x");

const conjoinedResultHolder = { write: () => undefined };
const conjoinedResult = (conjoinedResultHolder.write &&= Deno.writeTextFile);
conjoinedResult("conjoined-result.txt", "x");

const assignedResultHolder = {};
const assignedResult = (assignedResultHolder.write = Deno.writeTextFile);
assignedResult("assigned-result.txt", "x");

class LogicalAssignmentResultClass {}
const logicalClassHolder = {};
const LogicalAssignmentResultAlias =
  (logicalClassHolder.Receiver ||= LogicalAssignmentResultClass);
LogicalAssignmentResultAlias.write = Deno.writeTextFile;
LogicalAssignmentResultClass.write("logical-class-result.txt", "x");

class DirectAssignmentResultClass {}
const directClassHolder = {};
const DirectAssignmentResultAlias =
  (directClassHolder.Receiver = DirectAssignmentResultClass);
DirectAssignmentResultAlias.write = Deno.writeTextFile;
DirectAssignmentResultClass.write("direct-class-result.txt", "x");
`,
        "src/logical-property-assignments.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "nullishRun"],
        ["filesystem-write", "disjoinedRun"],
        ["filesystem-write", "conjoinedRun"],
        ["filesystem-write", "disjoinedResult"],
        ["filesystem-write", "nullishResult"],
        ["filesystem-write", "conjoinedResult"],
        ["filesystem-write", "assignedResult"],
        ["filesystem-write", "LogicalAssignmentResultClass.write"],
        ["filesystem-write", "DirectAssignmentResultClass.write"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
const local = () => undefined;
const holder = { write: local };
const disjoinedResult = (holder.write ||= local);
const nullishResult = (holder.write ??= local);
const conjoinedResult = (holder.write &&= local);
disjoinedResult();
nullishResult();
conjoinedResult();
`,
        "src/local-logical-assignment-results.test.ts",
      ),
      [],
    );
  });

  it("uses JavaScript array-index bounds for sparse writes", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const values = [() => undefined];
values[4294967295] = Deno.writeTextFile;
const copy = [...values];
copy[0]();

const [, ...rest] = values;
rest[0]();
`,
        "src/non-array-index-property.test.ts",
      ),
      [],
    );
  });

  it("classifies optional runtime calls", () => {
    assertEquals(
      collectSemanticMarkers(
        `
await Deno.open?.("read.txt", { read: true, write: false });
await Deno.writeTextFile?.("tmp.txt", "x");
await fetch?.("https://example.com/a");
await globalThis.fetch?.("https://example.com/b");
await Deno.resolveDns?.("example.com", "A");
`,
        "src/optional-runtime-calls.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-read", "Deno.open"],
        ["filesystem-write", "Deno.writeTextFile"],
        ["network", "fetch"],
        ["network", "globalThis.fetch"],
        ["network", "Deno.resolveDns"],
      ],
    );
  });

  it("classifies optional runtime environment reads", () => {
    assertEquals(
      collectSemanticMarkers(
        `
Deno?.env.get("MODE");
process?.env.MODE;
`,
        "src/optional-runtime-env.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["process", "Deno.env"],
        ["process", "process.env"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
const Deno = { env: { get() {} } };
Deno?.env.get("MODE");
const process = { env: { MODE: "test" } };
process?.env.MODE;
`,
        "src/shadowed-optional-runtime-env.test.ts",
      ),
      [],
    );
  });

  it("classifies Deno and Node filesystem mutation APIs", () => {
    const markers = collectSemanticMarkers(
      `
import {
  appendFile,
  chmod,
  chown,
  cp,
  createWriteStream,
  link,
  truncate,
  utimes,
} from "node:fs";
await Deno.chmod("tmp.txt", 0o600);
await Deno.chown("tmp.txt", null, null);
await Deno.link("tmp.txt", "linked.txt");
await Deno.truncate("tmp.txt", 0);
await Deno.utime("tmp.txt", new Date(), new Date());
appendFile("tmp.txt", "x", () => undefined);
chmod("tmp.txt", 0o600, () => undefined);
chown("tmp.txt", 0, 0, () => undefined);
cp("tmp.txt", "copy.txt", () => undefined);
createWriteStream("tmp.txt");
link("tmp.txt", "linked.txt", () => undefined);
truncate("tmp.txt", 0, () => undefined);
utimes("tmp.txt", new Date(), new Date(), () => undefined);
`,
      "src/filesystem-mutations.test.ts",
    );

    assertEquals(
      markers.map((marker) => marker.symbol),
      [
        "Deno.chmod",
        "Deno.chown",
        "Deno.link",
        "Deno.truncate",
        "Deno.utime",
        "appendFile",
        "chmod",
        "chown",
        "cp",
        "createWriteStream",
        "link",
        "truncate",
        "utimes",
      ],
    );
    assertEquals(
      markers.every((marker) => marker.effect === "filesystem-write"),
      true,
    );
  });

  it("classifies filesystem streams, watchers, descriptor reads, and links", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import fs, {
  createReadStream,
  read,
  readlink,
  unwatchFile,
  watch,
  watchFile,
} from "node:fs";
Deno.watchFs(".");
Deno.readLink("link");
createReadStream("fixture.txt");
read(1, new Uint8Array(1), 0, 1, 0, () => undefined);
readlink("link", () => undefined);
watch(".", () => undefined);
watchFile("fixture.txt", () => undefined);
unwatchFile("fixture.txt");
fs.createReadStream("fixture.txt");
await fs.promises.readlink("link");
`,
        "src/filesystem-observation.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-watch", "Deno.watchFs"],
        ["filesystem-read", "Deno.readLink"],
        ["filesystem-read", "createReadStream"],
        ["filesystem-read", "read"],
        ["filesystem-read", "readlink"],
        ["filesystem-watch", "watch"],
        ["filesystem-watch", "watchFile"],
        ["filesystem-watch", "unwatchFile"],
        ["filesystem-read", "fs.createReadStream"],
        ["filesystem-read", "fs.promises.readlink"],
      ],
    );
  });

  it("classifies writable filesystem open modes without widening static reads", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import { openSync as nodeOpenSync } from "node:fs";
import * as fs from "node:fs";
await Deno.open("read.txt", { read: true, write: false });
Deno.openSync("write.txt", { write: true, create: true });
const denoOptions = { write: true };
await Deno.open("dynamic.txt", denoOptions);
nodeOpenSync("read.txt", "r");
const aliasedOpen = nodeOpenSync;
aliasedOpen("write.txt", "r+");
fs.open("append.txt", "a", () => undefined);
await fs.promises.open("promise-read.txt", "r");
await fs.promises.open("promise-write.txt", "w");
const { open: dynamicOpen } = await import("node:fs/promises");
await dynamicOpen("read.txt", "r");
`,
        "src/filesystem-open-modes.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-read", "Deno.open"],
        ["filesystem-write", "Deno.openSync"],
        ["filesystem-write", "Deno.open"],
        ["filesystem-read", "nodeOpenSync"],
        ["filesystem-write", "aliasedOpen"],
        ["filesystem-write", "fs.open"],
        ["filesystem-read", "fs.promises.open"],
        ["filesystem-write", "fs.promises.open"],
        ["filesystem-read", "dynamicOpen"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
function open(_path: string, _options: unknown) {}
open("local.txt", { write: true });
`,
        "src/local-open.test.ts",
      ),
      [],
    );
  });

  it("classifies extracted Deno open aliases with option-aware modes", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const denoOpen = Deno.open;
const denoOpenAgain = denoOpen;
await denoOpen("read.txt", { read: true, write: false });
await denoOpenAgain("write.txt", { write: true, create: true });
const { open: denoOpenFromPattern } = Deno;
await denoOpenFromPattern("pattern-write.txt", { write: true });
const globalThisDenoOpen = globalThis.Deno.open;
await globalThisDenoOpen("global-read.txt", { read: true, write: false });
const { openSync: denoOpenSync } = Deno;
denoOpenSync("default.txt");
await globalThis.Deno.open("global-write.txt", { write: true, create: true });
await window.Deno.open("window-write.txt", { write: true });
await self.Deno.open("self-write.txt", { write: true });
`,
        "src/extracted-deno-open.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-read", "denoOpen"],
        ["filesystem-write", "denoOpenAgain"],
        ["filesystem-write", "denoOpenFromPattern"],
        ["filesystem-read", "globalThisDenoOpen"],
        ["filesystem-read", "denoOpenSync"],
        ["filesystem-write", "globalThis.Deno.open"],
        ["filesystem-write", "window.Deno.open"],
        ["filesystem-write", "self.Deno.open"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
function local(Deno: { open(): void; openSync(): void }) {
  const denoOpen = Deno.open;
  denoOpen("write.txt", { write: true });
  const { openSync } = Deno;
  openSync("write.txt", { write: true });
}
`,
        "src/local-extracted-deno-open.test.ts",
      ),
      [],
    );
  });

  it("fails closed for unknown computed open options while preserving static computed read options", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const optionKey = "write";
await Deno.open("unknown-computed.txt", { [optionKey]: true });
await Deno.open("static-computed.txt", { ["read"]: true, ["write"]: false });
`,
        "src/computed-open-options.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "Deno.open"],
        ["filesystem-read", "Deno.open"],
      ],
    );
  });

  it("propagates runtime aliases from assignments and parameter defaults", () => {
    assertEquals(
      collectSemanticMarkers(
        `
let write;
write = Deno.writeTextFile;
await write("tmp.txt", "x");
function run(defaultWrite = Deno.writeTextFile) {
  defaultWrite("tmp.txt", "x");
}
const writeWithSatisfies = Deno.writeTextFile satisfies typeof Deno.writeTextFile;
writeWithSatisfies("tmp.txt", "x");
let nestedWrite = Deno.writeTextFile;
function resetNestedWrite() {
  nestedWrite = () => undefined;
}
nestedWrite("tmp.txt", "x");
let conditionalWrite = Deno.writeTextFile;
if (false) conditionalWrite = () => undefined;
conditionalWrite("tmp.txt", "x");
let logicalAndWrite = Deno.writeTextFile;
maybe && (logicalAndWrite = () => undefined);
logicalAndWrite("logical-and.txt", "x");
let logicalOrWrite = Deno.writeTextFile;
maybe || (logicalOrWrite = () => undefined);
logicalOrWrite("logical-or.txt", "x");
let nullishWrite = Deno.writeTextFile;
maybe ?? (nullishWrite = () => undefined);
nullishWrite("nullish.txt", "x");
let ternaryWrite = Deno.writeTextFile;
maybe ? (ternaryWrite = () => undefined) : undefined;
ternaryWrite("ternary.txt", "x");
let conditionalAssignedWrite;
if (maybe) conditionalAssignedWrite = Deno.writeTextFile;
conditionalAssignedWrite("conditional-assigned.txt", "x");
let logicalAndAssignedWrite;
maybe && (logicalAndAssignedWrite = Deno.writeTextFile);
logicalAndAssignedWrite("logical-and-assigned.txt", "x");
let logicalOrAssignedWrite;
maybe || (logicalOrAssignedWrite = Deno.writeTextFile);
logicalOrAssignedWrite("logical-or-assigned.txt", "x");
let nullishAssignedWrite;
maybe ?? (nullishAssignedWrite = Deno.writeTextFile);
nullishAssignedWrite("nullish-assigned.txt", "x");
let ternaryAssignedWrite;
maybe ? (ternaryAssignedWrite = Deno.writeTextFile) : undefined;
ternaryAssignedWrite("ternary-assigned.txt", "x");
let assignedFs;
assignedFs = await import("node:fs");
const assignedWrite = assignedFs.promises.writeFile;
await assignedWrite("tmp.txt", "x");
let blockWrite;
{
  blockWrite = Deno.writeTextFile;
}
blockWrite("block.txt", "x");
let destructuredBlockWrite;
{
  ({ writeTextFile: destructuredBlockWrite } = Deno);
}
destructuredBlockWrite("destructured-block.txt", "x");
let functionWrite;
function assignOuterWrite() {
  functionWrite = Deno.writeTextFile;
  functionWrite("function.txt", "x");
}
assignOuterWrite();
let switchWrite;
switch (mode) {
  case "write":
    switchWrite = Deno.writeTextFile;
    break;
}
switchWrite("switch.txt", "x");
let loopWrite;
for (const _ of [1]) {
  loopWrite = Deno.writeTextFile;
}
loopWrite("loop.txt", "x");
{
  var varBlockWrite = Deno.writeTextFile;
}
varBlockWrite("var-block.txt", "x");
{
  var varBlockAssignedWrite;
  varBlockAssignedWrite = Deno.writeTextFile;
}
varBlockAssignedWrite("var-block-assigned.txt", "x");
`,
        "src/assigned-runtime-aliases.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "write"],
        ["filesystem-write", "defaultWrite"],
        ["filesystem-write", "writeWithSatisfies"],
        ["filesystem-write", "nestedWrite"],
        ["filesystem-write", "conditionalWrite"],
        ["filesystem-write", "logicalAndWrite"],
        ["filesystem-write", "logicalOrWrite"],
        ["filesystem-write", "nullishWrite"],
        ["filesystem-write", "ternaryWrite"],
        ["filesystem-write", "conditionalAssignedWrite"],
        ["filesystem-write", "logicalAndAssignedWrite"],
        ["filesystem-write", "logicalOrAssignedWrite"],
        ["filesystem-write", "nullishAssignedWrite"],
        ["filesystem-write", "ternaryAssignedWrite"],
        ["filesystem-write", "assignedWrite"],
        ["filesystem-write", "blockWrite"],
        ["filesystem-write", "destructuredBlockWrite"],
        ["filesystem-write", "functionWrite"],
        ["filesystem-write", "switchWrite"],
        ["filesystem-write", "loopWrite"],
        ["filesystem-write", "varBlockWrite"],
        ["filesystem-write", "varBlockAssignedWrite"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
function local(Deno: { writeTextFile(): void }) {
  let write;
  write = Deno.writeTextFile;
  write("tmp.txt", "x");
}
let reassigned;
reassigned = Deno.writeTextFile;
reassigned = () => undefined;
reassigned("tmp.txt", "x");
function shadow(defaultWrite = (() => undefined)) {
  defaultWrite("tmp.txt", "x");
}
`,
        "src/shadowed-assigned-runtime-aliases.test.ts",
      ),
      [],
    );
    assertEquals(
      collectSemanticMarkers(
        `
class RuntimeParameterProperty {
  constructor(public write = Deno.writeTextFile) {
    write("parameter-property.txt", "x");
    this.write("parameter-property-this.txt", "x");
  }
}
`,
        "src/runtime-parameter-property.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "write"],
        ["filesystem-write", "this.write"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
class AssignedRuntimeProperty {
  constructor() {
    this.write = Deno.writeTextFile;
    this.write("assigned-property.txt", "x");
  }
}
`,
        "src/assigned-runtime-property.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["filesystem-write", "this.write"]],
    );
    assertEquals(
      collectSemanticMarkers(
        `
class RuntimeClassFields {
  write = Deno.writeTextFile;
  ["read"] = Deno.readTextFile;
  #request = fetch;
  constructor() {
    this.write("class-field.txt", "x");
  }
  run() {
    this.read("class-field.txt");
    this.#request("https://example.com");
  }
}
`,
        "src/runtime-class-fields.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "this.write"],
        ["filesystem-read", "this.read"],
        ["network", "this.#request"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
class SeparatedClassFields {
  write = () => undefined;
  static write = Deno.writeTextFile;
  run() {
    this.write();
  }
  static run() {
    this.write("static-class-field.txt", "x");
  }
}
`,
        "src/separated-runtime-class-fields.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["filesystem-write", "this.write"]],
    );
    assertEquals(
      collectSemanticMarkers(
        `
class CrossMethodRuntimeProperty {
  run() {
    this.write("cross-method.txt", "x");
  }
  constructor() {
    this.write = Deno.writeTextFile;
  }
}
class CrossMethodParameterProperty {
  run() {
    this.request("https://example.com");
  }
  constructor(public request = fetch) {}
}
`,
        "src/cross-method-runtime-properties.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "this.write"],
        ["network", "this.request"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
class RuntimeArrowClassFields {
  write = Deno.writeTextFile;
  run = () => {
    this.write("arrow-class-field.txt", "x");
  };
  assign = () => {
    this.request = fetch;
    this.request("https://example.com");
  };
  static read = Deno.readTextFile;
  static run = () => {
    this.read("static-arrow-class-field.txt");
  };
}
class CrossFieldArrowAssignment {
  assign = () => {
    this.request = fetch;
  };
  run() {
    this.request("https://example.com/method");
  }
  runArrow = () => {
    this.request("https://example.com/arrow");
  };
  static run() {
    this.write("static-arrow-assignment.txt", "x");
  }
  static assign = () => {
    this.write = Deno.writeTextFile;
  };
}
class RuntimeStaticBlock {
  static {
    this.remove = Deno.remove;
    this.remove("static-block.txt");
  }
  static run() {
    this.remove("static-block-method.txt");
  }
  static runArrow = () => {
    this.remove("static-block-arrow.txt");
  };
}
class StaticNameFromField {
  static write = Deno.writeTextFile;
  static run() {
    StaticNameFromField.write("named-static-field.txt", "x");
  }
}
class StaticNameToThis {
  static {
    StaticNameToThis.request = fetch;
  }
  static run() {
    this.request("https://example.com/named-to-this");
  }
}
class StaticThisToName {
  static {
    this.read = Deno.readTextFile;
  }
  static run() {
    StaticThisToName.read("named-static-block.txt");
  }
}
class InstanceReadsStaticName {
  static remove = Deno.remove;
  run() {
    InstanceReadsStaticName.remove("instance-static-name.txt");
  }
}
class ExternalStaticName {
  static write = Deno.writeTextFile;
}
ExternalStaticName.write("external-static-name.txt", "x");
class AliasedStaticReceiver {
  static {
    const Receiver = AliasedStaticReceiver;
    Receiver.write = Deno.writeTextFile;
    Receiver.write("aliased-same-block.txt", "x");
    this.write("aliased-this-same-block.txt", "x");
    AliasedStaticReceiver.write("aliased-name-same-block.txt", "x");
  }
  static run() {
    this.write("aliased-this-later-method.txt", "x");
    AliasedStaticReceiver.write("aliased-name-later-method.txt", "x");
  }
}
class PossibleStaticReceiverA {}
class PossibleStaticReceiverB {}
let PossibleStaticReceiver = PossibleStaticReceiverA;
if (maybe) PossibleStaticReceiver = PossibleStaticReceiverB;
PossibleStaticReceiver.write = Deno.writeTextFile;
PossibleStaticReceiverA.write("possible-static-a.txt", "x");
PossibleStaticReceiverB.write("possible-static-b.txt", "x");
const NamedClassExpression = class InnerStaticName {
  static write = Deno.writeTextFile;
  static run() {
    InnerStaticName.write("inner-static-name.txt", "x");
  }
};
NamedClassExpression.write("named-class-expression.txt", "x");
`,
        "src/runtime-arrow-class-fields.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "this.write"],
        ["network", "this.request"],
        ["filesystem-read", "this.read"],
        ["network", "this.request"],
        ["network", "this.request"],
        ["filesystem-write", "this.write"],
        ["filesystem-write", "this.remove"],
        ["filesystem-write", "this.remove"],
        ["filesystem-write", "this.remove"],
        ["filesystem-write", "StaticNameFromField.write"],
        ["network", "this.request"],
        ["filesystem-read", "StaticThisToName.read"],
        ["filesystem-write", "InstanceReadsStaticName.remove"],
        ["filesystem-write", "ExternalStaticName.write"],
        ["filesystem-write", "Receiver.write"],
        ["filesystem-write", "this.write"],
        ["filesystem-write", "AliasedStaticReceiver.write"],
        ["filesystem-write", "this.write"],
        ["filesystem-write", "AliasedStaticReceiver.write"],
        ["filesystem-write", "PossibleStaticReceiverA.write"],
        ["filesystem-write", "PossibleStaticReceiverB.write"],
        ["filesystem-write", "InnerStaticName.write"],
        ["filesystem-write", "NamedClassExpression.write"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
class ShadowedParameterProperty {
  constructor(
    Deno: { writeTextFile: () => void },
    public write = Deno.writeTextFile,
  ) {
    write("parameter-property.txt", "x");
    this.write("parameter-property-this.txt", "x");
  }
}
class LocalRuntimeProperty {
  constructor() {
    this.write = () => undefined;
    this.write();
  }
}
function typedThis(this: { write(): void }) {
  this.write();
}
const localRuntime = { writeTextFile: () => undefined };
class LocalRuntimeClassField {
  write = localRuntime.writeTextFile;
  run() {
    this.write();
  }
}
class LocalCrossMethodRuntimeProperty {
  constructor() {
    this.write = () => undefined;
  }
  run() {
    this.write();
  }
}
class LocalArrowClassField {
  write = () => undefined;
  run = () => {
    this.write();
  };
}
class FunctionFieldReceiverIsolation {
  write = Deno.writeTextFile;
  run = function () {
    this.write("isolated-function-field.txt", "x");
  };
}
class LocalStaticBlock {
  static {
    this.write = () => undefined;
    this.write();
    function isolated() {
      this.write("isolated-static-block.txt", "x");
    }
  }
  static run() {
    this.write();
  }
}
class LaterStaticFieldDoesNotLeakBackward {
  static {
    this.write("before-static-field.txt", "x");
  }
  static write = Deno.writeTextFile;
}
class ShadowedStaticClassName {
  static write = Deno.writeTextFile;
  static run() {
    const ShadowedStaticClassName = { write: () => undefined };
    ShadowedStaticClassName.write();
  }
}
`,
        "src/shadowed-parameter-property.test.ts",
      ),
      [],
    );
  });

  it("preserves class receiver identity through object aliases", () => {
    assertEquals(
      collectSemanticMarkers(
        `
class HolderClass {}
const holder = { HolderClass };
const HolderAlias = holder.HolderClass;
HolderAlias.write = Deno.writeTextFile;
holder.HolderClass.write("holder-property.txt", "x");
HolderClass.write("holder-class.txt", "x");

class DestructuredClass {}
const { DestructuredClass: DestructuredAlias } = { DestructuredClass };
DestructuredAlias.write = Deno.writeTextFile;
DestructuredClass.write("destructured-class.txt", "x");

class AssignedHolderClass {}
const assignedHolder = {};
assignedHolder.Receiver = AssignedHolderClass;
const AssignedHolderAlias = assignedHolder.Receiver;
AssignedHolderAlias.write = Deno.writeTextFile;
AssignedHolderClass.write("assigned-holder-class.txt", "x");

class SpreadHolderClass {}
const spreadSource = { Receiver: SpreadHolderClass };
const spreadHolder = { ...spreadSource };
const SpreadHolderAlias = spreadHolder.Receiver;
SpreadHolderAlias.write = Deno.writeTextFile;
SpreadHolderClass.write("spread-holder-class.txt", "x");

class NestedHolderClass {}
const nestedHolder = { nested: { Receiver: NestedHolderClass } };
const NestedHolderAlias = nestedHolder.nested.Receiver;
NestedHolderAlias.write = Deno.writeTextFile;
NestedHolderClass.write("nested-holder-class.txt", "x");

class ReverseHolderClass {}
const reverseHolder = { Receiver: ReverseHolderClass };
ReverseHolderClass.write = Deno.writeTextFile;
reverseHolder.Receiver.write("reverse-holder-class.txt", "x");

class DirectHolderClass {}
const directHolder = { Receiver: DirectHolderClass };
directHolder.Receiver.write = Deno.writeTextFile;
DirectHolderClass.write("direct-holder-class.txt", "x");

class DirectNestedHolderClass {}
const directNestedHolder = {
  nested: { Receiver: DirectNestedHolderClass },
};
directNestedHolder.nested.Receiver.write = Deno.writeTextFile;
DirectNestedHolderClass.write("direct-nested-holder-class.txt", "x");

class ComputedHolderClass {}
const computedHolder = { Receiver: ComputedHolderClass };
const computedKey = "Receiver";
const ComputedHolderAlias = computedHolder[computedKey];
ComputedHolderAlias.write = Deno.writeTextFile;
ComputedHolderClass.write("computed-holder-class.txt", "x");

class DirectComputedHolderClass {}
const directComputedHolder = { Receiver: DirectComputedHolderClass };
directComputedHolder[computedKey].write = Deno.writeTextFile;
DirectComputedHolderClass.write("direct-computed-holder-class.txt", "x");

class ComputedDestructuredClass {}
const computedDestructuredHolder = { Receiver: ComputedDestructuredClass };
const { [computedKey]: ComputedDestructuredAlias } =
  computedDestructuredHolder;
ComputedDestructuredAlias.write = Deno.writeTextFile;
ComputedDestructuredClass.write("computed-destructured-class.txt", "x");

const ClassExpression = class {};
const ClassExpressionAlias = ClassExpression;
ClassExpressionAlias.write = Deno.writeTextFile;
ClassExpression.write("class-expression.txt", "x");

class PossibleHolderClassA {}
class PossibleHolderClassB {}
const possibleHolder = maybe
  ? { Receiver: PossibleHolderClassA }
  : { Receiver: PossibleHolderClassB };
const PossibleHolderAlias = possibleHolder.Receiver;
PossibleHolderAlias.write = Deno.writeTextFile;
PossibleHolderClassA.write("possible-holder-a.txt", "x");
PossibleHolderClassB.write("possible-holder-b.txt", "x");

class DirectPossibleHolderClassA {}
class DirectPossibleHolderClassB {}
const directPossibleHolder = maybe
  ? { Receiver: DirectPossibleHolderClassA }
  : { Receiver: DirectPossibleHolderClassB };
directPossibleHolder.Receiver.write = Deno.writeTextFile;
DirectPossibleHolderClassA.write("direct-possible-holder-a.txt", "x");
DirectPossibleHolderClassB.write("direct-possible-holder-b.txt", "x");

class ConditionalReceiverClassA {}
class ConditionalReceiverClassB {}
const conditionalReceiverLeft = { Receiver: ConditionalReceiverClassA };
const conditionalReceiverRight = { Receiver: ConditionalReceiverClassB };
(maybe ? conditionalReceiverLeft.Receiver : conditionalReceiverRight.Receiver)
  .write = Deno.writeTextFile;
ConditionalReceiverClassA.write("conditional-receiver-a.txt", "x");
ConditionalReceiverClassB.write("conditional-receiver-b.txt", "x");

class LogicalReceiverClassA {}
class LogicalReceiverClassB {}
const logicalReceiverLeft = { Receiver: LogicalReceiverClassA };
const logicalReceiverRight = { Receiver: LogicalReceiverClassB };
const possibleLogicalReceiver = maybe
  ? logicalReceiverLeft.Receiver
  : undefined;
(possibleLogicalReceiver || logicalReceiverRight.Receiver).write =
  Deno.writeTextFile;
LogicalReceiverClassA.write("logical-receiver-a.txt", "x");
LogicalReceiverClassB.write("logical-receiver-b.txt", "x");

class ConditionalPropertyClassA {}
class ConditionalPropertyClassB {}
const conditionalPropertyHolder = {
  Receiver: maybe ? ConditionalPropertyClassA : ConditionalPropertyClassB,
};
conditionalPropertyHolder.Receiver.write = Deno.writeTextFile;
ConditionalPropertyClassA.write("conditional-property-a.txt", "x");
ConditionalPropertyClassB.write("conditional-property-b.txt", "x");

class ConditionalVariableClassA {}
class ConditionalVariableClassB {}
const ConditionalVariableAlias = maybe
  ? ConditionalVariableClassA
  : ConditionalVariableClassB;
ConditionalVariableAlias.write = Deno.writeTextFile;
ConditionalVariableClassA.write("conditional-variable-a.txt", "x");
ConditionalVariableClassB.write("conditional-variable-b.txt", "x");

class IgnoredSequenceReceiverClass {}
class SequenceReceiverClass {}
const ignoredSequenceReceiver = { Receiver: IgnoredSequenceReceiverClass };
const sequenceReceiver = { Receiver: SequenceReceiverClass };
(ignoredSequenceReceiver.Receiver, sequenceReceiver.Receiver).write =
  Deno.writeTextFile;
IgnoredSequenceReceiverClass.write("ignored-sequence-receiver.txt", "x");
SequenceReceiverClass.write("sequence-receiver.txt", "x");

class ExactDefaultClass {}
class UnusedDefaultClass {}
const { Receiver: ExactDefaultAlias = UnusedDefaultClass } = {
  Receiver: ExactDefaultClass,
};
ExactDefaultAlias.write = Deno.writeTextFile;
ExactDefaultClass.write("exact-default-class.txt", "x");
UnusedDefaultClass.write("unused-default-class.txt", "x");
`,
        "src/class-receiver-object-aliases.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "holder.HolderClass.write"],
        ["filesystem-write", "HolderClass.write"],
        ["filesystem-write", "DestructuredClass.write"],
        ["filesystem-write", "AssignedHolderClass.write"],
        ["filesystem-write", "SpreadHolderClass.write"],
        ["filesystem-write", "NestedHolderClass.write"],
        ["filesystem-write", "reverseHolder.Receiver.write"],
        ["filesystem-write", "DirectHolderClass.write"],
        ["filesystem-write", "DirectNestedHolderClass.write"],
        ["filesystem-write", "ComputedHolderClass.write"],
        ["filesystem-write", "DirectComputedHolderClass.write"],
        ["filesystem-write", "ComputedDestructuredClass.write"],
        ["filesystem-write", "ClassExpression.write"],
        ["filesystem-write", "PossibleHolderClassA.write"],
        ["filesystem-write", "PossibleHolderClassB.write"],
        ["filesystem-write", "DirectPossibleHolderClassA.write"],
        ["filesystem-write", "DirectPossibleHolderClassB.write"],
        ["filesystem-write", "ConditionalReceiverClassA.write"],
        ["filesystem-write", "ConditionalReceiverClassB.write"],
        ["filesystem-write", "LogicalReceiverClassA.write"],
        ["filesystem-write", "LogicalReceiverClassB.write"],
        ["filesystem-write", "ConditionalPropertyClassA.write"],
        ["filesystem-write", "ConditionalPropertyClassB.write"],
        ["filesystem-write", "ConditionalVariableClassA.write"],
        ["filesystem-write", "ConditionalVariableClassB.write"],
        ["filesystem-write", "SequenceReceiverClass.write"],
        ["filesystem-write", "ExactDefaultClass.write"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
class LocalHolderClass {}
const holder = { Receiver: {} };
const HolderAlias = holder.Receiver;
HolderAlias.write = Deno.writeTextFile;
LocalHolderClass.write("local-holder.txt", "x");

class LocalDirectHolderClass {}
const directHolder = { Receiver: {} };
directHolder.Receiver.write = Deno.writeTextFile;
LocalDirectHolderClass.write("local-direct-holder.txt", "x");

class LocalDestructuredClass {}
const { Receiver: DestructuredAlias } = { Receiver: {} };
DestructuredAlias.write = Deno.writeTextFile;
LocalDestructuredClass.write("local-destructured.txt", "x");

class LocalComputedClass {}
const computedKey = "Receiver";
const computedHolder = { Receiver: {} };
const ComputedAlias = computedHolder[computedKey];
ComputedAlias.write = Deno.writeTextFile;
LocalComputedClass.write("local-computed.txt", "x");
`,
        "src/local-class-receiver-object-aliases.test.ts",
      ),
      [],
    );
  });

  it("preserves namespace aliases through conditional and logical assignment receivers", () => {
    assertEquals(
      collectSemanticMarkers(
        `
class ConditionalReceiverA {}
class ConditionalReceiverB {}
const conditionalA = { Receiver: ConditionalReceiverA };
const conditionalB = { Receiver: ConditionalReceiverB };
(maybe ? conditionalA.Receiver : conditionalB.Receiver).write =
  Deno.writeTextFile;
ConditionalReceiverA.write("conditional-a.txt", "x");
ConditionalReceiverB.write("conditional-b.txt", "x");

class LogicalReceiverA {}
class LogicalReceiverB {}
const logicalA = { Receiver: LogicalReceiverA };
const logicalB = { Receiver: LogicalReceiverB };
(maybe && logicalA.Receiver || logicalB.Receiver).write = Deno.writeTextFile;
LogicalReceiverA.write("logical-a.txt", "x");
LogicalReceiverB.write("logical-b.txt", "x");
`,
        "src/alternative-assignment-receivers.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "ConditionalReceiverA.write"],
        ["filesystem-write", "ConditionalReceiverB.write"],
        ["filesystem-write", "LogicalReceiverA.write"],
        ["filesystem-write", "LogicalReceiverB.write"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
class LocalConditionalA {}
class LocalConditionalB {}
const conditionalA = { Receiver: {} };
const conditionalB = { Receiver: {} };
(maybe ? conditionalA.Receiver : conditionalB.Receiver).write =
  Deno.writeTextFile;
LocalConditionalA.write("local-conditional-a.txt", "x");
LocalConditionalB.write("local-conditional-b.txt", "x");

class LocalLogicalA {}
class LocalLogicalB {}
const logicalA = { Receiver: {} };
const logicalB = { Receiver: {} };
(maybe && logicalA.Receiver || logicalB.Receiver).write = Deno.writeTextFile;
LocalLogicalA.write("local-logical-a.txt", "x");
LocalLogicalB.write("local-logical-b.txt", "x");
`,
        "src/local-alternative-assignment-receivers.test.ts",
      ),
      [],
    );
  });

  it("retains possible runtime alias effects from conditional assignments", () => {
    assertEquals(
      collectSemanticMarkers(
        `
let conditionalTarget;
if (maybe) {
  conditionalTarget = Deno.writeTextFile;
} else {
  conditionalTarget = fetch;
}
await conditionalTarget("conditional.txt", "x");
const conditionalExpressionTarget = maybe ? fetch : Deno.writeTextFile;
await conditionalExpressionTarget("conditional-expression.txt", "x");
const logicalExpressionTarget = maybe && fetch || Deno.writeTextFile;
await logicalExpressionTarget("logical-expression.txt", "x");

let sequentialTarget;
sequentialTarget = Deno.writeTextFile;
sequentialTarget = fetch;
await sequentialTarget("https://example.com/sequential");

var sequentialVarTarget = Deno.writeTextFile;
sequentialVarTarget = fetch;
await sequentialVarTarget("https://example.com/sequential-var");

if (maybe) {
  var conditionalVarTarget = Deno.writeTextFile;
} else {
  conditionalVarTarget = fetch;
}
await conditionalVarTarget("conditional-var.txt", "x");

if (flag) var run = fetch;
else var run = Deno.writeTextFile;
await run("bare-if.txt", "x");

switch (kind) {
  case "network":
    var switchTarget = fetch;
    break;
  default:
    switchTarget = Deno.writeTextFile;
}
await switchTarget("switch.txt", "x");

let loopTarget = fetch;
while (maybe) {
  loopTarget = Deno.writeTextFile;
}
await loopTarget("loop.txt", "x");

let forTarget = fetch;
for (; maybe; forTarget = Deno.writeTextFile) {
  forTarget = Deno.writeTextFile;
}
await forTarget("for.txt", "x");

let forInTarget = fetch;
for (forInTarget in source) {}
await forInTarget("for-in.txt", "x");

let tryTarget = fetch;
try {
  tryTarget = Deno.writeTextFile;
} catch {
  tryTarget = Deno.writeTextFile;
} finally {
  tryTarget("try-finally.txt", "x");
}
await tryTarget("try.txt", "x");
`,
        "src/conditional-runtime-aliases.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "conditionalTarget"],
        ["network", "conditionalTarget"],
        ["filesystem-write", "conditionalExpressionTarget"],
        ["network", "conditionalExpressionTarget"],
        ["filesystem-write", "logicalExpressionTarget"],
        ["network", "logicalExpressionTarget"],
        ["network", "sequentialTarget"],
        ["network", "sequentialVarTarget"],
        ["filesystem-write", "conditionalVarTarget"],
        ["network", "conditionalVarTarget"],
        ["filesystem-write", "run"],
        ["network", "run"],
        ["filesystem-write", "switchTarget"],
        ["network", "switchTarget"],
        ["filesystem-write", "loopTarget"],
        ["network", "loopTarget"],
        ["filesystem-write", "forTarget"],
        ["network", "forTarget"],
        ["network", "forInTarget"],
        ["filesystem-write", "tryTarget"],
        ["network", "tryTarget"],
        ["filesystem-write", "tryTarget"],
        ["network", "tryTarget"],
      ],
    );
  });

  it("propagates runtime aliases from destructuring assignments", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import * as fs from "node:fs";
let request;
({ fetch: request } = globalThis);
await request("https://example.com");
let write;
({ writeTextFile: write } = Deno);
await write("tmp.txt", "x");
let runtimeRest;
({ ...runtimeRest } = globalThis);
await runtimeRest.fetch("https://example.com/rest");
let denoRest;
({ ...denoRest } = Deno);
await denoRest.writeTextFile("rest.txt", "x");
let clearedRequest = fetch;
const clearedOps = { run: fetch };
clearedOps.run = () => undefined;
({ run: clearedRequest } = clearedOps);
clearedRequest("https://example.com/cleared");
let clearedWrite = fs.writeFileSync;
const clearedSpread = { ...fs };
clearedSpread.writeFileSync = () => undefined;
({ writeFileSync: clearedWrite } = clearedSpread);
clearedWrite("not-a-write.txt", "x");
let possibleRequest = fetch;
const conditionallyCleared = { run: fetch };
if (maybe) conditionallyCleared.run = () => undefined;
({ run: possibleRequest } = conditionallyCleared);
await possibleRequest("https://example.com/possible");
let restoredRequest;
const restoredOps = { run: () => undefined };
restoredOps.run = fetch;
({ run: restoredRequest } = restoredOps);
await restoredRequest("https://example.com/restored");
`,
        "src/destructured-assigned-runtime-aliases.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["network", "request"],
        ["filesystem-write", "write"],
        ["network", "runtimeRest.fetch"],
        ["filesystem-write", "denoRest.writeTextFile"],
        ["network", "possibleRequest"],
        ["network", "restoredRequest"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
const globalThis = { fetch: () => undefined };
let request;
({ fetch: request } = globalThis);
request("https://example.com");
const Deno = { writeTextFile: () => undefined };
let write;
({ writeTextFile: write } = Deno);
write("tmp.txt", "x");
`,
        "src/shadowed-destructured-assigned-runtime-aliases.test.ts",
      ),
      [],
    );
  });

  it("propagates runtime aliases from destructuring defaults", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const declarationOps = {};
const { run: declarationRun = fetch } = declarationOps;
await declarationRun("https://example.com/declaration-default");
let assignmentRun;
const assignmentOps = {};
({ run: assignmentRun = fetch } = assignmentOps);
await assignmentRun("https://example.com/assignment-default");
let nestedRun;
const nestedOps = { child: {} };
({ child: { run: nestedRun = fetch } } = nestedOps);
await nestedRun("https://example.com/nested-default");
const undefinedOps = { run: () => undefined };
undefinedOps.run = undefined;
const { run: undefinedRun = fetch } = undefinedOps;
await undefinedRun("https://example.com/undefined-default");
const conditionalExpressionOps = {
  run: maybe ? Deno.writeTextFile : undefined,
};
const { run: conditionalExpressionRun = fetch } = conditionalExpressionOps;
await conditionalExpressionRun("conditional-expression-default.txt", "x");
const conditionalLocalExpressionOps = {
  run: maybe ? (() => undefined) : undefined,
};
const { run: conditionalLocalExpressionRun = fetch } =
  conditionalLocalExpressionOps;
await conditionalLocalExpressionRun(
  "https://example.com/conditional-local-expression-default",
);
let mutableRun = () => undefined;
mutableRun = undefined;
const mutableOps = { run: mutableRun };
const { run: mutableDefaultRun = fetch } = mutableOps;
await mutableDefaultRun("https://example.com/mutable-undefined-default");
let conditionalRun = () => undefined;
if (maybe) conditionalRun = undefined;
const conditionalOps = { run: conditionalRun };
const { run: conditionalDefaultRun = fetch } = conditionalOps;
await conditionalDefaultRun("https://example.com/conditional-undefined-default");
let destructuredRun = () => undefined;
({ value: destructuredRun } = { value: undefined });
const destructuredOps = { run: destructuredRun };
const { run: destructuredDefaultRun = fetch } = destructuredOps;
await destructuredDefaultRun("https://example.com/destructured-undefined-default");
let nestedDestructuredRun = () => undefined;
({ outer: { value: nestedDestructuredRun } } = {
  outer: { value: undefined },
});
const nestedDestructuredOps = { run: nestedDestructuredRun };
const { run: nestedDestructuredDefaultRun = fetch } = nestedDestructuredOps;
await nestedDestructuredDefaultRun("https://example.com/nested-destructured-undefined-default");
let arrayDestructuredRun = () => undefined;
[arrayDestructuredRun] = [undefined];
const arrayDestructuredOps = { run: arrayDestructuredRun };
const { run: arrayDestructuredDefaultRun = fetch } = arrayDestructuredOps;
await arrayDestructuredDefaultRun("https://example.com/array-destructured-undefined-default");
`,
        "src/destructuring-default-runtime-aliases.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["network", "declarationRun"],
        ["network", "assignmentRun"],
        ["network", "nestedRun"],
        ["network", "undefinedRun"],
        ["filesystem-write", "conditionalExpressionRun"],
        ["network", "conditionalExpressionRun"],
        ["network", "conditionalLocalExpressionRun"],
        ["network", "mutableDefaultRun"],
        ["network", "conditionalDefaultRun"],
        ["network", "destructuredDefaultRun"],
        ["network", "nestedDestructuredDefaultRun"],
        ["network", "arrayDestructuredDefaultRun"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
const declarationOps = { run: () => undefined };
const { run: declarationRun = fetch } = declarationOps;
await declarationRun("https://example.com/declaration-local-property");
let assignmentRun = () => undefined;
const assignmentOps = { run: () => undefined };
({ run: assignmentRun = fetch } = assignmentOps);
await assignmentRun("https://example.com/assignment-local-property");
let nestedRun;
const nestedOps = { child: { run: () => undefined } };
({ child: { run: nestedRun = fetch } } = nestedOps);
await nestedRun("https://example.com/nested-local-property");
const assignedOps = {};
assignedOps.run = () => undefined;
const { run: assignedRun = fetch } = assignedOps;
await assignedRun("https://example.com/assigned-local-property");
const effectOps = { run: fetch };
const spreadOps = { ...effectOps, run: () => undefined };
const { run: spreadRun = fetch } = spreadOps;
await spreadRun("https://example.com/spread-local-property");
const localRun = () => undefined;
const identifierOps = { run: localRun };
const { run: identifierRun = fetch } = identifierOps;
await identifierRun("https://example.com/identifier-local-property");
function declaredRun() {}
const nestedIdentifierOps = { child: { run: declaredRun } };
const { child: { run: declaredIdentifierRun = fetch } } = nestedIdentifierOps;
await declaredIdentifierRun("https://example.com/declared-local-property");
const shorthandRun = () => undefined;
const shorthandOps = { shorthandRun };
const { shorthandRun: selectedShorthandRun = fetch } = shorthandOps;
await selectedShorthandRun("https://example.com/shorthand-local-property");
let assignedIdentifierRun = fetch;
({ run: assignedIdentifierRun = fetch } = identifierOps);
await assignedIdentifierRun("https://example.com/assigned-identifier-property");
const spreadIdentifierOps = { ...effectOps, run: localRun };
const { run: spreadIdentifierRun = fetch } = spreadIdentifierOps;
await spreadIdentifierRun("https://example.com/spread-identifier-property");
let restoredIdentifierRun = undefined;
({ value: restoredIdentifierRun } = { value: () => undefined });
const restoredIdentifierOps = { run: restoredIdentifierRun };
const { run: selectedRestoredRun = fetch } = restoredIdentifierOps;
await selectedRestoredRun("https://example.com/restored-identifier-property");
const { value: declaredIdentifierValue } = { value: () => undefined };
const declaredIdentifierOps = { run: declaredIdentifierValue };
const { run: selectedDeclaredValue = fetch } = declaredIdentifierOps;
await selectedDeclaredValue("https://example.com/declared-identifier-property");
`,
        "src/local-property-destructuring-defaults.test.ts",
      ),
      [],
    );
    assertEquals(
      collectSemanticMarkers(
        `
function local(fetch: () => Promise<Response>) {
  const declarationOps = {};
  const { run: declarationRun = fetch } = declarationOps;
  declarationRun("https://example.com/declaration-default");
  let assignmentRun;
  const assignmentOps = {};
  ({ run: assignmentRun = fetch } = assignmentOps);
  assignmentRun("https://example.com/assignment-default");
}
`,
        "src/shadowed-destructuring-default-runtime-aliases.test.ts",
      ),
      [],
    );
    assertEquals(
      collectSemanticMarkers(
        `
const conditionalEffectOps = { run: fetch };
if (maybe) conditionalEffectOps.run = undefined;
const { run: conditionalEffectRun = Deno.writeTextFile } = conditionalEffectOps;
await conditionalEffectRun("conditional-effect.txt", "x");
let assignedConditionalEffectRun;
({ run: assignedConditionalEffectRun = Deno.writeTextFile } = conditionalEffectOps);
await assignedConditionalEffectRun("assigned-conditional-effect.txt", "x");
const conditionalLocalOps = { run: () => undefined };
if (maybe) conditionalLocalOps.run = undefined;
const { run: conditionalLocalRun = fetch } = conditionalLocalOps;
await conditionalLocalRun("https://example.com/conditional-local-default");
const blockEffectOps = { run: fetch };
{
  blockEffectOps.run = undefined;
}
const { run: blockEffectRun = Deno.writeTextFile } = blockEffectOps;
await blockEffectRun("block-effect.txt", "x");
const earlierCrossFunctionOps = { run: fetch };
function clearEarlierCrossFunctionOps() {
  earlierCrossFunctionOps.run = undefined;
}
earlierCrossFunctionOps.run = () => undefined;
clearEarlierCrossFunctionOps();
const { run: earlierCrossFunctionRun = Deno.writeTextFile } = earlierCrossFunctionOps;
await earlierCrossFunctionRun("earlier-cross-function.txt", "x");
const laterCrossFunctionOps = { run: () => undefined };
laterCrossFunctionOps.run = () => undefined;
function clearLaterCrossFunctionOps() {
  laterCrossFunctionOps.run = undefined;
}
clearLaterCrossFunctionOps();
const { run: laterCrossFunctionRun = Deno.writeTextFile } = laterCrossFunctionOps;
await laterCrossFunctionRun("later-cross-function.txt", "x");
const siblingOps = { a: fetch, b: fetch };
function clearSiblingA() {
  siblingOps.a = undefined;
}
siblingOps.b = () => undefined;
const { b: siblingRun = Deno.writeTextFile } = siblingOps;
await siblingRun("sibling.txt", "x");
const nestedSiblingOps = { child: { a: fetch, b: fetch } };
function clearNestedSiblingA() {
  nestedSiblingOps.child.a = undefined;
}
nestedSiblingOps.child.b = () => undefined;
const { b: nestedSiblingRun = Deno.writeTextFile } = nestedSiblingOps.child;
await nestedSiblingRun("nested-sibling.txt", "x");
const parentReplacementOps = { child: { run: () => undefined } };
function replaceParentOps() {
  parentReplacementOps.child = { run: fetch };
}
parentReplacementOps.child.run = () => undefined;
replaceParentOps();
const { run: parentReplacementRun = Deno.writeTextFile } = parentReplacementOps.child;
await parentReplacementRun("parent-replacement.txt", "x");
const parentDefaultOps = { child: { run: () => undefined } };
function clearParentDefaultOps() {
  parentDefaultOps.child = { run: undefined };
}
parentDefaultOps.child.run = () => undefined;
clearParentDefaultOps();
const { run: parentDefaultRun = Deno.writeTextFile } = parentDefaultOps.child;
await parentDefaultRun("parent-default.txt", "x");
`,
        "src/conditional-member-destructuring-defaults.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "conditionalEffectRun"],
        ["network", "conditionalEffectRun"],
        ["filesystem-write", "assignedConditionalEffectRun"],
        ["network", "assignedConditionalEffectRun"],
        ["network", "conditionalLocalRun"],
        ["filesystem-write", "blockEffectRun"],
        ["filesystem-write", "earlierCrossFunctionRun"],
        ["network", "earlierCrossFunctionRun"],
        ["filesystem-write", "laterCrossFunctionRun"],
        ["network", "parentReplacementRun"],
        ["filesystem-write", "parentDefaultRun"],
      ],
    );
  });

  it("propagates conditional runtime object properties through destructuring", () => {
    assertEquals(
      collectSemanticMarkers(
        `
let runtimeObject = globalThis;
if (maybe) runtimeObject = Deno;
const { fetch: maybeFetch, writeTextFile: maybeWrite } = runtimeObject;
await maybeFetch("https://example.com/maybe");
await maybeWrite("maybe.txt", "x");
`,
        "src/conditional-runtime-object-destructuring.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["network", "maybeFetch"],
        ["filesystem-write", "maybeWrite"],
      ],
    );
  });

  it("preserves effectful callables through call, apply, and bind", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
await fetch.call(globalThis, "https://example.com/call");
await fetch.apply(globalThis, ["https://example.com/apply"]);
const boundFetch = fetch.bind(globalThis);
await boundFetch("https://example.com/bound");
await fetch.bind(globalThis)("https://example.com/direct-bound");
await Deno.writeTextFile.call(Deno, "tmp.txt", "x");
const boundWrite = Deno.writeTextFile.bind(Deno);
await boundWrite("tmp.txt", "x");
await Deno.writeTextFile.bind(Deno)("direct-bound.txt", "x");
await writeFile.bind(null)("imported-bound.txt", "x");
spawn.bind(null)("deno", ["--version"]);
await Deno.open.call(Deno, "read.txt", { read: true, write: false });
await Deno.open.apply(Deno, ["write.txt", { write: true }]);
const boundOpen = Deno.open.bind(Deno);
await boundOpen("bound-read.txt", { read: true, write: false });
const boundOpenWrite = Deno.open.bind(Deno);
await boundOpenWrite("bound-write.txt", { write: true });
const preboundOpenRead = Deno.open.bind(Deno, "prebound-read.txt");
await preboundOpenRead({ read: true, write: false });
const preboundOpenWrite = Deno.open.bind(
  Deno,
  "prebound-write.txt",
  { write: true, create: true },
);
await preboundOpenWrite();
await Deno.open.bind(
  Deno,
  "direct-prebound-write.txt",
  { write: true, create: true },
)();
const unknownOpenArguments: unknown[] = [];
await Deno.open.bind(Deno, ...unknownOpenArguments)();
await Deno.open.call(Deno, ...unknownOpenArguments);

let conditionalCallable = fetch;
if (maybe) conditionalCallable = Deno.writeTextFile;
await conditionalCallable.call(globalThis, "conditional-call.txt", "x");
await conditionalCallable.apply(globalThis, ["conditional-apply.txt", "x"]);
const conditionalBoundCallable = conditionalCallable.bind(globalThis);
await conditionalBoundCallable("conditional-bound.txt", "x");

let conditionalOpen = Deno.open.bind(Deno, "conditional-read.txt", {
  read: true,
  write: false,
});
if (maybe) {
  conditionalOpen = Deno.open.bind(Deno, "conditional-write.txt", {
    write: true,
  });
}
await conditionalOpen();
`,
        "src/runtime-call-apply-bind.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["network", "fetch.call"],
        ["network", "fetch.apply"],
        ["network", "boundFetch"],
        ["network", "fetch.bind"],
        ["filesystem-write", "Deno.writeTextFile.call"],
        ["filesystem-write", "boundWrite"],
        ["filesystem-write", "Deno.writeTextFile.bind"],
        ["filesystem-write", "writeFile.bind"],
        ["process", "spawn.bind"],
        ["filesystem-read", "Deno.open.call"],
        ["filesystem-write", "Deno.open.apply"],
        ["filesystem-read", "boundOpen"],
        ["filesystem-write", "boundOpenWrite"],
        ["filesystem-read", "preboundOpenRead"],
        ["filesystem-write", "preboundOpenWrite"],
        ["filesystem-write", "Deno.open.bind"],
        ["filesystem-write", "Deno.open.bind"],
        ["filesystem-write", "Deno.open.call"],
        ["filesystem-write", "conditionalCallable.call"],
        ["network", "conditionalCallable.call"],
        ["filesystem-write", "conditionalCallable.apply"],
        ["network", "conditionalCallable.apply"],
        ["filesystem-write", "conditionalBoundCallable"],
        ["network", "conditionalBoundCallable"],
        ["filesystem-read", "conditionalOpen"],
        ["filesystem-write", "conditionalOpen"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
function fetch() {}
fetch.call(null, "https://example.com");
const boundFetch = fetch.bind(null);
boundFetch("https://example.com");
const Deno = { writeTextFile: () => ({ bind: () => () => undefined }) };
const boundWrite = Deno.writeTextFile.bind(Deno);
boundWrite("tmp.txt", "x");
`,
        "src/shadowed-runtime-call-apply-bind.test.ts",
      ),
      [],
    );
  });

  it("classifies Reflect invocation of effectful callables", () => {
    assertEquals(
      collectSemanticMarkers(
        `
Reflect.apply(fetch, globalThis, ["https://example.com/reflect"]);
Reflect.apply(Deno.writeTextFile, Deno, ["tmp.txt", "x"]);
Reflect.apply(Deno.open, Deno, ["read.txt", { read: true, write: false }]);
Reflect.apply(Deno.open, Deno, ["write.txt", { write: true }]);
Reflect.construct(Worker, ["worker.js"]);
Reflect.construct(WebSocket, ["wss://example.com"]);
globalThis.Reflect.apply(fetch, globalThis, ["https://example.com/global"]);
window.Reflect.apply(Deno.open, Deno, ["global-read.txt", {
  read: true,
  write: false,
}]);
self.Reflect.construct(Worker, ["global-worker.js"]);
const invoke = Reflect.apply;
invoke(fetch, globalThis, ["https://example.com/invoke"]);
const { construct } = Reflect;
construct(Worker, ["worker-alias.js"]);
let assignedInvoke;
assignedInvoke = globalThis.Reflect.apply;
assignedInvoke(Deno.open, Deno, ["assigned-read.txt", {
  read: true,
  write: false,
}]);
const boundInvoke = Reflect.apply.bind(Reflect, fetch, globalThis);
boundInvoke(["https://example.com/bound"]);
Reflect.apply.call(Reflect, Deno.writeTextFile, Deno, ["called.txt", "x"]);
Reflect.apply.apply(Reflect, [Deno.open, Deno, ["applied-read.txt", {
  read: true,
  write: false,
}]]);
const boundConstruct = Reflect.construct.bind(Reflect);
boundConstruct(Worker, ["bound-worker.js"]);
`,
        "src/reflect-runtime-invocation.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["network", "Reflect.apply(fetch)"],
        ["filesystem-write", "Reflect.apply(Deno.writeTextFile)"],
        ["filesystem-read", "Reflect.apply(Deno.open)"],
        ["filesystem-write", "Reflect.apply(Deno.open)"],
        ["process", "Reflect.construct(Worker)"],
        ["network", "Reflect.construct(WebSocket)"],
        ["network", "globalThis.Reflect.apply(fetch)"],
        ["filesystem-read", "window.Reflect.apply(Deno.open)"],
        ["process", "self.Reflect.construct(Worker)"],
        ["network", "invoke(fetch)"],
        ["process", "construct(Worker)"],
        ["filesystem-read", "assignedInvoke(Deno.open)"],
        ["network", "boundInvoke(fetch)"],
        ["filesystem-write", "Reflect.apply.call(Deno.writeTextFile)"],
        ["filesystem-read", "Reflect.apply.apply(Deno.open)"],
        ["process", "boundConstruct(Worker)"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
const Reflect = { apply() {}, construct() {} };
Reflect.apply(fetch, globalThis, ["https://example.com/reflect"]);
Reflect.construct(Worker, ["worker.js"]);
function localGlobalThis(globalThis: { Reflect: typeof Reflect }) {
  globalThis.Reflect.apply(fetch, globalThis, ["https://example.com/local"]);
}
function localWindow(window: { Reflect: typeof Reflect }) {
  window.Reflect.apply(Deno.open, Deno, ["local.txt", { write: true }]);
}
function localSelf(self: { Reflect: typeof Reflect }) {
  self.Reflect.construct(Worker, ["worker.js"]);
}
const invoke = Reflect.apply;
invoke(fetch, globalThis, ["https://example.com/local"]);
const { construct } = Reflect;
construct(Worker, ["worker.js"]);
const boundInvoke = Reflect.apply.bind(Reflect, fetch, globalThis);
boundInvoke(["https://example.com/local"]);
Reflect.apply.call(Reflect, fetch, globalThis, ["https://example.com/local"]);
Reflect.apply.apply(Reflect, [fetch, globalThis, ["https://example.com/local"]]);
const boundConstruct = Reflect.construct.bind(Reflect);
boundConstruct(Worker, ["worker.js"]);
`,
        "src/shadowed-reflect-runtime-invocation.test.ts",
      ),
      [],
    );
  });

  it("propagates runtime aliases through switch and static-block scopes", () => {
    assertEquals(
      collectSemanticMarkers(
        `
switch (mode) {
  case "write":
    const writeFromSwitch = Deno.writeTextFile;
    writeFromSwitch("tmp.txt", "x");
    break;
}
class RuntimeWriter {
  static {
    const writeFromStatic = Deno.writeTextFile;
    writeFromStatic("tmp.txt", "x");
    var staticBlockWrite;
    staticBlockWrite = Deno.writeTextFile;
    staticBlockWrite("static-block.txt", "x");
  }
}
staticBlockWrite("outside-static-block.txt", "x");
`,
        "src/scoped-runtime-aliases.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "writeFromSwitch"],
        ["filesystem-write", "writeFromStatic"],
        ["filesystem-write", "staticBlockWrite"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
switch (mode) {
  case "local":
    const Deno = { writeTextFile: () => undefined };
    const writeFromSwitch = Deno.writeTextFile;
    writeFromSwitch("tmp.txt", "x");
}
`,
        "src/shadowed-scoped-runtime-aliases.test.ts",
      ),
      [],
    );
  });

  it("treats loop headers as lexical scopes for runtime names", () => {
    assertEquals(
      collectSemanticMarkers(
        `
for (const Deno of [{ writeTextFile: () => undefined }]) {
  Deno.writeTextFile("tmp.txt", "x");
}
for (const process of [{ exit: () => undefined }]) {
  process.exit(0);
}
`,
        "src/loop-shadowing.test.ts",
      ),
      [],
    );
  });

  it("stops fixture lookup at the innermost shadowing declaration", () => {
    assertEquals(
      collectSemanticMarkers(
        `
function outer({ page }: { page: { goto(path: string): void } }) {
  page.goto("/outer");
  function inner(page: { goto(path: string): void }) {
    page.goto("/inner");
  }
  inner(page);
}
`,
        "src/fixture-shadowing.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [["browser", "page.goto"]],
    );
  });

  it("ignores locally shadowed require and createRequire helpers", () => {
    assertEquals(
      collectSemanticMarkers(
        `
function require(_specifier: string) {
  return { readFile: () => "fake" };
}
function createRequire(_url: string) {
  return () => ({ spawn: () => undefined });
}
const fs = require("node:fs");
const childProcess = createRequire("local")("node:child_process");
fs.readFile("fixture");
childProcess.spawn();
`,
        "src/local-loaders.test.ts",
      ),
      [],
    );
  });

  it("binds named function and class expressions in their own scopes", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const recurse = function fetch(count: number): number {
  return count > 0 ? fetch(count - 1) : count;
};
const LocalWorker = class Worker {
  clone() {
    return new Worker();
  }
};
`,
        "src/named-expression-scope.test.ts",
      ),
      [],
    );
  });

  it("classifies process-global environment and runtime mutation", () => {
    const markers = collectSemanticMarkers(
      `
const original = Deno.env.get("MODE");
Deno.env.set("MODE", "test");
Deno.env.delete("MODE");
process.env.MODE = "test";
delete process.env.MODE;
const current = process.env.MODE;
Deno.exit(1);
Deno.addSignalListener("SIGINT", () => undefined);
Deno.removeSignalListener("SIGINT", () => undefined);
Object.defineProperty(globalThis, "process", { value: {} });
Reflect.deleteProperty(globalThis, "Deno");
const runtimeProcess = (globalThis as { process?: unknown }).process;
globalThis.process.exit(1);
window.process.chdir("/");
self.process.kill(1);
(Deno as unknown as { exit: (code: number) => never }).exit = () => {
  throw new Error("stub");
};
`,
      "src/process-state.test.ts",
    );

    assertEquals(
      markers.map((marker) => [marker.effect, marker.line, marker.symbol]),
      [
        ["process", 2, "Deno.env"],
        ["process", 3, "Deno.env"],
        ["process", 4, "Deno.env"],
        ["process", 5, "process.env"],
        ["process", 6, "process.env"],
        ["process", 7, "process.env"],
        ["process", 8, "Deno.exit"],
        ["process", 9, "Deno.addSignalListener"],
        ["process", 10, "Deno.removeSignalListener"],
        ["process", 11, "Object.defineProperty(globalThis.process)"],
        ["process", 12, "Reflect.deleteProperty(globalThis.Deno)"],
        ["process", 13, "globalThis.process"],
        ["process", 14, "globalThis.process.exit"],
        ["shared-cwd", 15, "window.process.chdir"],
        ["process", 16, "self.process.kill"],
        ["process", 17, "Deno.exit"],
      ],
    );
  });

  it("classifies Deno and Node process termination", () => {
    assertEquals(
      collectSemanticMarkers(
        `
Deno.kill(123, "SIGTERM");
process.kill(123, "SIGTERM");
`,
        "src/process-termination.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["process", "Deno.kill"],
        ["process", "process.kill"],
      ],
    );
  });

  it("classifies mutation of global runtime members through direct and aliased receivers", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const originalStat = Deno.stat;
Deno.stat = originalStat;
const denoRuntime = Deno;
denoRuntime.noColor = false;
const processRuntime = process;
processRuntime.title = "veryfront-test";
`,
        "src/global-runtime-member-mutation.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["process", "Deno.stat"],
        ["process", "denoRuntime.noColor"],
        ["process", "processRuntime.title"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
function local(
  Deno: { stat: unknown; noColor: boolean },
  process: { title: string },
) {
  Deno.stat = undefined;
  const denoRuntime = Deno;
  denoRuntime.noColor = false;
  const processRuntime = process;
  processRuntime.title = "local";
}
`,
        "src/shadowed-global-runtime-member-mutation.test.ts",
      ),
      [],
    );
  });

  it("classifies unshadowed global Worker construction as process debt", () => {
    assertEquals(
      collectSemanticMarkers(
        `
new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
`,
        "src/global-worker.test.ts",
      ).map((marker) => [marker.effect, marker.line, marker.symbol]),
      [["process", 2, "Worker"]],
    );
    assertEquals(
      collectSemanticMarkers(
        `
class Worker {
  constructor(_url: URL, _options: { type: string }) {}
}
new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
`,
        "src/local-worker.test.ts",
      ),
      [],
    );
    assertEquals(
      collectSemanticMarkers(
        `import { Worker } from "./worker.ts";
new Worker();`,
        "src/imported-worker.test.ts",
      ),
      [],
    );
    assertEquals(
      collectSemanticMarkers(
        `
new globalThis.Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});
new window.Worker(new URL("./worker.ts", import.meta.url));
new self.Worker(new URL("./worker.ts", import.meta.url));
`,
        "src/member-global-worker.test.ts",
      ).map((marker) => [marker.effect, marker.line, marker.symbol]),
      [
        ["process", 2, "globalThis.Worker"],
        ["process", 5, "window.Worker"],
        ["process", 6, "self.Worker"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
function createWorker(globalThis: { Worker: new () => unknown }) {
  return new globalThis.Worker();
}
`,
        "src/shadowed-member-global-worker.test.ts",
      ),
      [],
    );
  });

  it("propagates aliased global runtime constructors", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const WorkerCtor = globalThis.Worker;
const DirectWorker = Worker;
const DirectSocket = WebSocket;
const runtime = window;
const { Worker: WindowWorker, WebSocket: Socket } = runtime;
new WorkerCtor("./worker.ts");
new DirectWorker("./worker.ts");
new DirectSocket("ws://localhost/socket");
new WindowWorker("./worker.ts");
new Socket("ws://localhost/socket");
new runtime.WebSocket("ws://localhost/socket");
`,
        "src/aliased-runtime-constructors.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["process", "WorkerCtor"],
        ["process", "DirectWorker"],
        ["network", "DirectSocket"],
        ["process", "WindowWorker"],
        ["network", "Socket"],
        ["network", "runtime.WebSocket"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
function local(window: { Worker: new () => unknown }) {
  const WorkerCtor = window.Worker;
  return new WorkerCtor();
}
`,
        "src/shadowed-aliased-runtime-constructor.test.ts",
      ),
      [],
    );
  });

  it("classifies Node worker_threads constructors as process debt", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import { Worker as ImportedWorker } from "node:worker_threads";
import * as workerThreads from "node:worker_threads";
new ImportedWorker("./worker.js");
new workerThreads.Worker("./worker.js");
const { Worker: DynamicWorker } = await import("node:worker_threads");
new DynamicWorker("./worker.js");
`,
        "src/node-worker-threads.test.ts",
      ).map((marker) => [marker.effect, marker.line, marker.symbol]),
      [
        ["process", 4, "ImportedWorker"],
        ["process", 5, "workerThreads.Worker"],
        ["process", 7, "DynamicWorker"],
      ],
    );
  });

  it("classifies unshadowed global WebSocket construction as network debt", () => {
    assertEquals(
      collectSemanticMarkers(
        `
new WebSocket("ws://localhost/socket");
new globalThis.WebSocket("ws://localhost/socket");
new window.WebSocket("ws://localhost/socket");
new self.WebSocket("ws://localhost/socket");
new EventSource("https://localhost/events");
new XMLHttpRequest();
`,
        "src/global-websocket.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["network", "WebSocket"],
        ["network", "globalThis.WebSocket"],
        ["network", "window.WebSocket"],
        ["network", "self.WebSocket"],
        ["network", "EventSource"],
        ["network", "XMLHttpRequest"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
class WebSocket {}
new WebSocket();
function connect(globalThis: { WebSocket: new () => unknown }) {
  return new globalThis.WebSocket();
}
`,
        "src/shadowed-websocket.test.ts",
      ),
      [],
    );
    assertEquals(
      collectSemanticMarkers(
        `import { WebSocket } from "./socket.ts";
new WebSocket();`,
        "src/imported-websocket.test.ts",
      ),
      [],
    );
  });

  it("classifies typed aliases of global runtime objects", () => {
    const markers = collectSemanticMarkers(
      `
const denoRuntime = Deno as unknown as {
  serve: typeof Deno.serve;
  addSignalListener: typeof Deno.addSignalListener;
  removeSignalListener: typeof Deno.removeSignalListener;
  exit: typeof Deno.exit;
};
denoRuntime.serve = () => fakeServer;
denoRuntime.addSignalListener = () => undefined;
denoRuntime.removeSignalListener = () => undefined;
denoRuntime.exit = () => {
  throw new Error("stub");
};
const processRuntime = process as {
  env: Record<string, string | undefined>;
  chdir(path: string): void;
};
processRuntime.env.MODE = "test";
processRuntime.chdir("/tmp");
const { serve: serveAlias, exit: exitAlias } = Deno;
serveAlias(() => new Response("ok"));
exitAlias(0);
const { env: processEnv } = process;
const aliasMode = processEnv.MODE;
const localDeno = { serve: () => undefined, exit: () => undefined };
localDeno.serve = () => undefined;
localDeno.exit = () => undefined;
`,
      "src/runtime-alias.test.ts",
    );

    assertEquals(
      markers.map((marker) => [marker.effect, marker.line, marker.symbol]),
      [
        ["process", 8, "denoRuntime.serve"],
        ["process", 9, "denoRuntime.addSignalListener"],
        ["process", 10, "denoRuntime.removeSignalListener"],
        ["process", 11, "denoRuntime.exit"],
        ["process", 18, "processRuntime.env.MODE"],
        ["shared-cwd", 19, "processRuntime.chdir"],
        ["server", 21, "serveAlias"],
        ["process", 22, "exitAlias"],
        ["process", 24, "processEnv.MODE"],
      ],
    );
  });

  it("classifies repository process-environment wrappers", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import {
  deleteEnv,
  env,
  getEnv,
  getHostEnv,
  setEnv,
} from "#veryfront/platform/compat/process.ts";
getEnv("MODE");
setEnv("MODE", "test");
deleteEnv("MODE");
env("MODE");
getHostEnv();
`,
        "src/process-wrapper.test.ts",
      ).map((marker) => [marker.effect, marker.line, marker.symbol]),
      [
        ["process", 9, "getEnv"],
        ["process", 10, "setEnv"],
        ["process", 11, "deleteEnv"],
        ["process", 12, "env"],
        ["process", 13, "getHostEnv"],
      ],
    );
  });

  it("classifies explicit global fetch calls and monkeypatches as network debt", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const originalFetch = globalThis.fetch;
Object.defineProperty(globalThis, "fetch", {
  value: () => Promise.resolve(new Response("ok")),
});
await globalThis.fetch("https://example.com");
Object.defineProperty(globalThis, "fetch", { value: originalFetch });
const local = { fetch: () => undefined };
local.fetch = () => undefined;
`,
        "src/global-fetch.test.ts",
      ).map((marker) => [marker.effect, marker.line, marker.symbol]),
      [
        ["network", 3, "Object.defineProperty(globalThis.fetch)"],
        ["network", 6, "globalThis.fetch"],
        ["network", 7, "Object.defineProperty(globalThis.fetch)"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `const globalThis = { fetch: () => undefined };
Object.defineProperty(globalThis, "fetch", { value: () => undefined });
globalThis.fetch();`,
        "src/local-global-this.test.ts",
      ),
      [],
    );
    assertEquals(
      collectSemanticMarkers(
        `const Object = { defineProperty: () => undefined };
Object.defineProperty(globalThis, "fetch", { value: () => undefined });`,
        "src/local-object.test.ts",
      ),
      [],
    );
  });

  it("skips erased TypeScript nodes while preserving runtime declarations", () => {
    assertEquals(
      collectSemanticMarkers(
        `
interface ErasedRuntimeShape {
  [Deno.env]: string;
}
enum RuntimeEnum {
  Value = Number(Deno.env.get("ENUM_VALUE")),
}
namespace RuntimeNamespace {
  export const value = Deno.env.get("NAMESPACE_VALUE");
}
`,
        "src/typescript-runtime-boundaries.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["process", "Deno.env"],
        ["process", "Deno.env"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
namespace RuntimeAliases {
  export const write = Deno.writeTextFile;
  export const WorkerAlias = Worker;
  export import ImportedWorker = Worker;
  write("namespace-local.txt", "x");
  var namespaceVarWrite;
  namespaceVarWrite = Deno.writeTextFile;
  namespaceVarWrite("namespace-var-local.txt", "x");
}
RuntimeAliases.write("namespace-exported.txt", "x");
namespaceVarWrite("namespace-var-outside.txt", "x");
new RuntimeAliases.WorkerAlias("worker.js");
new RuntimeAliases.ImportedWorker("worker.js");
namespace ImportEqualsAliases {
  import localWrite = Deno.writeTextFile;
  localWrite("namespace-import-local.txt", "x");
  export import exportedWrite = Deno.writeTextFile;
}
ImportEqualsAliases.exportedWrite("namespace-import-exported.txt", "x");
import topLevelWrite = ImportEqualsAliases.exportedWrite;
topLevelWrite("namespace-import-top-level.txt", "x");
`,
        "src/typescript-namespace-aliases.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "write"],
        ["filesystem-write", "namespaceVarWrite"],
        ["filesystem-write", "RuntimeAliases.write"],
        ["process", "RuntimeAliases.WorkerAlias"],
        ["process", "RuntimeAliases.ImportedWorker"],
        ["filesystem-write", "localWrite"],
        ["filesystem-write", "ImportEqualsAliases.exportedWrite"],
        ["filesystem-write", "topLevelWrite"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
namespace ExportedAliases {
  export const request = fetch;
}
namespace ExportedAliases {
  export const write = Deno.writeTextFile;
}
namespace ExportedAliases.Nested {
  export const read = Deno.readTextFile;
}
namespace ExportedAliases.Nested {
  export const nestedWrite = Deno.writeTextFile;
}
namespace BlockMerged {
  export namespace Nested {
    export const read = Deno.readTextFile;
  }
}
namespace BlockMerged {
  export namespace Nested {
    export const write = Deno.writeTextFile;
  }
}
namespace MixedMerged.Nested {
  export const read = Deno.readTextFile;
}
namespace MixedMerged {
  export namespace Nested {
    export const write = Deno.writeTextFile;
  }
}
namespace ConditionalMerged {
  export const run = fetch;
}
namespace ConditionalMerged {
  export const run = Deno.writeTextFile;
}
await ExportedAliases.request("https://example.com");
await ExportedAliases.write("namespace-merged.txt", "x");
await ExportedAliases.Nested.read("namespace-nested.txt");
await ExportedAliases.Nested.nestedWrite("namespace-nested.txt", "x");
await BlockMerged.Nested.read("namespace-block-read.txt");
await BlockMerged.Nested.write("namespace-block-write.txt", "x");
await MixedMerged.Nested.read("namespace-mixed-read.txt");
await MixedMerged.Nested.write("namespace-mixed-write.txt", "x");
await ConditionalMerged.run("namespace-conditional.txt", "x");
namespace A {
  export const run = fetch;
}
namespace B {
  export const run = Deno.writeTextFile;
}
let N = A;
if (maybe) N = B;
await N.run("namespace-alternative.txt", "x");
`,
        "src/typescript-namespace-exports.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["network", "ExportedAliases.request"],
        ["filesystem-write", "ExportedAliases.write"],
        ["filesystem-read", "ExportedAliases.Nested.read"],
        ["filesystem-write", "ExportedAliases.Nested.nestedWrite"],
        ["filesystem-read", "BlockMerged.Nested.read"],
        ["filesystem-write", "BlockMerged.Nested.write"],
        ["filesystem-read", "MixedMerged.Nested.read"],
        ["filesystem-write", "MixedMerged.Nested.write"],
        ["filesystem-write", "ConditionalMerged.run"],
        ["network", "ConditionalMerged.run"],
        ["filesystem-write", "N.run"],
        ["network", "N.run"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
namespace ShadowedNamespace {
  const Deno = { writeTextFile: () => undefined };
  export const write = Deno.writeTextFile;
  const Worker = class {};
  export const WorkerAlias = Worker;
  export import ImportedWorker = Worker;
  import importedWrite = Deno.writeTextFile;
  importedWrite("namespace-local.txt", "x");
  export import exportedWrite = Deno.writeTextFile;
}
ShadowedNamespace.write("local.txt", "x");
ShadowedNamespace.exportedWrite("exported-local.txt", "x");
new ShadowedNamespace.WorkerAlias("worker.js");
new ShadowedNamespace.ImportedWorker("worker.js");
`,
        "src/typescript-namespace-shadowing.test.ts",
      ),
      [],
    );
  });

  it("classifies bare global fetch aliases and wrapper expressions without type-only noise", () => {
    assertEquals(
      collectSemanticMarkers(
        `
type PhantomFetch = typeof fetch;
interface PhantomRuntime {
  [Deno.env]: string;
  open: typeof Deno.open;
}
const aliasFetch = fetch;
const aliasAgain = aliasFetch;
await aliasFetch("https://example.com/a");
await aliasAgain("https://example.com/b");
(fetch as typeof globalThis.fetch)("https://example.com/c");
(aliasAgain satisfies typeof fetch)("https://example.com/d");
aliasAgain!("https://example.com/e");
`,
        "src/global-fetch-aliases.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["network", "aliasFetch"],
        ["network", "aliasAgain"],
        ["network", "fetch"],
        ["network", "aliasAgain"],
        ["network", "aliasAgain"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
import { fetch } from "undici";
const importedAlias = fetch;
importedAlias("https://example.com/imported");
function local(fetch: (input: string) => Promise<Response>) {
  const localAlias = fetch;
  localAlias("https://example.com/local");
}
`,
        "src/shadowed-global-fetch-aliases.test.ts",
      ),
      [],
    );
  });

  it("classifies arbitrary shared-global mutations conservatively", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const key = "navigator";
Object.defineProperty(globalThis, key, { value: {} });
Object.defineProperty(globalThis, "XMLHttpRequest", { value: class {} });
Reflect.deleteProperty(globalThis, key);
Object.assign(globalThis, { document: {} });
Reflect.set(globalThis, "WebSocket", class {});
Object.defineProperties(window, { document: { value: {} } });
Reflect.defineProperty(self, key, { value: {} });
Reflect.set(Array.prototype, Symbol.iterator, () => undefined);
Object.defineProperty(Object.prototype, key, { value: {} });
Object.defineProperty(Promise, "resolve", { value: () => undefined });
let assignedTarget = globalThis;
if (maybe) assignedTarget = Deno;
Object.assign(assignedTarget, { fetch() {} });
Reflect.apply(Object.defineProperty, Object, [
  globalThis,
  "fetch",
  { value() {} },
]);
Object.defineProperty.call(Object, globalThis, "fetch", { value() {} });
const def = Object.defineProperty;
def.apply(Object, [globalThis, "fetch", { value() {} }]);
let conditionalDef = Object.defineProperty;
if (maybe) conditionalDef = Reflect.defineProperty;
conditionalDef.call(Object, globalThis, "fetch", { value() {} });
const mutationArgs = [globalThis, "fetch", { value() {} }] as const;
Reflect.apply(Object.defineProperty, Object, mutationArgs);
Object.defineProperty.apply(Object, mutationArgs);
conditionalDef.apply(Object, mutationArgs);
Reflect.apply(conditionalDef, Object, mutationArgs);
Object.defineProperty(...mutationArgs);
Object.defineProperty.call(Object, ...mutationArgs);
String.prototype.trim = () => "";
delete RegExp.prototype.test;
globalThis.window = {} as typeof globalThis;
delete globalThis.navigator;
`,
        "src/global-runtime-mutation.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["process", "Object.defineProperty(globalThis.*)"],
        ["network", "Object.defineProperty(globalThis.XMLHttpRequest)"],
        ["process", "Reflect.deleteProperty(globalThis.*)"],
        ["process", "Object.assign(globalThis.*)"],
        ["network", "Reflect.set(globalThis.WebSocket)"],
        ["process", "Object.defineProperties(window.*)"],
        ["process", "Reflect.defineProperty(self.*)"],
        ["process", "Reflect.set(Array.prototype.*)"],
        ["process", "Object.defineProperty(Object.prototype.*)"],
        ["process", "Object.defineProperty(Promise.resolve)"],
        ["process", "Object.assign(assignedTarget.*)"],
        ["network", "Reflect.apply(Object.defineProperty)(globalThis.fetch)"],
        ["network", "Object.defineProperty.call(globalThis.fetch)"],
        ["network", "def.apply(globalThis.fetch)"],
        ["network", "conditionalDef.call(globalThis.fetch)"],
        ["process", "Reflect.apply(Object.defineProperty)(*)"],
        ["process", "Object.defineProperty.apply(*)"],
        ["process", "conditionalDef.apply(*)"],
        ["process", "Reflect.apply(conditionalDef)(*)"],
        ["process", "Object.defineProperty(*)"],
        ["process", "Object.defineProperty.call(*)"],
        ["process", "String.prototype.trim"],
        ["process", "RegExp.prototype.test"],
        ["process", "globalThis.window"],
        ["process", "globalThis.navigator"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
const Object = { defineProperty: () => undefined };
Object.defineProperty(globalThis, "navigator", { value: {} });
Object.assign(globalThis, { navigator: {} });
const Reflect = { deleteProperty: () => false, set: () => false };
Reflect.deleteProperty(globalThis, "navigator");
Reflect.set(globalThis, "navigator", {});
Reflect.apply(Object.defineProperty, Object, [
  globalThis,
  "fetch",
  { value() {} },
]);
Object.defineProperty.call(Object, globalThis, "fetch", { value() {} });
const def = Object.defineProperty;
def.apply(Object, [globalThis, "fetch", { value() {} }]);
function mutate(globalThis: { window: unknown; navigator?: unknown }) {
  globalThis.window = {};
  delete globalThis.navigator;
}
function mutateIntrinsics(
  Array: { prototype: object },
  Promise: object,
  String: { prototype: { trim(): string } },
) {
  Object.defineProperty(Array.prototype, "x", { value: 1 });
  Object.defineProperty(Promise, "resolve", { value: () => undefined });
  String.prototype.trim = () => "";
}
`,
        "src/local-global-runtime-mutation.test.ts",
      ),
      [],
    );
  });

  it("classifies update mutations on shared and global runtime members", () => {
    assertEquals(
      collectSemanticMarkers(
        `
Array.prototype.counter++;
++Promise.state;
globalThis.sequence++;
window.count--;
`,
        "src/global-update-mutations.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["process", "Array.prototype.counter"],
        ["process", "Promise.state"],
        ["process", "globalThis.sequence"],
        ["process", "window.count"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
function local(Array: { prototype: { counter: number } }, globalThis: { sequence: number }) {
  Array.prototype.counter++;
  globalThis.sequence++;
}
const window = { count: 0 };
window.count++;
`,
        "src/local-global-update-mutations.test.ts",
      ),
      [],
    );
  });

  it("classifies aliased Object and Reflect mutation methods without counting shadowed fakes", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const defineGlobalProperty = Object.defineProperty;
const defineAgain = defineGlobalProperty;
const ObjectAlias = Object;
const defineViaObjectAlias = ObjectAlias.defineProperty;
const defineFromGlobalObject = globalThis.Object.defineProperty;
const { set: reflectSet, deleteProperty: reflectDeleteProperty } = Reflect;
const deleteViaReflect = Reflect.deleteProperty;
let defineRuntimeProperty = Object.defineProperty;
if (maybe) {
  defineRuntimeProperty = Reflect.defineProperty;
}
defineGlobalProperty(globalThis, "fetch", { value: () => undefined });
defineAgain(Map.prototype, "size", { value: 0 });
defineViaObjectAlias(Promise, "resolve", { value: () => undefined });
defineFromGlobalObject(Set.prototype, "size", { value: 0 });
reflectSet(Array.prototype, Symbol.iterator, () => undefined);
reflectDeleteProperty(globalThis, "navigator");
deleteViaReflect(Object.prototype, "polluted");
globalThis.Reflect.deleteProperty(Object.prototype, "tainted");
defineRuntimeProperty(globalThis, "fetch", { value: () => undefined });
`,
        "src/aliased-global-mutators.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["network", "defineGlobalProperty(globalThis.fetch)"],
        ["process", "defineAgain(Map.prototype.size)"],
        ["process", "defineViaObjectAlias(Promise.resolve)"],
        ["process", "defineFromGlobalObject(Set.prototype.size)"],
        ["process", "reflectSet(Array.prototype.*)"],
        ["process", "reflectDeleteProperty(globalThis.navigator)"],
        ["process", "deleteViaReflect(Object.prototype.polluted)"],
        [
          "process",
          "globalThis.Reflect.deleteProperty(Object.prototype.tainted)",
        ],
        ["network", "defineRuntimeProperty(globalThis.fetch)"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
const Object = { defineProperty: () => undefined };
const defineGlobalProperty = Object.defineProperty;
defineGlobalProperty(globalThis, "fetch", { value: () => undefined });
const Reflect = { set: () => false, deleteProperty: () => false };
const { set: reflectSet, deleteProperty: reflectDeleteProperty } = Reflect;
reflectSet(Array.prototype, Symbol.iterator, () => undefined);
reflectDeleteProperty(globalThis, "navigator");
`,
        "src/shadowed-aliased-global-mutators.test.ts",
      ),
      [],
    );
  });

  it("preserves runtime and intrinsic identity through nested destructuring", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const {
  Object: { defineProperty: defineGlobalProperty },
  Reflect: { set: reflectSet },
  Array: { prototype: nativeArrayPrototype },
  Deno: { env: { set: setEnv } = Deno.env },
} = globalThis;
const { prototype: { constructor: NativeArray } } = Array;
defineGlobalProperty(globalThis, "fetch", { value: () => undefined });
reflectSet(nativeArrayPrototype, Symbol.iterator, () => undefined);
setEnv("VERYFRONT_TEST", "1");
Object.defineProperty(NativeArray, "x", {});
`,
        "src/nested-runtime-destructuring.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["process", "Deno.env"],
        ["network", "defineGlobalProperty(globalThis.fetch)"],
        ["process", "reflectSet(nativeArrayPrototype.*)"],
        ["process", "setEnv"],
        ["process", "Object.defineProperty(NativeArray.x)"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
function mutate(globalThis: {
  Object: { defineProperty: typeof Object.defineProperty };
  Reflect: { set: typeof Reflect.set };
  Array: { prototype: object };
  Deno: { env: { set(name: string, value: string): void } };
}, Array: { prototype: { constructor: object } }) {
  const {
    Object: { defineProperty: defineGlobalProperty },
    Reflect: { set: reflectSet },
    Array: { prototype: nativeArrayPrototype },
    Deno: { env: { set: setEnv } = globalThis.Deno.env },
  } = globalThis;
  const { prototype: { constructor: NativeArray } } = Array;
  defineGlobalProperty(globalThis, "fetch", { value: () => undefined });
  reflectSet(nativeArrayPrototype, Symbol.iterator, () => undefined);
  setEnv("VERYFRONT_TEST", "1");
  Object.defineProperty(NativeArray, "x", {});
}
`,
        "src/shadowed-nested-runtime-destructuring.test.ts",
      ),
      [],
    );
  });

  it("preserves shared intrinsic identity through aliases", () => {
    assertEquals(
      collectSemanticMarkers(
        `
const NativeUint8Array = globalThis.Uint8Array;
Object.defineProperty(NativeUint8Array.prototype, "constructor", {
  value: NativeUint8Array,
});
const NativeArray = Array;
const NativeArrayPrototype = NativeArray.prototype;
Reflect.set(NativeArrayPrototype, Symbol.iterator, () => undefined);
const { Uint8Array: DestructuredUint8Array } = globalThis;
const { prototype: DestructuredArrayPrototype } = Array;
Object.defineProperty(DestructuredUint8Array.prototype, "constructor", {});
Reflect.deleteProperty(DestructuredArrayPrototype, Symbol.iterator);
const { AggregateError: NativeAggregateError } = globalThis;
Object.defineProperty(NativeAggregateError, Symbol.hasInstance, {
  value: () => true,
});
Object.defineProperty(AggregateError, Symbol.hasInstance, {
  value: () => true,
});
delete AggregateError[Symbol.hasInstance];
`,
        "src/intrinsic-alias-mutation.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        [
          "process",
          "Object.defineProperty(NativeUint8Array.prototype.constructor)",
        ],
        ["process", "Reflect.set(NativeArrayPrototype.*)"],
        [
          "process",
          "Object.defineProperty(DestructuredUint8Array.prototype.constructor)",
        ],
        ["process", "Reflect.deleteProperty(DestructuredArrayPrototype.*)"],
        [
          "process",
          "Object.defineProperty(NativeAggregateError.*)",
        ],
        ["process", "Object.defineProperty(AggregateError.*)"],
        ["process", "AggregateError.*"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `
function mutate(
  globalThis: { Uint8Array: { prototype: object } },
  Array: { prototype: object },
  AggregateError: object,
) {
  const NativeUint8Array = globalThis.Uint8Array;
  const NativeArrayPrototype = Array.prototype;
  Object.defineProperty(NativeUint8Array.prototype, "constructor", {});
  Reflect.set(NativeArrayPrototype, Symbol.iterator, () => undefined);
  Object.defineProperty(AggregateError, Symbol.hasInstance, {});
}
`,
        "src/local-intrinsic-alias-mutation.test.ts",
      ),
      [],
    );
  });

  it("classifies shared working-directory reads through globals and aliases", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import { cwd as processCwd } from "node:process";
import * as processRuntime from "node:process";
Deno.cwd();
process.cwd();
processCwd();
processRuntime.cwd();
const denoRuntime = Deno;
const { cwd: denoCwd } = denoRuntime;
denoCwd();
function local(Deno: { cwd(): string }, process: { cwd(): string }) {
  Deno.cwd();
  process.cwd();
}
`,
        "src/shared-cwd-reads.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["shared-cwd", "Deno.cwd"],
        ["shared-cwd", "process.cwd"],
        ["shared-cwd", "processCwd"],
        ["shared-cwd", "processRuntime.cwd"],
        ["shared-cwd", "denoCwd"],
      ],
    );
  });

  it("fails closed on parse failures", () => {
    assertThrows(
      () => collectSemanticMarkers("const = ;", "src/bad.test.ts"),
      SyntaxError,
    );
  });
});

describe("semantic disposition ratchet", () => {
  it("accepts exactly one valid disposition per current semantic-debt candidate", () => {
    const candidates = [{
      path: "src/effects.test.ts",
      markers: [marker("filesystem-read", 1)],
    }];

    assertEquals(
      validateSemanticDispositions(candidates, [
        disposition("src/effects.test.ts", "filesystem-read"),
      ]),
      [],
    );
  });

  it("reports missing dispositions in locale-independent ordinal order", () => {
    assertEquals(
      validateSemanticDispositions([
        {
          path: "src/a.test.ts",
          markers: [marker("network", 1)],
        },
        {
          path: "src/Z.test.ts",
          markers: [marker("network", 1)],
        },
      ], []),
      [
        "missing semantic disposition: src/Z.test.ts",
        "missing semantic disposition: src/a.test.ts",
      ],
    );
  });

  it("rejects missing, duplicate, malformed, stale, and growing dispositions", () => {
    const candidates = [{
      path: "src/effects.test.ts",
      markers: [marker("filesystem-read", 1)],
    }];

    assertEquals(
      validateSemanticDispositions(candidates, []),
      ["missing semantic disposition: src/effects.test.ts"],
    );
    assertEquals(
      validateSemanticDispositions(candidates, [
        disposition("src/effects.test.ts", "filesystem-read"),
        disposition("src/effects.test.ts", "filesystem-read"),
      ]),
      ["duplicate semantic disposition: src/effects.test.ts"],
    );
    assertEquals(
      validateSemanticDispositions([], [
        disposition("src/stale.test.ts", "network"),
      ]),
      ["stale semantic disposition must be removed: src/stale.test.ts"],
    );
    assertEquals(
      validateSemanticDispositionShape({
        ...disposition("src/effects.test.ts", "filesystem-read"),
        owner: "",
      }),
      ["semantic disposition missing owner: src/effects.test.ts"],
    );
    assertEquals(
      compareSemanticDispositionBaseline(
        [disposition("src/effects.test.ts", "filesystem-read")],
        {
          kind: "paths",
          ref: "base-ref",
          paths: [],
          effectsByPath: {},
        },
      ),
      [
        "Semantic unit-boundary inventory grew relative to base-ref: src/effects.test.ts",
      ],
    );
    assertEquals(
      validateSemanticDispositionShape({
        path: "src/watcher.test.ts",
        effects: ["filesystem-watch"],
        disposition: "hermetic-unit",
        owner: "test-architecture",
        rationale: "Watches a checked-in fixture.",
      }),
      [
        "hermetic-unit disposition only permits filesystem-read: src/watcher.test.ts has filesystem-watch",
      ],
    );
    assertEquals(
      compareSemanticDispositionBaseline(
        [{
          ...disposition("src/effects.test.ts", "filesystem-read"),
          effects: ["filesystem-read", "network"],
        }],
        {
          kind: "paths",
          ref: "base-ref",
          paths: ["src/effects.test.ts"],
          effectsByPath: {
            "src/effects.test.ts": ["filesystem-read"],
          },
        },
      ),
      [
        "Semantic unit-boundary effect inventory grew relative to base-ref: src/effects.test.ts added network",
      ],
    );
    assertEquals(
      validateSemanticDispositions([{
        path: "src/effects.test.ts",
        markers: [
          marker("filesystem-read", 1),
          marker("network", 2),
        ],
      }], [
        disposition("src/effects.test.ts", "filesystem-read"),
      ]),
      [
        "semantic disposition missing effect(s) for src/effects.test.ts: network",
      ],
    );
  });

  it("requires kind-specific disposition metadata", () => {
    assertEquals(
      validateSemanticDispositionShape({
        path: "src/fake.test.ts",
        effects: ["filesystem-read"],
        disposition: "replaceable-fake",
        owner: "test-architecture",
        removalPr: "PR 4",
      }),
      [
        "replaceable-fake disposition missing replacement note: src/fake.test.ts",
      ],
    );
    assertEquals(
      validateSemanticDispositionShape({
        path: "src/hermetic.test.ts",
        effects: ["filesystem-read"],
        disposition: "hermetic-unit",
        owner: "test-architecture",
      }),
      ["hermetic-unit disposition missing rationale: src/hermetic.test.ts"],
    );
    assertEquals(
      validateSemanticDispositionShape({
        path: "src/not-hermetic.test.ts",
        effects: ["filesystem-read", "process", "network"],
        disposition: "hermetic-unit",
        owner: "test-architecture",
        rationale:
          "This rationale must not turn side effects into an exception.",
      }),
      [
        "hermetic-unit disposition only permits filesystem-read: src/not-hermetic.test.ts has network, process",
      ],
    );
    assertEquals(
      validateSemanticDispositionShape({
        path: "src/hermetic.test.ts",
        effects: ["filesystem-read"],
        disposition: "hermetic-unit",
        owner: "test-architecture",
        rationale: "Reads a checked-in contract fixture.",
      }),
      [],
    );
    assertEquals(
      validateSemanticDispositionShape({
        path: "src/move.test.ts",
        effects: ["server"],
        disposition: "integration-relocation",
        owner: "test-architecture",
        removalPr: "PR 4",
        destination: "src/not-integration.test.ts",
      }),
      [
        "integration-relocation disposition destination must be a safe executable path under tests/integration/: src/move.test.ts",
      ],
    );
  });

  it("rejects unsafe paths and malformed baseline source", () => {
    assertEquals(
      validateSemanticDispositionShape(
        {
          ...disposition("../outside.test.ts", "network"),
          destination: "tests/integration/outside.test.ts",
        },
      ),
      ["semantic disposition path must be repo-relative: ../outside.test.ts"],
    );
    assertEquals(
      validateSemanticDispositionShape(
        {
          ...disposition("src\\windows.test.ts", "network"),
          destination: "tests/integration/windows.test.ts",
        },
      ),
      ["semantic disposition path must use forward slashes: src\\windows.test.ts"],
    );
    assertEquals(
      validateSemanticDispositionShape(
        {
          ...disposition("C:outside.test.ts", "network"),
          destination: "tests/integration/outside.test.ts",
        },
      ),
      ["semantic disposition path must be repo-relative: C:outside.test.ts"],
    );
    assertEquals(
      validateSemanticDispositionShape({
        ...disposition("src/move.test.ts", "network"),
        destination: "tests/integration/../outside.test.ts",
      }),
      [
        "integration-relocation disposition destination must be a safe executable path under tests/integration/: src/move.test.ts",
      ],
    );
    assertEquals(
      validateSemanticDispositionShape({
        ...disposition("src/duplicate.test.ts", "network"),
        effects: ["network", "network"],
      }),
      ["semantic disposition has duplicate effects: src/duplicate.test.ts"],
    );
    assertEquals(
      parseSemanticDispositionBaselineSource(
        `export const TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES = [{ pathPrefix: "src/" }];`,
        "base-ref",
      ),
      {
        kind: "malformed",
        ref: "base-ref",
        reason: "base semantic inventory has no explicit executable paths",
      },
    );
  });

  it("allows shrinkage while reporting stale entries for regeneration", () => {
    assertEquals(
      compareSemanticDispositionBaseline([], {
        kind: "paths",
        ref: "base-ref",
        paths: ["src/old.test.ts"],
        effectsByPath: {
          "src/old.test.ts": ["network"],
        },
      }),
      [],
    );
    assertEquals(
      validateSemanticDispositions([], [
        disposition("src/old.test.ts", "network"),
      ]),
      ["stale semantic disposition must be removed: src/old.test.ts"],
    );
  });

  it("extracts paths and effects from the checked-in semantic inventory", async () => {
    const source = await Deno.readTextFile(
      new URL("./test-semantic-audit-migration.ts", import.meta.url),
    );
    const baseline = parseSemanticDispositionBaselineSource(source, "base-ref");

    assertEquals(baseline.kind, "paths");
    if (baseline.kind !== "paths") return;
    assertEquals(
      baseline.paths,
      TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES.map((entry) => entry.path).sort(),
    );
    assertEquals(
      baseline.effectsByPath,
      Object.fromEntries(
        TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES.map((entry) => [
          entry.path,
          [...entry.effects].sort(),
        ]),
      ),
    );
  });
});

describe("semantic audit task wiring", () => {
  it("gives shrinking inventories regeneration guidance while still failing", () => {
    assertEquals(
      formatSemanticAuditFailure(
        [
          "stale semantic disposition must be removed: src/removed.test.ts",
        ],
        480,
      ),
      [
        "Semantic unit-boundary debt shrank to 480 file(s).",
        "  stale semantic disposition must be removed: src/removed.test.ts",
        "",
        "Regenerate scripts/test/test-semantic-audit-migration.ts to remove the stale dispositions.",
      ].join("\n"),
    );
  });

  it("keeps suite-plan membership path-only at version 1", async () => {
    const plan = await planSuiteFiles({
      suite: "unit:parallel",
      paths: ["src/agent/factory.test.ts"],
    });

    assertEquals(plan, {
      version: 1,
      suite: "unit:parallel",
      runner: "deno",
      files: ["src/agent/factory.test.ts"],
    });
  });

  it("wires the audit into lint and script verification tasks", async () => {
    const denoJson = JSON.parse(
      await Deno.readTextFile(new URL("../../deno.json", import.meta.url)),
    ) as {
      tasks: Record<string, string>;
    };

    assertEquals(
      denoJson.tasks["lint:test-semantic-dispositions"],
      "deno run --config=scripts/test.deno.json --no-check --allow-read --allow-run=git --allow-env=TEST_SEMANTIC_AUDIT_BASE_REF scripts/lint/audit-test-semantic-dispositions.ts",
    );
    assertEquals(
      denoJson.tasks["lint:ci"].includes(
        "deno task lint:test-semantic-dispositions",
      ),
      true,
    );
    assertEquals(
      denoJson.tasks.verify.includes(
        "deno task lint:test-semantic-dispositions",
      ),
      true,
    );
    assertEquals(
      denoJson.tasks["verify:quick"].includes(
        "deno task lint:test-semantic-dispositions",
      ),
      true,
    );
    assertEquals(
      denoJson.tasks["test:scripts"].includes(
        "scripts/test/test-semantic-audit.test.ts",
      ),
      true,
    );
  });

  it("provides the pull-request baseline to the lint shard", async () => {
    const workflow = await Deno.readTextFile(
      new URL("../../.github/workflows/cicd.yml", import.meta.url),
    );

    assertEquals(
      workflow.includes(
        "if: ${{ matrix.check == 'test-layout' || matrix.check == 'lint' }}",
      ),
      true,
    );
    assertEquals(
      workflow.includes(
        'echo "TEST_SEMANTIC_AUDIT_BASE_REF=$base" >> "$GITHUB_ENV"',
      ),
      true,
    );
    assertEquals(
      workflow.includes(
        'git fetch --no-tags --depth=1 origin "main:refs/remotes/origin/main"',
      ),
      true,
    );
  });
});

function marker(
  effect: SemanticDispositionEntry["effects"][number],
  line: number,
) {
  return { effect, line, symbol: effect };
}

function disposition(
  path: string,
  effect: SemanticDispositionEntry["effects"][number],
): SemanticDispositionEntry {
  return {
    path,
    effects: [effect],
    disposition: "integration-relocation",
    owner: "test-architecture",
    rationale: "Uses runtime side effects that belong in integration coverage.",
    destination: `tests/integration/semantic-audit/${
      path.replace(/\.[^.]+$/, ".test.ts")
    }`,
    removalPr: "PR 4",
  };
}

async function writeFixture(
  root: string,
  relativePath: string,
  source: string,
): Promise<void> {
  const target = join(root, relativePath);
  await ensureDir(dirname(target));
  await Deno.writeTextFile(target, source);
}
