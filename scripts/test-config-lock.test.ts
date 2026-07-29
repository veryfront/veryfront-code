import { assertEquals, assertThrows } from "#std/assert";
import { walk } from "#std/fs";

function frozenDenoRunChildren(label: string, body: string): void {
  const children = body.split("&&").map((command) => command.trim()).filter((
    command,
  ) => /(?:^|\s)deno run(?:\s|$)/.test(command));
  if (children.length === 0) {
    throw new Error(`${label} must contain a deno run child`);
  }
  for (const child of children) {
    if (!/(?:^|\s)--frozen(?:\s|$)/.test(child)) {
      throw new Error(`${label} deno run child must use --frozen: ${child}`);
    }
  }
}

function permissionFlags(body: string): string[] {
  return [
    ...body.matchAll(/(?:^|\s)(-A|--allow(?:-[a-z-]+)?(?:=[^\s&]+)?)(?=\s|$)/g),
  ]
    .map((match) => match[1]).sort();
}

function commandHasToken(body: string, token: string): boolean {
  return body.split(/\s+/).some((candidate) => candidate === token);
}

Deno.test("script tooling uses an isolated lockfile", async () => {
  const config = JSON.parse(
    await Deno.readTextFile("scripts/test.deno.json"),
  ) as { readonly lock?: string };
  const rootConfig = JSON.parse(
    await Deno.readTextFile("deno.json"),
  ) as { readonly tasks?: Record<string, string> };

  if (config.lock !== "./deno.lock") {
    throw new Error(
      "scripts/test.deno.json must not mutate the root dependency lockfile",
    );
  }

  const scriptsTask = rootConfig.tasks?.["test:scripts"] ?? "";
  if (!scriptsTask.includes("--frozen")) {
    throw new Error("test:scripts must reject changes to the scripts lockfile");
  }
  if (!scriptsTask.includes("scripts/test-config-lock.test.ts")) {
    throw new Error(
      "test:scripts must enforce its lockfile isolation contract",
    );
  }
  if (!scriptsTask.includes("scripts/build/framework-candidates.test.ts")) {
    throw new Error(
      "test:scripts must run the framework candidate regression suite",
    );
  }
  if (!scriptsTask.includes("deno task check:scripts:framework-candidates")) {
    throw new Error(
      "test:scripts must type-check the framework candidate import graph",
    );
  }

  const frameworkCandidateCheck =
    rootConfig.tasks?.["check:scripts:framework-candidates"] ?? "";
  if (
    !frameworkCandidateCheck.includes("--config=scripts/test.deno.json") ||
    !frameworkCandidateCheck.includes("--frozen") ||
    !frameworkCandidateCheck.includes(
      "scripts/build/framework-candidates.ts",
    ) ||
    !frameworkCandidateCheck.includes(
      "scripts/build/framework-candidates.test.ts",
    )
  ) {
    throw new Error(
      "framework candidate scripts must type-check against the frozen scripts configuration",
    );
  }

  const generatedFrameworkCandidateCheck =
    rootConfig.tasks?.["generate:framework-candidates:check"] ?? "";
  if (!generatedFrameworkCandidateCheck.includes("--frozen")) {
    throw new Error(
      "generate:framework-candidates:check must reject root lockfile drift",
    );
  }

  const templateFormatCheck = rootConfig.tasks?.["fmt:templates:check"] ?? "";
  if (
    !templateFormatCheck.includes("--check") ||
    !templateFormatCheck.includes("--config=cli/templates/deno.json")
  ) {
    throw new Error(
      "fmt:templates:check must enforce the isolated template formatter configuration",
    );
  }

  const rootFormatCheck = rootConfig.tasks?.["fmt:check"] ?? "";
  if (!rootFormatCheck.includes("deno task fmt:templates:check")) {
    throw new Error(
      "fmt:check must include the production template source formatter gate",
    );
  }

  const npmBuildTask = rootConfig.tasks?.["build:npm"] ?? "";
  if (
    !npmBuildTask.includes("--config=scripts/test.deno.json") ||
    !npmBuildTask.includes("--frozen")
  ) {
    throw new Error(
      "build:npm must resolve build-only dependencies from the frozen scripts lockfile",
    );
  }
});

