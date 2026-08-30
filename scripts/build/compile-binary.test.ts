import { walk } from "#std/fs/walk";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { FIRST_PARTY_DEFERRED_BUILTIN_EXTENSION_POLICIES } from "#veryfront/extensions/first-party-defaults.ts";
import {
  createCompileArgs,
  DEFAULT_INCLUDES,
  findMissingBakedV8Flags,
  PROXY_INCLUDES,
} from "./compile-binary.ts";

interface DenoInfoDependency {
  code?: { specifier: string };
  type?: { specifier: string };
}

interface DenoInfoModule {
  dependencies?: DenoInfoDependency[] | null;
  specifier: string;
}

interface DenoInfoGraph {
  roots: string[];
  modules: DenoInfoModule[];
}

function isResolvedDependency(value: unknown): value is DenoInfoDependency {
  if (!value || typeof value !== "object") return false;
  const dependency = value as Record<string, unknown>;
  if (
    typeof dependency.specifier !== "string" ||
    dependency.specifier.length === 0
  ) {
    return false;
  }

  const targets = [dependency.code, dependency.type].filter((target) =>
    target != null
  );
  return targets.length > 0 &&
    targets.every((target) =>
      typeof target === "object" &&
      target !== null &&
      typeof (target as Record<string, unknown>).specifier === "string" &&
      ((target as Record<string, unknown>).specifier as string).length > 0
    );
}

function parseDenoInfoGraph(value: unknown): DenoInfoGraph {
  if (!value || typeof value !== "object") {
    throw new TypeError("Invalid deno info graph");
  }
  const graph = value as Record<string, unknown>;
  if (
    !Array.isArray(graph.roots) ||
    graph.roots.length === 0 ||
    !graph.roots.every((root) => typeof root === "string" && root.length > 0) ||
    !Array.isArray(graph.modules) ||
    graph.modules.length === 0
  ) {
    throw new TypeError("Invalid deno info graph");
  }

  for (const module of graph.modules) {
    if (!module || typeof module !== "object") {
      throw new TypeError("Invalid deno info module");
    }
    const record = module as Record<string, unknown>;
    if (typeof record.specifier !== "string" || record.specifier.length === 0) {
      throw new TypeError("Invalid deno info module specifier");
    }
    if (
      record.dependencies !== undefined &&
      record.dependencies !== null &&
      (!Array.isArray(record.dependencies) ||
        !record.dependencies.every(isResolvedDependency))
    ) {
      throw new TypeError("Invalid deno info dependency");
    }
  }

  return graph as unknown as DenoInfoGraph;
}

it("compiled CLI embeds the default Node WebSocket extension for HMR", () => {
  const args = createCompileArgs({
    entrypoint: "cli/main.ts",
    extraIncludes: [],
    output: "veryfront",
  });

  assertEquals(
    args.some((value) => value.includes("ext-node-websocket-ws")),
    true,
  );
});

it("compiled CLI embeds the explicit Redis extension for opt-in activation", () => {
  const args = createCompileArgs({
    entrypoint: "cli/main.ts",
    extraIncludes: [],
    output: "/tmp/veryfront",
  });

  assertEquals(
    args.some((value) => value.includes("ext-redis")),
    true,
  );
});

it("compiled CLI embeds optional builtin extension source files", () => {
  for (
    const { sourceDirectory } of FIRST_PARTY_DEFERRED_BUILTIN_EXTENSION_POLICIES
  ) {
    assertEquals(
      DEFAULT_INCLUDES.includes(`extensions/${sourceDirectory}/src/index.ts`),
      true,
      `compile-binary DEFAULT_INCLUDES must embed optional builtin ${sourceDirectory}`,
    );
  }
});

