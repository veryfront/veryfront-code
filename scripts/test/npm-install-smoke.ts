/**
 * Clean-room install/import smoke for the generated npm packages.
 *
 * Verifies, against the real `deno task build:npm` artifacts installed into a
 * throwaway npm project, that:
 *   1. a `veryfront` install with co-published required packages runs the CLI
 *      and activates first-party extensions under Node and Deno
 *   2. the @huggingface/transformers optional peer is declared
 *   3. loading a missing extension fails naming the installable package
 *   4. installing @veryfront/ext-auth-jwt makes the extension load
 *   5. a broken transitive dependency surfaces the real error, not a
 *      misleading "extension not installed" skip
 *   6. `veryfront/scaffold` resolves by its published subpath and materializes
 *      a project, so a hosted "create project" flow never has to walk into the
 *      package's build output to reach the starter templates
 *   7. TypeScript config graphs and CommonJS requires build at the Node 22.3
 *      minimum without native type stripping or staging-directory resolution
 *   8. the packed ai-agent starter starts under Node, renders a page, and
 *      loads an API route without unresolved or runtime-specific generated
 *      helpers
 *   9. a packed agent workflow reaches a non-responsive provider, respects
 *      its configured deadline, persists failure, and leaves the server
 *      healthy
 *
 * The runtime under test stays the packed npm artifact under the ambient Node
 * version: this orchestrator only spawns `npm`, `node`, and `deno eval`
 * against the installed package; it never imports the repository's runtime
 * sources into the smoke path.
 *
 * Requires: `deno task build:npm` output in ./npm, node + npm on PATH.
 */

import { fromFileUrl } from "#std/path";
import {
  formatNpmCompatibilityArtifactCliError,
  loadNpmCompatibilityArtifact,
} from "../ci/npm-compatibility-artifact.ts";

const ROOT_DIR = fromFileUrl(new URL("../../", import.meta.url)).replace(
  /\/$/,
  "",
);

const AUTO_LOADED_EXTENSIONS = [
  "ext-bundler-esbuild",
  "ext-content-mdx",
  "ext-css-tailwind",
  "ext-dev-ui-react",
  "ext-node-websocket-ws",
  "ext-parser-babel",
  "ext-yaml",
] as const;
const AUTH_EXTENSION = "ext-auth-jwt";
const AUTH_PACKAGE = "@veryfront/ext-auth-jwt";

class SmokeFailure extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly devLog?: string,
  ) {
    super(message);
  }
}

/** Mirrors the Bash harness's SMOKE_FAILURE_STATUS: 1 outside registry mode,
 * 22 while validating registry configuration, 21 once artifacts install. */
let smokeFailureStatus = 1;

function fail(message: string, devLog?: string): never {
  throw new SmokeFailure(message, smokeFailureStatus, devLog);
}

function failRegistryInstall(): never {
  throw new SmokeFailure("exact-version registry install failed", 20);
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  combined: string;
}

const decoder = new TextDecoder();

async function run(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs: number;
  },
): Promise<RunResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const output = await new Deno.Command(command, {
      args,
      cwd: options.cwd,
      env: options.env,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: controller.signal,
    }).output();
    const stdout = decoder.decode(output.stdout);
    const stderr = decoder.decode(output.stderr);
    return { code: output.code, stdout, stderr, combined: stdout + stderr };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `${command} ${args.join(" ")} timed out after ${options.timeoutMs}ms`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runChecked(
  step: string,
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeoutMs: number },
): Promise<RunResult> {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    fail(`${step}: ${command} exited ${result.code}\n${result.combined}`);
  }
  return result;
}

/** Redact env values with secret-shaped names before echoing diagnostics. */
function sanitizeDiagnostics(text: string): string {
  let sanitized = text;
  for (const [name, value] of Object.entries(Deno.env.toObject())) {
    if (
      value.length >= 4 &&
      /(TOKEN|SECRET|PASSWORD|API_?KEY|CREDENTIAL|AUTH)/i.test(name)
    ) {
      sanitized = sanitized.replaceAll(value, `<${name}>`);
    }
  }
  return sanitized;
}

/** Deterministic ordinal ordering, matching the Bash glob expansion order. */
function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function listTarballs(
  directory: string,
  pattern: RegExp,
  description: string,
): Promise<string[]> {
  const matches: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isFile && pattern.test(entry.name)) {
      matches.push(`./${entry.name}`);
    }
  }
  if (matches.length === 0) fail(`no packed tarball matched ${description}`);
  return matches.sort(compareOrdinal);
}

interface InstallPlan {
  rootInstallSpecs: string[];
  authInstallSpecs: string[];
  npmEnv: Record<string, string> | undefined;
  registryMode: boolean;
}