Deno.test("strict audit and extension checks use isolated frozen least-privilege tasks", async () => {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as {
    tasks: Record<string, string>;
  };
  const strict = config.tasks["lint:core-deps:strict"] ?? "";
  if (
    !strict.includes("--config=scripts/test.deno.json") ||
    !strict.includes("--frozen") ||
    !strict.includes("scripts/lint/audit-core-deps-strict.ts")
  ) {
    throw new Error(
      "strict audit must use its frozen isolated script configuration",
    );
  }
  assertEquals(permissionFlags(strict), ["--allow-read", "--allow-write"]);
  assertEquals(
    config.tasks["lint:core-deps"],
    "deno run --allow-read scripts/lint/audit-core-deps.ts",
  );

  const extensions = config.tasks["typecheck:extensions"] ?? "";
  if (
    !extensions.includes("--config=scripts/test.deno.json") ||
    !extensions.includes("--frozen") ||
    !extensions.includes("scripts/typecheck/check-extension-workspaces.ts")
  ) {
    throw new Error(
      "extension typecheck must use its frozen isolated script configuration",
    );
  }
  assertEquals(permissionFlags(extensions), ["--allow-read", "--allow-run"]);
});

Deno.test("every nested generator and binary build child is frozen", async () => {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as {
    tasks: Record<string, string>;
  };
  for (
    const task of [
      "generate",
      "generate:manifests:check",
      "build:prepare",
      "build:npm",
      "build",
    ]
  ) frozenDenoRunChildren(task, config.tasks[task] ?? "");

  assertThrows(
    () =>
      frozenDenoRunChildren(
        "mutation-probe",
        "deno run --frozen -A one.ts && deno run -A two.ts",
      ),
    Error,
    "must use --frozen",
  );

  const setupAction = await Deno.readTextFile(
    ".github/actions/setup-deno/action.yml",
  );
  const generator =
    setupAction.split("\n").find((line) =>
      line.includes("deno run") &&
      line.includes("generate-templates-manifest.ts")
    ) ?? "";
  if (!generator.includes("--frozen")) {
    throw new Error("setup-deno template generator must use --frozen");
  }
});

Deno.test("root scope, extension formatting, and aggregate gates stay aligned", async () => {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as {
    exclude?: string[];
    test?: { include?: string[] };
    tasks: Record<string, string>;
  };
  assertEquals(config.test?.include, ["src/", "cli/", "react/", "tests/"]);
  if (
    config.exclude?.includes("extensions/") ||
    config.exclude?.includes("!extensions/ext-parser-parse5/")
  ) throw new Error("root exclusions must not hide extension workspaces");

  const extensionFormat = config.tasks["fmt:extensions:check"] ?? "";
  if (!extensionFormat.includes("deno fmt --check extensions/")) {
    throw new Error(
      "fmt:extensions:check must cover the complete extension tree",
    );
  }
  if (
    !(config.tasks["fmt:check"] ?? "").includes(
      "deno task fmt:extensions:check",
    )
  ) {
    throw new Error("fmt:check must include extension formatting");
  }
  const taskOneScriptFiles = [
    "scripts/lib/path-containment.ts",
    "scripts/lib/path-containment.test.ts",
    "scripts/lint/audit-core-deps-strict.ts",
    "scripts/lint/audit-core-deps-strict.test.ts",
    "scripts/lint/core-production-roots.ts",
    "scripts/lint/core-production-roots.test.ts",
    "scripts/lint/source-import-collector.ts",
    "scripts/lint/source-import-collector.test.ts",
    "scripts/typecheck/check-extension-workspaces.ts",
    "scripts/typecheck/check-extension-workspaces.test.ts",
    "scripts/test-config-lock.test.ts",
    "scripts/test.deno.json",
  ];
  const scriptFormat = config.tasks["fmt:scripts:task1:check"] ?? "";
  if (!scriptFormat.includes("--config=scripts/test.deno.json")) {
    throw new Error(
      "Task 1 script formatting must use the scripts configuration",
    );
  }
  for (const path of taskOneScriptFiles) {
    if (!commandHasToken(scriptFormat, path)) {
      throw new Error(`Task 1 script formatting does not cover ${path}`);
    }
  }
  if (
    !(config.tasks["fmt:check"] ?? "").includes(
      "deno task fmt:scripts:task1:check",
    )
  ) throw new Error("fmt:check must include Task 1 script formatting");
  for (const task of ["verify", "verify:quick"]) {
    if (
      !(config.tasks[task] ?? "").includes("deno task typecheck:extensions")
    ) {
      throw new Error(`${task} must include extension typechecking`);
    }
    if ((config.tasks[task] ?? "").includes("lint:core-deps:strict")) {
      throw new Error(`${task} must not promote the expected-red strict audit`);
    }
  }
  if (!(config.tasks.verify ?? "").includes("deno task test:scripts")) {
    throw new Error("verify must run script regression suites");
  }
  if (
    !(config.tasks["build:npm"] ?? "").startsWith(
      "deno task typecheck:extensions &&",
    )
  ) {
    throw new Error(
      "build:npm must gate extension workspaces before package generation",
    );
  }
});