it("compiled CLI embeds every runtime-resolved sibling module", async () => {
  // Modules picked through a `.ts`/`.js` distribution-format ternary are
  // resolved from a computed URL, so `deno compile` never sees them in the
  // static graph and only DEFAULT_INCLUDES can embed them.
  const siblingTernary = /"\.\/([^"]+)\.ts"\s*:\s*"\.\/\1\.js"/g;
  const runtimeResolvedIncludes: string[] = [];

  for await (
    const entry of walk("extensions", {
      exts: [".ts", ".tsx"],
      includeDirs: false,
    })
  ) {
    if (entry.path.includes(".test.")) continue;
    const source = await Deno.readTextFile(entry.path);
    const directory = entry.path.slice(0, entry.path.lastIndexOf("/"));

    for (const match of source.matchAll(siblingTernary)) {
      const include = `${directory}/${match[1]!}.ts`;
      assertEquals(
        DEFAULT_INCLUDES.includes(include),
        true,
        `compile-binary DEFAULT_INCLUDES must embed ${include}, resolved at runtime by ${entry.path}`,
      );
      runtimeResolvedIncludes.push(include);
    }
  }

  assertEquals(
    runtimeResolvedIncludes.sort(),
    [
      "extensions/ext-document-kreuzberg/src/native-extraction-process.ts",
      "extensions/ext-document-kreuzberg/src/upload-extraction-worker.ts",
      "extensions/ext-react-ssr/src/worker-renderer.ts",
    ],
    "runtime-resolved sibling inventory changed; update DEFAULT_INCLUDES and this explicit contract together",
  );
});

it("compiled CLI embeds the permissionless parser entry", () => {
  assertEquals(
    DEFAULT_INCLUDES.includes(
      "extensions/ext-parser-babel/src/parser-only.ts",
    ),
    true,
  );
});

it("compiled CLI embeds the auto-loaded Sentry reporter", () => {
  assertEquals(
    DEFAULT_INCLUDES.includes(
      "extensions/ext-observability-sentry/src/index.ts",
    ),
    true,
  );
});

it("proxy binary embeds only the runtime-resolved proxy entrypoint", async () => {
  const args = createCompileArgs({
    entrypoint: "cli/proxy-main.ts",
    extraIncludes: [],
    output: "veryfront-proxy",
    profile: "proxy",
  });

  for (const include of PROXY_INCLUDES) {
    assertEquals(
      args.includes(include),
      true,
      `missing proxy include ${include}`,
    );
  }

  assertEquals(args.includes("--node-modules-dir=none"), true);
  assertEquals(args.includes("scripts/build/proxy-deno.lock"), true);
  assertEquals(args.includes("--frozen"), true);
  assertEquals(args.includes("extensions/ext-image-sharp/src/index.ts"), false);
  assertEquals(args.includes("dist/framework-src"), false);
  assertEquals(args.at(-1), "cli/proxy-main.ts");

  const entrypoint = await Deno.readTextFile("cli/proxy-main.ts");
  const runtimeImportIndex = entrypoint.indexOf(
    'import { runStandaloneProxyRuntime } from "./commands/serve/proxy-runtime.ts";',
  );
  assertEquals(
    runtimeImportIndex >= 0,
    true,
    "proxy entrypoint must statically import its runtime before extension anchors",
  );
  assertEquals(
    entrypoint.match(/\.\/commands\/serve\/proxy-runtime\.ts/g)?.length,
    1,
    "proxy entrypoint must import its runtime exactly once",
  );
  assertEquals(
    entrypoint.includes('await import("./commands/serve/proxy-runtime.ts")'),
    false,
    "proxy entrypoint must not dynamically re-import its runtime",
  );
  for (
    const extension of [
      "ext-auth-jwt",
      "ext-cache-redis",
      "ext-redis",
      "ext-observability-opentelemetry",
      "ext-observability-sentry",
      // Anchors the SchemaValidator the proxy needs to verify control-plane
      // dispatch signatures. It is reached only through a dynamic first-party
      // import, which `deno compile` cannot trace.
      "ext-schema-zod",
    ]
  ) {
    const extensionImportIndex = entrypoint.indexOf(
      `../extensions/${extension}/src/index.ts`,
    );
    assertEquals(
      extensionImportIndex >= 0,
      true,
      `proxy entrypoint must statically embed ${extension}`,
    );
    assertEquals(
      runtimeImportIndex < extensionImportIndex,
      true,
      `proxy-runtime must evaluate before ${extension} top-level code`,
    );
  }

  const lock = JSON.parse(
    await Deno.readTextFile("scripts/build/proxy-deno.lock"),
  ) as { npm?: Record<string, unknown> };
  const packages = Object.keys(lock.npm ?? {});
  for (const unrelated of ["@huggingface/transformers", "esbuild", "sharp"]) {
    assertEquals(
      packages.some((name) =>
        name === unrelated || name.startsWith(`${unrelated}@`)
      ),
      false,
      `proxy lock must not contain ${unrelated}`,
    );
  }
});