function parseRegistryConfiguration(): {
  registryUrl: string;
  rootSpecs: string[];
  authSpec: string;
} {
  const version = Deno.env.get("VF_NPM_REGISTRY_VERSION")!;
  const packages = Deno.env.get("VF_NPM_REGISTRY_PACKAGES");
  if (!packages) fail("registry package list is required in registry mode");
  const registryUrl = Deno.env.get("VF_NPM_REGISTRY_URL") ||
    "https://registry.npmjs.org";
  if (registryUrl.includes("?") || registryUrl.includes("#")) {
    fail("registry URL must not include a query or fragment");
  }
  if (!/^https?:\/\//.test(registryUrl)) {
    fail("registry URL must use HTTP or HTTPS");
  }
  const authority = registryUrl.replace(/^[a-z]+:\/\//, "").split("/", 1)[0];
  if (authority === "" || authority.includes("@")) {
    fail("registry URL authority is invalid");
  }

  const rootSpecs: string[] = [];
  let authSpec = "";
  for (const line of packages.split("\n")) {
    const packageName = line.trim();
    if (!packageName) continue;
    if (
      packageName.length > 214 ||
      !/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName)
    ) {
      fail("registry package list contains an invalid package name");
    }
    const spec = `${packageName}@${version}`;
    if (packageName === AUTH_PACKAGE) {
      authSpec = spec;
    } else {
      rootSpecs.push(spec);
    }
  }
  if (rootSpecs.length === 0) {
    fail("registry package list has no root install packages");
  }
  if (!authSpec) {
    fail(`registry package list is missing ${AUTH_PACKAGE}`);
  }
  return { registryUrl, rootSpecs, authSpec };
}

async function prepareArtifacts(workDir: string): Promise<InstallPlan> {
  if (Deno.env.get("VF_NPM_REGISTRY_VERSION")) {
    smokeFailureStatus = 22;
    const { registryUrl, rootSpecs, authSpec } = parseRegistryConfiguration();
    smokeFailureStatus = 21;
    return {
      rootInstallSpecs: rootSpecs,
      authInstallSpecs: [authSpec],
      npmEnv: { NPM_CONFIG_REGISTRY: registryUrl },
      registryMode: true,
    };
  }

  const packDir = Deno.env.get("VF_NPM_PACK_DIR");
  if (packDir) {
    const stat = await Deno.stat(packDir).catch(() => undefined);
    if (!stat?.isDirectory) fail("canonical npm artifact directory missing");
    try {
      await loadNpmCompatibilityArtifact(packDir);
    } catch (error) {
      fail(
        `canonical npm artifact verification failed: ${
          formatNpmCompatibilityArtifactCliError(error, "verify")
        }`,
      );
    }
    for await (const entry of Deno.readDir(packDir)) {
      if (entry.isFile && entry.name.endsWith(".tgz")) {
        await Deno.copyFile(
          `${packDir}/${entry.name}`,
          `${workDir}/${entry.name}`,
        );
      }
    }
  } else {
    const npmDir = await Deno.stat(`${ROOT_DIR}/npm`).catch(() => undefined);
    if (!npmDir?.isDirectory) {
      fail("npm build output missing; run 'deno task build:npm' first");
    }
    const packageDirs = [`${ROOT_DIR}/npm`];
    for (const extension of [...AUTO_LOADED_EXTENSIONS, AUTH_EXTENSION]) {
      const directory = `${ROOT_DIR}/npm/extensions/${extension}`;
      const stat = await Deno.stat(directory).catch(() => undefined);
      if (!stat?.isDirectory) fail(`${extension} package output missing`);
      packageDirs.push(directory);
    }
    for (const directory of packageDirs) {
      await runChecked("npm pack", "npm", [
        "pack",
        "--silent",
        "--pack-destination",
        workDir,
      ], { cwd: directory, timeoutMs: 120_000 });
    }
  }

  const rootInstallSpecs = [
    ...await listTarballs(workDir, /^veryfront-\d.*\.tgz$/, "veryfront"),
  ];
  for (const extension of AUTO_LOADED_EXTENSIONS) {
    rootInstallSpecs.push(
      ...await listTarballs(
        workDir,
        new RegExp(`^veryfront-${extension}-.*\\.tgz$`),
        extension,
      ),
    );
  }
  return {
    rootInstallSpecs,
    authInstallSpecs: await listTarballs(
      workDir,
      new RegExp(`^veryfront-${AUTH_EXTENSION}-.*\\.tgz$`),
      AUTH_EXTENSION,
    ),
    npmEnv: undefined,
    registryMode: false,
  };
}

async function npmInstall(
  workDir: string,
  plan: InstallPlan,
  specs: string[],
): Promise<void> {
  const result = await run("npm", [
    "install",
    "--no-fund",
    "--no-audit",
    "--silent",
    "--ignore-scripts",
    ...specs,
  ], { cwd: workDir, env: plan.npmEnv, timeoutMs: 600_000 });
  if (result.code !== 0) {
    if (plan.registryMode) failRegistryInstall();
    fail(`npm install failed\n${result.combined}`);
  }
}

