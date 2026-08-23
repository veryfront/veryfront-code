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
`,
        "src/aliased-effects.test.ts",
      ).map((marker) => [marker.effect, marker.symbol]),
      [
        ["filesystem-write", "writeAgain"],
        ["filesystem-read", "aliasedFs.readFile"],
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
        ["server", 8, "denoRuntime.serve"],
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
globalThis.fetch = () => Promise.resolve(new Response("ok"));
await globalThis.fetch("https://example.com");
globalThis.fetch = originalFetch;
const local = { fetch: () => undefined };
local.fetch = () => undefined;
`,
        "src/global-fetch.test.ts",
      ).map((marker) => [marker.effect, marker.line, marker.symbol]),
      [
        ["network", 3, "globalThis.fetch"],
        ["network", 4, "globalThis.fetch"],
        ["network", 5, "globalThis.fetch"],
      ],
    );
    assertEquals(
      collectSemanticMarkers(
        `const globalThis = { fetch: () => undefined };
globalThis.fetch = () => undefined;
globalThis.fetch();`,
        "src/local-global-this.test.ts",
      ),
      [],
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