it("proxy binary cannot reach declarative config worker modules", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", "cli/proxy-main.ts"],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  assertEquals(
    output.success,
    true,
    new TextDecoder().decode(output.stderr),
  );

  const info = parseDenoInfoGraph(
    JSON.parse(new TextDecoder().decode(output.stdout)),
  );
  const modules = new Map(
    info.modules.map((module) => [module.specifier, module]),
  );
  for (const root of info.roots) {
    if (!modules.has(root)) {
      throw new TypeError("Deno info root is missing from the module graph");
    }
  }
  const reachable = new Set(info.roots);
  const pending = [...reachable];
  while (pending.length > 0) {
    const specifier = pending.shift()!;
    for (const dependency of modules.get(specifier)?.dependencies ?? []) {
      const dependencySpecifier = dependency.code?.specifier;
      if (!dependencySpecifier || reachable.has(dependencySpecifier)) continue;
      reachable.add(dependencySpecifier);
      pending.push(dependencySpecifier);
    }
  }
  const evaluatorWorkerModules = [...reachable]
    .filter((specifier) => specifier.includes("declarative-evaluator-worker"));

  assertEquals(
    evaluatorWorkerModules,
    [],
    "the proxy must not reach project config evaluation; it only forwards requests to the production server",
  );
});

it("proxy graph validation rejects incomplete metadata", () => {
  for (
    const graph of [
      {},
      { roots: [], modules: [] },
      { roots: ["proxy"], modules: [{}] },
      {
        roots: ["proxy"],
        modules: [{ specifier: "proxy", dependencies: [{}] }],
      },
    ]
  ) {
    assertThrows(() => parseDenoInfoGraph(graph), TypeError);
  }
});

it("proxy release verifies lock freshness and publishes an exact SBOM", async () => {
  const workflow = await Deno.readTextFile(".github/workflows/cicd.yml");
  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json")) as {
    tasks?: Record<string, string>;
  };

  assertEquals(workflow.includes("deno task build:proxy-lock"), true);
  assertEquals(
    workflow.includes("git diff --exit-code -- scripts/build/proxy-deno.lock"),
    true,
  );
  assertEquals(
    workflow.includes("deno task sbom --lock scripts/build/proxy-deno.lock"),
    true,
  );
  assertEquals(
    /build-binaries:[\s\S]*?strategy:\n\s+fail-fast: false\n\s+matrix:/
      .test(workflow),
    true,
    "proxy release leg must not cancel existing binary builds",
  );
  assertEquals(
    denoConfig.tasks?.["build:proxy-lock"]?.includes("--frozen=false"),
    false,
    "proxy lock refresh must use Deno's default mutable lock mode",
  );

  for (
    const { artifact, target } of [
      {
        artifact: "veryfront-proxy-linux-x64",
        target: "x86_64-unknown-linux-gnu",
      },
      {
        artifact: "veryfront-proxy-linux-arm64",
        target: "aarch64-unknown-linux-gnu",
      },
    ]
  ) {
    assertEquals(
      new RegExp(
        String
          .raw`target: ${target}[\s\S]*?name: ${artifact}[\s\S]*?entrypoint: cli/proxy-main\.ts[\s\S]*?profile: proxy`,
      ).test(workflow),
      true,
      `release matrix must publish ${artifact} from the proxy profile`,
    );
  }
});