const DEFERRED_PARSER_SCRIPT = `
const m = await import('./node_modules/veryfront/esm/src/extensions/builtin-extensions.js');
const { getDeferredExtensionState } = await import(
  './node_modules/veryfront/esm/src/extensions/deferred-extension.js'
);
const resolved = m.createDeferredBuiltinExtension({
  name: 'ext-parser-babel',
  origin: 'veryfront/ext-parser-babel',
  sourceDirectory: 'ext-parser-babel',
  availability: 'package',
  contracts: { provides: ['CodeParser'] },
  capabilities: [],
});
let codeParser;
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const deferred = getDeferredExtensionState(resolved);
if (!deferred) throw new Error('Parser extension was not deferred');
const extension = await deferred.load(logger);
if (!extension) throw new Error('Parser extension failed to load');
await extension.setup?.({
  get() {},
  require() { throw new Error('unexpected contract requirement'); },
  provide(name, impl) { if (name === 'CodeParser') codeParser = impl; },
  config: {},
  logger,
});
if (!codeParser) throw new Error('CodeParser was not registered');
const ast = await codeParser.parse({
  code: 'export default function Page(): JSX.Element { return <main />; }',
  filePath: 'app/page.tsx',
});
if (ast?.type !== 'File') throw new Error('TSX parse failed');
await extension.teardown?.();
`;

const DENO_BUNDLER_SCRIPT = `
const loader = await import('./node_modules/veryfront/esm/src/extensions/first-party-import.js');
const extension = await loader.importFirstPartyExtensionModule(
  'ext-bundler-esbuild',
  '@veryfront/ext-bundler-esbuild',
);
if (typeof extension.EsbuildBundler !== 'function') {
  throw new Error('Deno could not load the packed bundler extension');
}
`;

const AUTH_IMPORT_SCRIPT = `
import('./node_modules/veryfront/esm/src/extensions/first-party-import.js').then(async (m) => {
  await m.importFirstPartyExtensionModule('ext-auth-jwt', '@veryfront/ext-auth-jwt');
  console.log('UNEXPECTEDLY_LOADED');
}).catch((e) => { console.error(e.message); process.exit(1); });
`;

const AUTH_LOADED_SCRIPT = `
import('./node_modules/veryfront/esm/src/extensions/first-party-import.js').then(async (m) => {
  const mod = await m.importFirstPartyExtensionModule('ext-auth-jwt', '@veryfront/ext-auth-jwt');
  if (typeof mod.createAuthProvider !== 'function') process.exit(1);
});
`;

// Deliberately a bare specifier, resolved by Node against the package's own
// `exports`. The deep `./node_modules/veryfront/esm/...` paths used above
// bypass that map, so only this proves the subpath is actually exported —
// the failure a hosted create-project flow would hit, and the one this
// repository's in-tree tests cannot see because they all import by relative
// path. Without the entry it fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
const SCAFFOLD_SCRIPT = `
const { materializeScaffold, listScaffoldTemplates } = await import('veryfront/scaffold');
const { mkdir, writeFile } = await import('node:fs/promises');
const { dirname, resolve, sep } = await import('node:path');
const names = listScaffoldTemplates();
for (const name of ['minimal', 'ai-agent', 'agentic-workflow']) {
  if (!names.includes(name)) throw new Error('scaffold cannot create ' + name);
}
const { files } = await materializeScaffold({
  template: 'ai-agent',
  projectName: 'smoke-app',
});
const paths = files.map((file) => file.path);
for (const required of ['package.json', 'AGENTS.md', '.gitignore']) {
  if (!paths.includes(required)) {
    throw new Error('materialized project is missing ' + required);
  }
}
const pkg = JSON.parse(files.find((file) => file.path === 'package.json').content);
if (pkg.name !== 'smoke-app') {
  throw new Error('materialized package.json has the wrong name: ' + pkg.name);
}
const projectRoot = resolve('.');
for (const file of files) {
  const target = resolve(projectRoot, file.path);
  if (!target.startsWith(projectRoot + sep)) {
    throw new Error('materialized project contains an invalid path: ' + file.path);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, file.content);
}
`;

async function checkRootInstall(workDir: string): Promise<void> {
  console.log(
    "== 1. root install: CLI and deferred parser extension run under Node",
  );
  const version = await run("node", [
    "node_modules/veryfront/bin/veryfront.js",
    "--version",
  ], { cwd: workDir, timeoutMs: 120_000 });
  if (version.code !== 0 || !version.stdout.includes("Veryfront CLI")) {
    fail("CLI --version failed on root install");
  }
  const schema = await run("node", [
    "node_modules/veryfront/bin/veryfront.js",
    "schema",
    "--json",
  ], { cwd: workDir, timeoutMs: 120_000 });
  if (schema.code !== 0) {
    fail(
      "CLI schema --json failed on root install (bundled ext-schema-zod broken)",
    );
  }

  const pins = await run("node", [
    "-e",
    `
const p = require('./node_modules/veryfront/package.json');
if (p.dependencies?.['@veryfront/ext-parser-babel'] !== p.version) process.exit(1);
if (p.dependencies?.['@veryfront/ext-dev-ui-react'] !== p.version) process.exit(1);
if (p.dependencies?.['@veryfront/ext-yaml'] !== p.version) process.exit(1);
if (p.dependencies?.['@veryfront/ext-node-websocket-ws'] !== p.version) process.exit(1);
`,
  ], { cwd: workDir, timeoutMs: 120_000 });
  if (pins.code !== 0) {
    fail("root package does not pin standard extensions to its version");
  }

  const deferred = await run("node", [
    "--input-type=module",
    "-e",
    DEFERRED_PARSER_SCRIPT,
  ], { cwd: workDir, timeoutMs: 120_000 });
  if (deferred.code !== 0) {
    fail(
      `root deferred builtin did not register a working CodeParser\n${deferred.combined}`,
    );
  }

  console.log(
    "== 1b. root install: workspace-source fallback loads under Deno",
  );
  const denoLoad = await run("deno", [
    "eval",
    "--node-modules-dir=auto",
    DENO_BUNDLER_SCRIPT,
  ], { cwd: workDir, timeoutMs: 120_000 });
  if (denoLoad.code !== 0) {
    fail(
      `Deno could not load the packed bundler extension\n${denoLoad.combined}`,
    );
  }
}

