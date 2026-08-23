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

  it("classifies canonical compat filesystem and process imports", () => {
    assertEquals(
      collectSemanticMarkers(
        `
import { remove, stat } from "#veryfront/compat/fs.ts";
import {
  deleteEnv,
  getEnvNumber,
  runCommand,
  setEnv,
} from "#veryfront/compat/process.ts";
await stat("fixture.txt");
await remove("fixture.txt");
getEnvNumber("TEST_KEY");
setEnv("TEST_KEY", "value");
deleteEnv("TEST_KEY");
await runCommand({ command: "deno", args: ["--version"] });
`,
        "src/canonical-compat-imports.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-read", "stat"],
        ["filesystem-write", "remove"],
        ["process", "getEnvNumber"],
        ["process", "setEnv"],
        ["process", "deleteEnv"],
        ["process", "runCommand"],
      ],
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
await fs.promises.readFile("deno.json");
await fs.promises.writeFile("tmp.txt", "x");
await nodeFs.promises.rm("tmp.txt");
const promised = fs.promises;
await promised.stat("deno.json");
const { promises: destructured } = nodeFs;
await destructured.appendFile("tmp.txt", "x");
function local(fs: { promises: { writeFile(): void } }) {
  fs.promises.writeFile();
}
`,
        "src/fs-promises-namespaces.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-read", "fs.promises.readFile"],
        ["filesystem-write", "fs.promises.writeFile"],
        ["filesystem-write", "nodeFs.promises.rm"],
        ["filesystem-read", "promised.stat"],
        ["filesystem-write", "destructured.appendFile"],
      ],
    );
  });

  it("classifies statically known computed runtime properties", () => {
    const markers = collectSemanticMarkers(
      `
await Deno["writeTextFile"]("tmp.txt", "x");
await Deno["readTextFile"]("deno.json");
process["exit"](0);
globalThis["fetch"]("https://example.com");
const method = "writeTextFile";
Deno[method]("tmp.txt", "x");
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
        ["process", 14, "Deno.exit"],
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
        ["process", 18, "processRuntime.env"],
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
defineGlobalProperty(globalThis, "fetch", { value: () => undefined });
defineAgain(Map.prototype, "size", { value: 0 });
defineViaObjectAlias(Promise, "resolve", { value: () => undefined });
defineFromGlobalObject(Set.prototype, "size", { value: 0 });
reflectSet(Array.prototype, Symbol.iterator, () => undefined);
reflectDeleteProperty(globalThis, "navigator");
deleteViaReflect(Object.prototype, "polluted");
globalThis.Reflect.deleteProperty(Object.prototype, "tainted");
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