Deno.test("every script regression has an explicit task owner", async () => {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as {
    tasks: Record<string, string>;
  };
  const discovered: string[] = [];
  for await (const entry of walk("scripts", { exts: [".ts", ".js"] })) {
    if (entry.isFile && /\.test\.(?:ts|js)$/.test(entry.path)) {
      discovered.push(entry.path.replaceAll("\\", "/"));
    }
  }
  discovered.sort();
  if (discovered.length === 0) {
    throw new Error("script test discovery found zero files");
  }

  const dedicatedTasks: Record<string, string> = {
    "scripts/codemods/migrate-chat-composition.test.ts": "lint:chat-ratchets",
    "scripts/lint/audit-parser-extension-boundary.test.ts":
      "test:scripts:parser-extension-boundary",
    "scripts/postinstall-lib.test.js": "test:scripts:postinstall",
    "scripts/storybook/storybook-workbench.test.ts": "storybook:check",
  };
  const scriptsTask = config.tasks["test:scripts"] ?? "";
  assertEquals(
    commandHasToken("deno test scripts/myfoo.test.ts", "scripts/foo.test.ts"),
    false,
  );
  for (const path of discovered) {
    const dedicated = dedicatedTasks[path];
    if (dedicated) {
      if (!commandHasToken(config.tasks[dedicated] ?? "", path)) {
        throw new Error(`${path} is missing from dedicated task ${dedicated}`);
      }
    } else if (!commandHasToken(scriptsTask, path)) {
      throw new Error(`${path} has no script-test task owner`);
    }
  }
  if (!scriptsTask.includes("deno task test:scripts:postinstall")) {
    throw new Error(
      "test:scripts must invoke the Node-native postinstall suite",
    );
  }
});

Deno.test("CI uses canonical format, script, extension, and frozen build gates", async () => {
  const workflow = await Deno.readTextFile(".github/workflows/cicd.yml");
  if (!workflow.includes("format) deno task fmt:check ;;")) {
    throw new Error("CI format must use the canonical formatter task");
  }
  if (!workflow.includes("deno task test:scripts")) {
    throw new Error("CI must run script regression suites");
  }
  if (
    !workflow.includes(
      "typecheck) deno task typecheck && deno task typecheck:extensions ;;",
    )
  ) {
    throw new Error("CI typecheck must include extension workspaces");
  }
  const extensionStep = workflow.indexOf("- name: Check extension workspaces");
  const consumerStep = workflow.indexOf(
    "- name: Check published package types",
  );
  if (extensionStep < 0 || consumerStep < 0 || extensionStep > consumerStep) {
    throw new Error("npm smoke must typecheck extensions before package types");
  }
  if (
    !/deno run --frozen -A scripts\/build\/compile-binary\.ts/.test(workflow)
  ) {
    throw new Error("direct CI binary compilation must use --frozen");
  }
  if (workflow.includes("lint:core-deps:strict")) {
    throw new Error("CI must not promote the expected-red strict audit");
  }
});