async function checkOptionalPeer(workDir: string): Promise<void> {
  console.log("== 2. root install: transformers optional peer declared");
  const peers = await run("node", [
    "-e",
    `
const p = require('./node_modules/veryfront/package.json');
if (!p.peerDependencies?.['@huggingface/transformers']) process.exit(1);
if (p.peerDependenciesMeta?.['@huggingface/transformers']?.optional !== true) process.exit(1);
`,
  ], { cwd: workDir, timeoutMs: 120_000 });
  if (peers.code !== 0) {
    fail(
      "@huggingface/transformers optional peer missing from root package.json",
    );
  }
}

async function checkMissingExtension(workDir: string): Promise<void> {
  console.log(
    "== 3. root install: missing extension failure names the installable package",
  );
  const missing = await run("node", ["-e", AUTH_IMPORT_SCRIPT], {
    cwd: workDir,
    timeoutMs: 120_000,
  });
  if (missing.code === 0) {
    fail("ext-auth-jwt import unexpectedly succeeded on bare install");
  }
  if (
    !missing.combined.includes(
      "install @veryfront/ext-auth-jwt alongside veryfront",
    )
  ) {
    fail(
      `missing-extension error lacks the install hint: ${missing.combined}`,
    );
  }
}

async function checkAuthExtensionLoads(
  workDir: string,
  plan: InstallPlan,
): Promise<void> {
  console.log("== 4. with @veryfront/ext-auth-jwt installed: extension loads");
  await npmInstall(workDir, plan, plan.authInstallSpecs);
  const loaded = await run("node", ["-e", AUTH_LOADED_SCRIPT], {
    cwd: workDir,
    timeoutMs: 120_000,
  });
  if (loaded.code !== 0) {
    fail(
      `ext-auth-jwt did not load after installing @veryfront/ext-auth-jwt\n${loaded.combined}`,
    );
  }
}

async function checkBrokenTransitiveDependency(workDir: string): Promise<void> {
  console.log("== 5. broken transitive dependency surfaces the real error");
  await Deno.rename(
    `${workDir}/node_modules/jose`,
    `${workDir}/node_modules/jose.smoke-removed`,
  );
  let broken: RunResult;
  try {
    broken = await run("node", ["-e", AUTH_IMPORT_SCRIPT], {
      cwd: workDir,
      timeoutMs: 120_000,
    });
  } finally {
    await Deno.rename(
      `${workDir}/node_modules/jose.smoke-removed`,
      `${workDir}/node_modules/jose`,
    );
  }
  if (broken.code === 0) {
    fail("ext-auth-jwt import unexpectedly succeeded with jose removed");
  }
  if (!broken.combined.includes("jose")) {
    fail(
      `broken transitive dependency error does not name the real missing package: ${broken.combined}`,
    );
  }
  if (
    broken.combined.includes(
      "install @veryfront/ext-auth-jwt alongside veryfront",
    )
  ) {
    fail(
      `broken transitive dependency was misclassified as a missing extension: ${broken.combined}`,
    );
  }
}

async function checkScaffoldExport(workDir: string): Promise<void> {
  console.log("== 6. scaffold resolves through the published exports map");
  const scaffold = await run("node", [
    "--input-type=module",
    "-e",
    SCAFFOLD_SCRIPT,
  ], { cwd: workDir, timeoutMs: 120_000 });
  if (scaffold.code !== 0) {
    fail(
      `veryfront/scaffold did not resolve from an installed package\n${scaffold.combined}`,
    );
  }
}

async function writeFixtureTree(
  files: Record<string, string>,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.writeTextFile(path, content);
  }
}