it("release binaries carry the numbered RC version", async () => {
  const workflow = await Deno.readTextFile(
    new URL("../../.github/workflows/cicd.yml", import.meta.url),
  );
  const jobStart = workflow.indexOf("  build-binaries:");
  const jobEnd = workflow.indexOf("\n  prerelease:", jobStart);
  const buildBinariesJob = workflow.slice(jobStart, jobEnd);

  assertEquals(
    buildBinariesJob.includes("needs: [version-check]"),
    true,
    "binary builds need the release version detected by version-check",
  );
  assertEquals(
    buildBinariesJob.includes("Prepare RC build version"),
    true,
    "RC binaries must inject the numbered publish version before compiling",
  );
  assertEquals(
    buildBinariesJob.includes(
      "VERSION: ${{ needs.version-check.outputs.version }}.${{ github.run_number }}",
    ),
    true,
    "binary and npm artifacts must use the same numbered RC version",
  );
  assertEquals(
    buildBinariesJob.indexOf("Prepare RC build version") <
      buildBinariesJob.indexOf("./.github/actions/prepare-build-deps"),
    true,
    "the RC version must be injected before generators bundle it",
  );
});

it("local build matrix includes both Linux proxy architectures", async () => {
  const buildScript = await Deno.readTextFile("scripts/build/build-all.js");

  for (
    const { name, target, output } of [
      {
        name: "Linux proxy (x64)",
        target: "x86_64-unknown-linux-gnu",
        output: "veryfront-proxy-linux-x64",
      },
      {
        name: "Linux proxy (ARM64)",
        target: "aarch64-unknown-linux-gnu",
        output: "veryfront-proxy-linux-arm64",
      },
    ]
  ) {
    assertEquals(buildScript.includes(`name: "${name}"`), true);
    assertEquals(buildScript.includes(`target: "${target}"`), true);
    assertEquals(buildScript.includes(`output: "${output}"`), true);
  }
});

it("proxy profile defaults to the dedicated proxy entrypoint", () => {
  const args = createCompileArgs({
    extraIncludes: [],
    output: "veryfront-proxy",
    profile: "proxy",
  });

  assertEquals(args.at(-1), "cli/proxy-main.ts");
});

it("compiled proxy smoke covers cache and observability providers", async () => {
  const smoke = await Deno.readTextFile("scripts/build/smoke-proxy-binary.sh");

  assertEquals(
    smoke.includes("usage: smoke-proxy-binary.sh <binary> [base_port]"),
    true,
    "the optional smoke port must be documented as the base for all probes",
  );

  for (
    const contract of [
      "CACHE_TYPE=memory",
      "CACHE_TYPE=redis",
      "TokenCacheStore registered",
      "ambient-redis",
      "CACHE_TYPE=memory REDIS_URL=redis://127.0.0.1:1",
      "[ext-redis] RedisRuntimeProvider registered",
      "OTEL_TRACES_EXPORTER=otlp",
      "[otel] Initialized",
      "run_smoke otel",
      "run_smoke sentry",
      "VERYFRONT_ERROR_REPORTER=sentry",
      "SENTRY_DSN=https://public@example.com/1",
    ]
  ) {
    assertEquals(
      smoke.includes(contract),
      true,
      `missing smoke contract ${contract}`,
    );
  }

  assertEquals(
    smoke.includes('if ! grep -Fq "$expected_log" "$log_file"; then'),
    true,
    "missing proxy log markers must print diagnostics before failing",
  );
  assertEquals(
    /if ! grep -Fq "\$expected_log" "\$log_file"; then\s+sleep 1\s+continue/
      .test(smoke),
    true,
    "healthy proxies must retry briefly while asynchronous provider logs flush",
  );
  assertEquals(
    smoke.includes("--connect-timeout") && smoke.includes("--max-time"),
    true,
    "health probes must be bounded inside the retry window",
  );
  assertEquals(
    smoke.includes("PROXY_BINARY_MAX_BYTES") &&
      smoke.includes("188743680"),
    true,
    "compiled proxy smoke must enforce a defensible artifact size ceiling",
  );
  assertEquals(
    smoke.includes("${TMPDIR:-/tmp}/veryfront-proxy-smoke.XXXXXX"),
    true,
    "smoke temp directory must use a portable mktemp template",
  );
});

