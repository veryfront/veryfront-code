import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  compare,
  type CpuProfile,
  escapeHtml,
  flamegraph,
  sanitizeProfile,
  summarizeProfile,
  summarizeRuns,
} from "./report.ts";
import { options, workerDiagnostics, workloadHash } from "./run.ts";
import { baselineCompatible } from "./baseline.ts";

describe("performance reports", () => {
  const profile: CpuProfile = {
    startTime: 0,
    endTime: 10000,
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: "(root)",
          url: "",
          lineNumber: -1,
          columnNumber: -1,
          scriptId: "0",
        },
        children: [2],
      },
      {
        id: 2,
        callFrame: {
          functionName: "render",
          url: "file:///workspace/src/render.ts?private=value",
          lineNumber: 3,
          columnNumber: 0,
          scriptId: "1",
        },
        children: [3],
      },
      {
        id: 3,
        callFrame: {
          functionName: "encode",
          url: "file:///workspace/src/encode.ts",
          lineNumber: 2,
          columnNumber: 0,
          scriptId: "2",
        },
      },
    ],
    samples: [2, 3, 3],
    timeDeltas: [1000, 2000, 7000],
  };
  it("weights self time by sample intervals and attributes inclusive time to callers", () => {
    const summary = summarizeProfile(profile);
    assertEquals(summary.hotspots[0]?.name, "encode");
    assertEquals(summary.hotspots[0]?.selfMs, 9);
    assertEquals(
      summary.hotspots.find((h) => h.name === "render")?.totalMs,
      10,
    );
    assertEquals(summary.sampledMs, 10);
  });
  it("removes machine paths, URL credentials, queries, and inline source before export", () => {
    const sanitized = sanitizeProfile(profile, "file:///workspace/");
    assertEquals(sanitized.nodes[1]?.callFrame.url, "src/render.ts");
    assertEquals(profile.nodes[1]?.callFrame.url.includes("private"), true);
    const external = structuredClone(profile);
    external.nodes[1]!.callFrame.url =
      "https://example.invalid/private?credential=value";
    external.nodes[2]!.callFrame.url = "data:text/javascript,private-source";
    const serialized = JSON.stringify(
      sanitizeProfile(external, "file:///workspace/"),
    );
    assertEquals(serialized.includes("private"), false);
    assertStringIncludes(serialized, "[external]");
  });
  it("keeps distinct scripts and columns separate after sanitization", () => {
    const collision = structuredClone(profile);
    for (const node of collision.nodes.slice(1)) {
      Object.assign(node.callFrame, {
        functionName: "render",
        url: "https://example.invalid/runtime.js",
        lineNumber: 28,
        columnNumber: 10,
      });
    }
    const hotspots = () =>
      summarizeProfile(sanitizeProfile(collision, "file:///workspace/"))
        .hotspots.filter((item) => item.name === "render");
    assertEquals(hotspots().map((item) => item.selfMs), [9, 1]);
    collision.nodes[2]!.callFrame.scriptId =
      collision.nodes[1]!.callFrame.scriptId;
    collision.nodes[2]!.callFrame.columnNumber = 20;
    assertEquals(hotspots().map((item) => item.selfMs), [9, 1]);
    collision.nodes[2]!.callFrame.columnNumber = 10;
    assertEquals(hotspots().map((item) => item.selfMs), [10]);
  });
  it("redacts generated module paths that embed absolute source paths", () => {
    const generated = structuredClone(profile);
    generated.nodes[1]!.callFrame.url =
      "file:///workspace/.cache/perf/runtime-123/cache/id-local-main/workspace/src/render.ts.mjs";
    const sanitized = sanitizeProfile(generated, "file:///workspace/");
    assertEquals(sanitized.nodes[1]!.callFrame.url, "[generated]");
    assertEquals(JSON.stringify(sanitized).includes("workspace"), false);
  });
  it("reports medians, spreads, and sample counts without discarding slow runs", () => {
    assertEquals(summarizeRuns([9, 1, 3, 5, 7]), {
      median: 5,
      min: 1,
      max: 9,
      samples: 5,
    });
    assertThrows(() => summarizeRuns([]));
  });
  it("labels lower latency as improvement and rejects invalid measurements", () => {
    assertEquals(compare(10, 8), { changePercent: -20, speedup: 1.25 });
    assertThrows(() => compare(0, 8));
    assertThrows(() => compare(10, NaN));
  });
  it("escapes profile labels in the standalone browser report", () => {
    const unsafe = structuredClone(profile);
    unsafe.nodes[1]!.callFrame.functionName =
      '<script>alert("fixture")</script>';
    const svg = flamegraph(unsafe);
    assertEquals(svg.includes("<script>"), false);
    assertStringIncludes(svg, "&lt;script&gt;");
    assertEquals(escapeHtml("<>&"), "&lt;&gt;&amp;");
  });
  it("bounds command inputs and keeps output labels inside the artifact directory", () => {
    assertEquals(
      options(["--json", "--scenario=ssr", "--trials=7"]).json,
      true,
    );
    assertThrows(() => options(["--label=../outside"]));
    assertThrows(() => options(["--trials=NaN"]));
    assertThrows(() => options(["--duration-ms=0"]));
    assertThrows(() => options(["--scenario=unknown"]));
    assertThrows(() => options(["--unknown"]));
  });
  it("classifies worker failures without exporting raw diagnostics", () => {
    const denied = workerDiagnostics(
      1,
      'NotCapable: Requires net access to "private.invalid"',
    );
    assertEquals(denied.reason, "permission-denied");
    assertEquals(denied.exitCode, 1);
    assertEquals(JSON.stringify(denied).includes("private.invalid"), false);
    assertEquals(
      workerDiagnostics(1, "Error: HTTP fixture returned incomplete HTML")
        .reason,
      "invalid-response",
    );
    assertEquals(
      workerDiagnostics(1, "Module not found: file:///workspace/private.ts")
        .reason,
      "dependency-setup",
    );
    assertEquals(workerDiagnostics(137, "", true).reason, "timeout");
    assertEquals(
      workerDiagnostics(1, "unrecognized private payload").message.includes(
        "private",
      ),
      false,
    );
  });
  it("invalidates baselines when measurement code or permissions change", async () => {
    const sources = new Map<string, string>();
    const readSource = (path: string) =>
      Promise.resolve(sources.get(path) ?? "unchanged");
    const baseline = await workloadHash(readSource);
    for (
      const file of [
        "scripts/perf/run.ts",
        "scripts/perf/report.ts",
        "scripts/test/suites.ts",
      ]
    ) {
      sources.set(file, "changed measurement logic");
      assertEquals(await workloadHash(readSource) === baseline, false, file);
      sources.clear();
    }
  });
  it("accepts full HTTP workloads with explicit cache and compile modes", () => {
    for (
      const scenario of ["http-api", "http-cached", "http-ssr", "http-dev"]
    ) {
      assertEquals(options([`--scenario=${scenario}`]).scenario, scenario);
    }
  });
  it("keeps task-only changes comparable and rejects incompatible dependencies", () => {
    const base = {
      imports: { fixture: "./fixture.ts" },
      tasks: { test: "old" },
    };
    const head = { ...base, tasks: { test: "new", perf: "profile" } };
    assertEquals(baselineCompatible(head, base, "lock", "lock"), true);
    assertEquals(baselineCompatible(head, base, "new lock", "old lock"), false);
    for (
      const key of [
        "imports",
        "scopes",
        "workspace",
        "importMap",
        "nodeModulesDir",
        "vendor",
        "unstable",
        "compilerOptions",
        "minimumDependencyAge",
        "lock",
      ]
    ) {
      assertEquals(
        baselineCompatible({ ...head, [key]: "changed" }, base, "lock", "lock"),
        false,
        key,
      );
    }
  });
});