async function checkNodeTypeScriptConfig(workDir: string): Promise<void> {
  console.log(
    "== 7. TypeScript config loads without native Node type stripping",
  );
  const configSmoke = `${workDir}/node-config-smoke`;
  const esmDependency = `${workDir}/node_modules/vf-esm-config-condition-smoke`;
  const nestedHelper = `${configSmoke}/config-helper`;
  const nestedDependency =
    `${nestedHelper}/node_modules/vf-nested-config-smoke`;

  await writeFixtureTree({
    [`${configSmoke}/package.json`]: `{
  "type": "module",
  "imports": {
    "#config-values": "./config-values.ts"
  }
}
`,
    [`${esmDependency}/package.json`]: `{
  "name": "vf-esm-config-condition-smoke",
  "type": "module",
  "exports": {
    "node": {
      "import": "./import.js"
    }
  }
}
`,
    [`${esmDependency}/import.js`]: `export const suffix = "config smoke";
`,
    [`${configSmoke}/config-values.ts`]:
      `import { suffix } from "vf-esm-config-condition-smoke";

if (!import.meta.url.endsWith("/config-values.ts")) {
  throw new Error("Config helper import.meta.url did not preserve the source location");
}
if (!import.meta.resolve("vf-esm-config-condition-smoke").endsWith("/import.js")) {
  throw new Error("Config helper import.meta.resolve did not use ESM package conditions");
}

export const title: string = \`Node minimum \${suffix}\`;
`,
    [`${nestedDependency}/package.json`]: `{
  "name": "vf-nested-config-smoke",
  "type": "module",
  "exports": {
    "import": "./import.js"
  }
}
`,
    [`${nestedDependency}/import.js`]: `export default "nested config smoke";
`,
    [`${nestedHelper}/values.ts`]: `import nested from "vf-nested-config-smoke";

if (
  !import.meta.resolve("vf-nested-config-smoke").endsWith(
    "/config-helper/node_modules/vf-nested-config-smoke/import.js"
  )
) {
  throw new Error("Nested config dependency did not resolve from its declaring module");
}

export const nestedTitle: string = nested;
`,
    [`${configSmoke}/file-url-values.ts`]:
      `export const fileUrlTitle: string = "file URL config smoke";
`,
    [`${configSmoke}/app/page.tsx`]:
      `export default function Page(): React.ReactNode {
  return <main>Node minimum config smoke</main>;
}
`,
  });

  const fileUrl = (await runChecked("config file URL", "node", [
    "-e",
    'console.log(require("node:url").pathToFileURL(process.argv[1]).href)',
    `${configSmoke}/file-url-values.ts`,
  ], { timeoutMs: 30_000 })).stdout.trim();

  await Deno.writeTextFile(
    `${configSmoke}/veryfront.config.ts`,
    `const { defineConfig } = await import("veryfront");
import { title } from "#config-values";
import { nestedTitle } from "./config-helper/values.ts";
import { fileUrlTitle } from "${fileUrl}";

if (!import.meta.url.endsWith("/veryfront.config.ts")) {
  throw new Error("Config import.meta.url did not preserve the source location");
}

export default defineConfig({ title: title + " " + nestedTitle + " " + fileUrlTitle });
`,
  );

  const nodeHelp = await runChecked("node --help", "node", ["--help"], {
    timeoutMs: 30_000,
  });
  const stripTypesFlags = nodeHelp.stdout.includes("--no-strip-types")
    ? ["--no-strip-types"]
    : nodeHelp.stdout.includes("--no-experimental-strip-types")
    ? ["--no-experimental-strip-types"]
    : [];

  const esmBuild = await run("node", [
    ...stripTypesFlags,
    "../node_modules/veryfront/bin/veryfront.js",
    "build",
  ], {
    cwd: configSmoke,
    env: { VERYFRONT_NO_UPDATE_CHECK: "1" },
    timeoutMs: 300_000,
  });
  if (esmBuild.code !== 0) {
    fail(
      `TypeScript config module graph required Node native type stripping\n${esmBuild.combined}`,
    );
  }

  const cjsSmoke = `${workDir}/node-cjs-config-smoke`;
  const cjsDependency = `${workDir}/node_modules/vf-cjs-config-condition-smoke`;
  await writeFixtureTree({
    [`${cjsSmoke}/package.json`]: `{ "type": "commonjs" }
`,
    [`${cjsDependency}/package.json`]: `{
  "name": "vf-cjs-config-condition-smoke",
  "type": "module",
  "exports": {
    "require": "./require.cjs",
    "import": "./import.js"
  }
}
`,
    [`${cjsDependency}/require.cjs`]: `module.exports = "require-condition";
`,
    [`${cjsDependency}/import.js`]: `export default "wrong import condition";
`,
    [`${cjsSmoke}/veryfront.config.ts`]: `const path = require("node:path");
const title: string = require("vf-cjs-config-condition-smoke");
const filename = path.basename(__filename);
module.exports = {
  title: \`\${title} \${filename}\`,
  build: { outDir: \`dist-\${title}-\${filename}\` },
};
`,
    [`${cjsSmoke}/app/page.tsx`]:
      `export default function Page(): React.ReactNode {
  return <main>CommonJS config smoke</main>;
}
`,
  });

  const cjsBuild = await run("node", [
    "../node_modules/veryfront/bin/veryfront.js",
    "build",
  ], {
    cwd: cjsSmoke,
    env: { VERYFRONT_NO_UPDATE_CHECK: "1" },
    timeoutMs: 300_000,
  });
  if (cjsBuild.code !== 0) {
    fail(
      `CommonJS config requires did not resolve from the original project\n${cjsBuild.combined}`,
    );
  }
  const canary = await Deno.stat(
    `${cjsSmoke}/dist-require-condition-veryfront.config.ts`,
  ).catch(() => undefined);
  if (!canary?.isDirectory) {
    fail(
      "CommonJS config require condition or original filename canary was not applied",
    );
  }
}