it("proxy release enforces the cold-start cgroup budget", async () => {
  const workflow = await Deno.readTextFile(".github/workflows/cicd.yml");
  const invocation =
    "bash scripts/build/smoke-proxy-memory.sh ./veryfront-proxy-linux-x64";

  assertEquals(
    workflow.split(invocation).length - 1,
    2,
    "pull-request and main-release jobs must both enforce proxy memory",
  );
  assertEquals(
    workflow.split("PROXY_MEMORY_LIMIT: 1536m").length - 1,
    2,
    "both proxy memory jobs must pin the 1536 MiB release gate",
  );
  assertEquals(
    workflow.split('PROXY_MEMORY_ATTEMPTS: "3"').length - 1,
    2,
    "both proxy memory jobs must pin three cold-start attempts",
  );
  assertEquals(
    workflow.split("if: matrix.name == 'veryfront-proxy-linux-x64'").length -
      1,
    2,
    "provider and memory smoke must execute only for the native x64 proxy",
  );

  const smoke = await Deno.readTextFile(
    "scripts/build/smoke-proxy-memory.sh",
  );
  for (
    const contract of [
      'memory_limit="${PROXY_MEMORY_LIMIT:-1536m}"',
      'attempts="${PROXY_MEMORY_ATTEMPTS:-3}"',
      'container_platform="${PROXY_MEMORY_PLATFORM:-}"',
      '--memory "$memory_limit"',
      "{{.State.OOMKilled}}",
      '"/_proxy/health"',
    ]
  ) {
    assertEquals(
      smoke.includes(contract),
      true,
      `missing proxy memory contract ${contract}`,
    );
  }
});

it("proxy binary smoke runs only for same-repository pull requests", async () => {
  const workflow = await Deno.readTextFile(".github/workflows/cicd.yml");
  const jobStart = workflow.indexOf("  tests-proxy-binary:");
  const jobEnd = workflow.indexOf("\n  build-binaries:", jobStart);
  const job = workflow.slice(jobStart, jobEnd);

  assertEquals(
    workflow.includes(
      "if: ${{ (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && github.event_name == 'pull_request' }}",
    ),
    true,
  );
  assertEquals(
    job.includes("persist-credentials: false"),
    true,
    "the pull-request proxy job must not retain checkout credentials",
  );
});

it("full binary bakes the production heap limit as compile-time V8 flags", () => {
  // Compiled binaries ignore DENO_V8_FLAGS at runtime, so the production
  // chart's `--max-old-space-size=4096` never reached the release binary:
  // every heap OOM in 30 days died at V8's ~2 GiB default while the manifest
  // verifiably set 4096 (veryfront-issue-inbox#269). `deno compile --v8-flags`
  // is the only channel through which a compiled artifact gets the flag.
  // 4096 pins the deployment contract: production pods are sized (5 Gi limit)
  // around a 4 GiB heap ceiling.
  const args = createCompileArgs({
    entrypoint: "cli/main.ts",
    extraIncludes: [],
    output: "veryfront",
  });

  assertEquals(
    args.includes("--v8-flags=--max-old-space-size=4096"),
    true,
    `full profile must bake --max-old-space-size=4096 at compile time, got v8 flag args: ${
      JSON.stringify(args.filter((arg) => arg.startsWith("--v8-flags")))
    }`,
  );
});

it("proxy binary keeps V8's default heap ceiling", () => {
  // Proxy pods run under a 1536 MiB memory limit (smoke-proxy-memory.sh pins
  // it). A baked 4 GiB old-space ceiling would let the heap grow past the
  // cgroup limit and turn GC back-pressure into OOMKills.
  const args = createCompileArgs({
    extraIncludes: [],
    output: "veryfront-proxy",
    profile: "proxy",
  });

  assertEquals(
    args.some((arg) => arg.startsWith("--v8-flags")),
    false,
    "the proxy profile must not inherit the full binary's baked heap ceiling",
  );
});