async function writeStarterFixtures(workDir: string): Promise<void> {
  await writeFixtureTree({
    [`${workDir}/app/api/npm-smoke/route.ts`]:
      `export function GET(): Response {
  return Response.json({ ok: true });
}
`,
    // The fixture points ANTHROPIC_BASE_URL at its own dev server, so the
    // provider transport reaches `/api/npm-black-hole` as a server-to-server
    // POST holding no `__Host-vf_csrf` cookie. No third-party API client can
    // perform double-submit, and `security.csrf.excludePaths` is the
    // documented remedy for exactly that. It is scoped to the stand-in
    // provider route; the workflow routes the browser calls stay enforced,
    // and the smoke echoes their token below.
    [`${workDir}/veryfront.config.ts`]: `export default {
  security: {
    csrf: {
      excludePaths: ["/api/npm-black-hole"],
    },
  },
};
`,
    [`${workDir}/app/api/npm-black-hole/messages/route.ts`]:
      `export async function POST(request: Request): Promise<Response> {
  const body = await request.json() as { model?: unknown };
  const url = new URL(request.url);
  if (
    url.pathname !== "/api/npm-black-hole/messages" ||
    request.headers.get("x-api-key") !== "npm-smoke-key" ||
    body.model !== "claude-haiku-4-5-20251001"
  ) {
    return Response.json({ error: "unexpected Anthropic request" }, { status: 400 });
  }
  console.log("NPM_SMOKE_BLACK_HOLE_RECEIVED");
  return await new Promise<Response>(() => {});
}
`,
    [`${workDir}/agents/timeout-smoke.ts`]:
      `import { agent } from "veryfront/agent";

export default agent({
  id: "timeout-smoke",
  model: "anthropic/claude-haiku-4-5-20251001",
  system: "Reply with OK.",
  maxSteps: 1,
});
`,
    [`${workDir}/workflows/timeout-smoke.ts`]:
      `import { agentStep, workflow } from "veryfront/workflow";
import { defineSchema } from "veryfront/schemas";

export default workflow({
  id: "timeout-smoke",
  inputSchema: defineSchema((v) => v.object({ message: v.string() }))(),
  steps: [
    agentStep("call-provider", "timeout-smoke", {
      input: (context) => (context.input as { message: string }).message,
      timeout: "2s",
    }),
  ],
});
`,
    [`${workDir}/lib/workflows.ts`]:
      `import { getAgent, getAllAgentIds } from "veryfront/agent";
import { toolRegistry } from "veryfront/tool";
import { createWorkflowClient, type Workflow } from "veryfront/workflow";
import timeoutSmoke from "../workflows/timeout-smoke.ts";

const globalScope = globalThis as typeof globalThis & {
  npmSmokeWorkflowClient?: ReturnType<typeof createWorkflowClient>;
};

export const workflows = globalScope.npmSmokeWorkflowClient ??= createWorkflowClient({
  executor: {
    stepExecutor: {
      agentRegistry: { get: getAgent, list: getAllAgentIds },
      toolRegistry,
    },
  },
});

workflows.register(timeoutSmoke as Workflow<unknown, unknown>);
`,
    [`${workDir}/app/api/workflows/[...path]/route.ts`]:
      `import { createWorkflowHandler } from "veryfront/workflow";
import { workflows } from "../../../../lib/workflows.ts";

export const { GET, POST } = createWorkflowHandler(workflows, {
  authorize: () => "npm-smoke-test",
});
`,
  });
}

interface DevServer {
  child: Deno.ChildProcess;
  exited: () => boolean;
  status: Promise<Deno.CommandStatus>;
  log: () => string;
  pumps: Promise<void>[];
}

function pumpStream(
  stream: ReadableStream<Uint8Array>,
  chunks: string[],
): Promise<void> {
  const streamDecoder = new TextDecoder();
  return (async () => {
    for await (const chunk of stream) {
      chunks.push(streamDecoder.decode(chunk, { stream: true }));
    }
    chunks.push(streamDecoder.decode());
  })().catch(() => {});
}

function startDevServer(workDir: string, port: string): DevServer {
  const child = new Deno.Command("node", {
    args: [
      "node_modules/veryfront/bin/veryfront.js",
      "dev",
      "--port",
      port,
      "--no-hmr",
    ],
    cwd: workDir,
    env: {
      CI: "1",
      NO_COLOR: "1",
      NODE_ENV: "development",
      LOG_FORMAT: "text",
      VERYFRONT_NO_UPDATE_CHECK: "1",
      VF_DISABLE_LRU_INTERVAL: "1",
      SSR_TRANSFORM_PER_PROJECT_LIMIT: "0",
      REVALIDATION_PER_PROJECT_LIMIT: "0",
      ANTHROPIC_API_KEY: "npm-smoke-key",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/api/npm-black-hole`,
      VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS: "true",
    },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    detached: true,
  }).spawn();

  const chunks: string[] = [];
  let exited = false;
  const status = child.status.then((result) => {
    exited = true;
    return result;
  });
  return {
    child,
    exited: () => exited,
    status,
    log: () => chunks.join(""),
    pumps: [
      pumpStream(child.stdout, chunks),
      pumpStream(child.stderr, chunks),
    ],
  };
}

function killDevServer(server: DevServer, signal: Deno.Signal): void {
  try {
    Deno.kill(-server.child.pid, signal);
  } catch {
    try {
      server.child.kill(signal);
    } catch {
      // The server may already have exited.
    }
  }
}

async function stopDevServer(server: DevServer | undefined): Promise<void> {
  if (!server) return;
  killDevServer(server, "SIGTERM");
  for (let attempt = 0; attempt < 50 && !server.exited(); attempt++) {
    await delay(100);
  }
  if (!server.exited()) killDevServer(server, "SIGKILL");
  await server.status.catch(() => {});
  await Promise.all(server.pumps);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: URL | string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<{ status: number; body: string; headers: Headers }> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return {
    status: response.status,
    body: await response.text(),
    headers: response.headers,
  };
}

async function checkStarterDevServer(
  server: DevServer,
  devUrl: string,
): Promise<{ csrfToken: string }> {
  console.log(
    "== 8. published ai-agent starter: page and API route render over HTTP",
  );

  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exited()) break;
    if (server.log().includes("Ready in")) {
      ready = true;
      break;
    }
    await delay(250);
  }
  if (!ready) {
    fail(
      "packed ai-agent starter dev server did not become ready",
      server.log(),
    );
  }

  let page: { status: number; body: string; headers: Headers };
  try {
    page = await fetchWithTimeout(devUrl, 30_000, {
      headers: { accept: "text/html" },
    });
  } catch (error) {
    fail(
      `packed ai-agent starter did not return HTTP 200 (${
        error instanceof Error ? error.message : String(error)
      })`,
      server.log(),
    );
  }
  if (page.status !== 200) {
    fail(
      `packed ai-agent starter did not return HTTP 200 (last status: ${page.status})`,
      server.log(),
    );
  }
  if (!/<title[^>]*>Assistant<\/title>/.test(page.body)) {
    fail(
      `packed ai-agent starter response did not contain its title\n${
        page.body.slice(0, 2_000)
      }`,
    );
  }

  let api: { status: number; body: string };
  try {
    api = await fetchWithTimeout(`${devUrl}api/npm-smoke`, 30_000);
  } catch (error) {
    fail(
      `packed npm API route did not return HTTP 200 (${
        error instanceof Error ? error.message : String(error)
      })`,
      server.log(),
    );
  }
  if (api.status !== 200) {
    fail(
      `packed npm API route did not return HTTP 200 (last status: ${api.status})`,
      server.log(),
    );
  }
  if (api.body !== '{"ok":true}') {
    fail(
      `packed npm API route returned an unexpected body: ${api.body}`,
      server.log(),
    );
  }

  if (
    /Could not resolve relative import|Cached module has missing dependency|Critical page module failed to load|Failed to preload TSX layout|Cannot find module.*_dnt/
      .test(server.log())
  ) {
    fail(
      "packed ai-agent starter logged an SSR module-resolution failure",
      server.log(),
    );
  }

  // `createWorkflowHandler` is mounted at a project API path, so the
  // project's `security.csrf` gate covers it in local development exactly as
  // it does after deploy. The framework's own workflow React hooks satisfy
  // that gate by echoing the issued cookie back in the header, and this
  // smoke has to do the same.
  let csrfToken = "";
  for (const cookie of page.headers.getSetCookie()) {
    const match = /^__Host-vf_csrf=([^;]*)/.exec(cookie);
    if (match) {
      csrfToken = match[1];
      break;
    }
  }
  if (!csrfToken) {
    fail(
      "packed ai-agent starter served no __Host-vf_csrf cookie on its HTML document",
      server.log(),
    );
  }
  return { csrfToken };
}

async function checkWorkflowTimeout(
  server: DevServer,
  devUrl: string,
  csrfToken: string,
): Promise<void> {
  console.log("== 9. packed workflow: provider hang reaches a durable timeout");
  const mutationHeaders = {
    "content-type": "application/json",
    cookie: `__Host-vf_csrf=${csrfToken}`,
    "x-csrf-token": csrfToken,
  };

  try {
    const startResponse = await fetchWithTimeout(
      new URL("api/workflows/timeout-smoke/start", devUrl),
      30_000,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({ input: { message: "hello" } }),
      },
    );
    const started = JSON.parse(startResponse.body) as { runId?: unknown };
    if (
      startResponse.status < 200 || startResponse.status >= 300 ||
      typeof started.runId !== "string" || started.runId.length === 0
    ) {
      throw new Error(
        `Workflow start failed (${startResponse.status}): ${startResponse.body}`,
      );
    }

    const detailUrl = new URL(`api/workflows/runs/${started.runId}`, devUrl);
    const pollingDeadline = Date.now() + 10_000;
    let runDetail:
      | {
        nodeStates?: Record<string, { status?: string; error?: unknown }>;
      }
      | undefined;
    while (Date.now() < pollingDeadline) {
      try {
        const response = await fetchWithTimeout(detailUrl, 5_000);
        if (response.status >= 200 && response.status < 300) {
          runDetail = JSON.parse(response.body);
          if (
            runDetail?.nodeStates?.["call-provider"]?.status === "failed"
          ) break;
        }
      } catch {
        // Poll again until the deadline.
      }
      await delay(250);
    }

    const node = runDetail?.nodeStates?.["call-provider"];
    if (node?.status !== "failed") {
      throw new Error(
        `Workflow did not reach terminal failure: ${JSON.stringify(runDetail)}`,
      );
    }
    if (
      typeof node.error !== "string" ||
      !node.error.includes("timed out after 2000ms")
    ) {
      throw new Error(
        `Workflow reported the wrong failure: ${JSON.stringify(node)}`,
      );
    }

    const health = await fetchWithTimeout(`${devUrl}api/npm-smoke`, 5_000);
    if (health.status < 200 || health.status >= 300) {
      throw new Error(`Server unhealthy after timeout: HTTP ${health.status}`);
    }
  } catch (error) {
    fail(
      `packed workflow timeout journey failed\n${
        error instanceof Error ? error.message : String(error)
      }`,
      server.log(),
    );
  }

  if (!server.log().includes("NPM_SMOKE_BLACK_HOLE_RECEIVED")) {
    fail(
      "packed workflow timed out before reaching the provider transport",
      server.log(),
    );
  }
}

async function runSmoke(workDir: string): Promise<void> {
  let devServer: DevServer | undefined;
  const shutdown = async () => {
    await stopDevServer(devServer);
    devServer = undefined;
  };
  const signalHandlers = new Map<Deno.Signal, () => void>();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const handler = () => {
      shutdown()
        .then(() => Deno.remove(workDir, { recursive: true }))
        .catch(() => {})
        .finally(() => Deno.exit(1));
    };
    signalHandlers.set(signal, handler);
    Deno.addSignalListener(signal, handler);
  }

  try {
    const plan = await prepareArtifacts(workDir);
    if (plan.registryMode) smokeFailureStatus = 21;

    await runChecked("npm init", "npm", ["init", "-y"], {
      cwd: workDir,
      timeoutMs: 60_000,
    });
    await runChecked("npm pkg", "npm", ["pkg", "set", "type=module"], {
      cwd: workDir,
      timeoutMs: 60_000,
    });
    await npmInstall(workDir, plan, plan.rootInstallSpecs);

    await checkRootInstall(workDir);
    await checkOptionalPeer(workDir);
    await checkMissingExtension(workDir);
    await checkAuthExtensionLoads(workDir, plan);
    await checkBrokenTransitiveDependency(workDir);
    await checkScaffoldExport(workDir);
    await checkNodeTypeScriptConfig(workDir);

    await writeStarterFixtures(workDir);
    const devPort = Deno.env.get("VF_NPM_SSR_SMOKE_PORT") || "43119";
    const devUrl = `http://127.0.0.1:${devPort}/`;
    devServer = startDevServer(workDir, devPort);
    const { csrfToken } = await checkStarterDevServer(devServer, devUrl);
    await checkWorkflowTimeout(devServer, devUrl, csrfToken);

    await shutdown();
    console.log("npm install smoke: all checks passed");
  } finally {
    for (const [signal, handler] of signalHandlers) {
      Deno.removeSignalListener(signal, handler);
    }
    await shutdown();
  }
}

async function main(): Promise<void> {
  const workDir = await Deno.makeTempDir({ prefix: "veryfront-npm-smoke-" });
  let exitCode = 0;
  try {
    await runSmoke(workDir);
  } catch (error) {
    if (error instanceof SmokeFailure) {
      if (error.devLog) {
        console.error(sanitizeDiagnostics(error.devLog));
      }
      console.error(`SMOKE FAIL: ${sanitizeDiagnostics(error.message)}`);
      exitCode = error.exitCode;
    } else {
      console.error(
        `SMOKE FAIL: ${
          sanitizeDiagnostics(
            error instanceof Error ? error.message : String(error),
          )
        }`,
      );
      exitCode = smokeFailureStatus;
    }
  } finally {
    // Exit only after cleanup: Deno.exit inside the catch would skip this
    // block and leave the temporary project behind on assertion failure.
    await Deno.remove(workDir, { recursive: true }).catch(() => {});
  }
  if (exitCode !== 0) Deno.exit(exitCode);
}

if (import.meta.main) {
  await main();
}