it("compile-time V8 flags govern the compiled binary's real heap limit", async () => {
  // Two legs, both needed for an honest claim:
  //
  // Leg 1 (mechanism): compile a probe with a 3000 MB sentinel old-space and
  // run it. V8 defaults land near ~2 GiB (small hosts) or ~4 GiB (large
  // hosts), never ~3 GiB, so the observed limit can only come from the baked
  // flag -- and the DENO_V8_FLAGS in the child env documents that a runtime
  // override cannot move it.
  //
  // Leg 2 (wiring): compile the same probe with exactly the `--v8-flags`
  // arguments createCompileArgs emits for the release profile and assert the
  // flag is serialized into the binary's trailer (`"v8_flags":[...]`). This
  // is the check that can also run against real release artifacts CI cannot
  // execute (cross-target), and it fails when the build invocation stops
  // passing the flag.
  const dir = await Deno.makeTempDir({ prefix: "veryfront-v8-flags-" });
  try {
    const probe = `${dir}/heap-probe.ts`;
    await Deno.writeTextFile(
      probe,
      'const v8 = process.getBuiltinModule("node:v8");\n' +
        "console.log(Math.round(v8.getHeapStatistics().heap_size_limit / (1024 * 1024)));\n",
    );
    const suffix = Deno.build.os === "windows" ? ".exe" : "";

    const compileProbe = async (name: string, v8FlagArgs: string[]) => {
      const output = `${dir}/${name}`;
      const result = await new Deno.Command(Deno.execPath(), {
        args: [
          "compile",
          "--no-config",
          "--quiet",
          "--allow-all",
          ...v8FlagArgs,
          "--output",
          output,
          probe,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(
        result.success,
        true,
        new TextDecoder().decode(result.stderr),
      );
      return `${output}${suffix}`;
    };

    const sentinelBinary = await compileProbe("heap-sentinel", [
      "--v8-flags=--max-old-space-size=3000",
    ]);
    const run = await new Deno.Command(sentinelBinary, {
      env: { DENO_V8_FLAGS: "--max-old-space-size=8192" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(run.success, true, new TextDecoder().decode(run.stderr));
    const limitMb = Number(new TextDecoder().decode(run.stdout).trim());
    assertEquals(
      limitMb >= 3000 && limitMb <= 3256,
      true,
      `expected heap_size_limit near the 3000 MB sentinel (old space plus young-generation overhead), got ${limitMb} MB -- baked v8-flags do not govern the compiled runtime`,
    );

    const releaseV8FlagArgs = createCompileArgs({
      entrypoint: "cli/main.ts",
      extraIncludes: [],
      output: "veryfront",
    }).filter((arg) => arg.startsWith("--v8-flags"));
    const wiredBinary = await compileProbe(
      "heap-release-flags",
      releaseV8FlagArgs,
    );
    // The trailer serializes baked flags at the tail of a compact JSON
    // array, after Deno's own defaults; the guard matches the joined baked
    // flags plus the closing `]`, so an embedded source file containing the
    // bare quoted flag cannot satisfy it. This assertion doubles as the
    // empirical proof that the tail anchor matches a real artifact on the
    // pinned Deno line.
    const content = new TextDecoder("latin1").decode(
      await Deno.readFile(wiredBinary),
    );
    assertEquals(
      findMissingBakedV8Flags(content, ["--max-old-space-size=4096"]),
      [],
      "the release compile invocation must serialize --max-old-space-size=4096 into the binary trailer; without it production runs at V8's ~2 GiB default (veryfront-issue-inbox#269)",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

it("full binary remains the default compile profile", () => {
  const args = createCompileArgs({
    entrypoint: "cli/main.ts",
    extraIncludes: [],
    output: "veryfront",
  });

  assertEquals(args.includes("extensions/ext-image-sharp/src/index.ts"), true);
  assertEquals(args.includes("dist/framework-src"), true);
  assertEquals(args.includes("scripts/build/proxy-deno.lock"), false);
});
