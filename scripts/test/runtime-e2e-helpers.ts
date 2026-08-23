import {
  type CommandResult as ManagedCommandResult,
  runCommand as runManagedCommand,
} from "../../src/platform/compat/process/command.ts";

export type RuntimeName = "node" | "bun" | "deno";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

const decoder = new TextDecoder();

export function parseCommaSeparatedFlag(
  args: string[],
  names: string[],
): string[] | null {
  for (const name of names) {
    const prefix = `--${name}=`;
    const inline = args.find((arg) => arg.startsWith(prefix));
    if (inline) {
      return inline.slice(prefix.length).split(",").map((value) => value.trim())
        .filter(Boolean);
    }

    const index = args.indexOf(`--${name}`);
    if (index >= 0) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`--${name} requires a comma-separated value`);
      }
      return value.split(",").map((entry) => entry.trim()).filter(Boolean);
    }
  }

  return null;
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<CommandResult> {
  const controller = new AbortController();
  const timeout = options.timeoutMs === undefined
    ? undefined
    : setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const output = await new Deno.Command(command, {
      args,
      cwd: options.cwd,
      env: options.env,
      signal: controller.signal,
      stdout: "piped",
      stderr: "piped",
    }).output();

    return {
      code: output.code,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `${command} ${args.join(" ")} timed out after ${options.timeoutMs}ms`,
      );
    }
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function runChecked(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<CommandResult> {
  const result = await runCommand(command, args, options);
  if (result.code !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed with exit code ${result.code}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ].filter(Boolean).join("\n"),
    );
  }
  return result;
}

export async function ensureCommand(
  command: string,
  args: string[] = ["--version"],
): Promise<void> {
  await runChecked(command, args, { timeoutMs: 30_000 });
}

export async function inspectModuleExports(
  moduleUrl: URL,
  label: string,
  timeoutMs = 7_500,
): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let result: Deno.CommandOutput;

  try {
    result = await new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        `--config=${new URL("../test.deno.json", import.meta.url).pathname}`,
        "--no-check",
        `const mod = await import(${JSON.stringify(moduleUrl.href)});\n` +
        "console.log(JSON.stringify(Object.keys(mod).sort()));",
      ],
      signal: controller.signal,
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `${label} import subprocess timed out after ${timeoutMs}ms`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const stderr = decoder.decode(result.stderr);
  if (stderr.length > 0) {
    throw new Error(`${label} import subprocess wrote to stderr:\n${stderr}`);
  }
  if (result.code !== 0) {
    throw new Error(
      `${label} import subprocess exited with code ${result.code}`,
    );
  }

  return JSON.parse(decoder.decode(result.stdout)) as string[];
}

/**
 * The locally built packages a scaffolded fixture installs.
 *
 * `veryfront` pins its co-published extensions to its own exact version, so a
 * fixture given only the root tarball resolves those pins from the npm
 * registry. On a release-cut branch that version is not published yet — it is
 * what the release job publishes — and the install fails with ETARGET. Packing
 * the extensions alongside the root keeps the whole matched set local, which is
 * also the set a user receives.
 */
export interface PackedWorkspace {
  /** Tarball for the root `veryfront` package. */
  readonly root: string;
  /** Names of the extensions pinned by the root package itself. */
  readonly rootExtensionNames: readonly string[];
  /** Named tarballs for root and selected-template extensions, in pack order. */
  readonly extensions: readonly PackedExtension[];
}

export interface PackedExtension {
  readonly name: string;
  readonly tarball: string;
}

const VERYFRONT_EXTENSION_PREFIX = "@veryfront/ext-";
const VERYFRONT_SCOPE_PREFIX = "@veryfront/";

function extensionDirectoryName(name: string): string {
  if (
    !name.startsWith(VERYFRONT_EXTENSION_PREFIX) ||
    name.length === VERYFRONT_EXTENSION_PREFIX.length ||
    name.slice(VERYFRONT_SCOPE_PREFIX.length).includes("/")
  ) {
    throw new Error(`Unsupported first-party extension package: ${name}`);
  }
  return name.slice(VERYFRONT_SCOPE_PREFIX.length);
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function packOne(packageDir: string, packDir: string): Promise<string> {
  const result = await runChecked("npm", [
    "pack",
    "--pack-destination",
    packDir,
  ], {
    cwd: packageDir,
    timeoutMs: 120_000,
  });
  const tarball = result.stdout.split(/\r?\n/)
    .map((line) => line.trim())
    .findLast((line) => line.endsWith(".tgz"));

  if (!tarball) {
    throw new Error(`npm pack did not report a tarball:\n${result.stdout}`);
  }

  return `${packDir}/${tarball}`;
}

/**
 * The extensions the root pins to its own exact version — the only ones whose
 * pin cannot be satisfied from the registry on a release-cut branch.
 *
 * Derived from the built root manifest rather than a directory listing: the
 * build emits 29 extension packages but the root co-publishes 6, and installing
 * the other 23 would change what the fixture exercises.
 */
async function listCoPublishedExtensions(
  rootDir: string,
): Promise<Array<{ name: string; directory: string }>> {
  const manifest = JSON.parse(
    await Deno.readTextFile(`${rootDir}/npm/package.json`),
  ) as { version?: string; dependencies?: Record<string, string> };
  const version = manifest.version;
  if (typeof version !== "string") {
    throw new Error("built npm package.json has no version");
  }
  return Object.entries(manifest.dependencies ?? {})
    .filter(([name, range]) =>
      name.startsWith(VERYFRONT_EXTENSION_PREFIX) && range === version
    )
    .map(([name]) => ({
      name,
      directory: `${rootDir}/npm/extensions/${extensionDirectoryName(name)}`,
    }))
    .sort((left, right) => compareNames(left.name, right.name));
}

export async function packNpmPackage(
  rootDir: string,
  workDir: string,
  additionalExtensionNames: readonly string[] = [],
): Promise<PackedWorkspace> {
  const packDir = `${workDir}/packed`;
  await Deno.mkdir(packDir, { recursive: true });
  const root = await packOne(`${rootDir}/npm`, packDir);
  const coPublished = await listCoPublishedExtensions(rootDir);
  const directories = new Map(
    coPublished.map(({ name, directory }) => [name, directory]),
  );
  for (const name of additionalExtensionNames) {
    directories.set(
      name,
      `${rootDir}/npm/extensions/${extensionDirectoryName(name)}`,
    );
  }
  const extensions: PackedExtension[] = [];
  for (
    const [name, directory] of [...directories].sort(([left], [right]) =>
      compareNames(left, right)
    )
  ) {
    extensions.push({ name, tarball: await packOne(directory, packDir) });
  }
  return {
    root,
    rootExtensionNames: coPublished.map(({ name }) => name),
    extensions,
  };
}

/** Resolve selected named packages to local file dependencies. */
export function packedFileDependencies(
  packed: PackedWorkspace,
  names: readonly string[],
): Record<string, string> {
  const dependencies: Record<string, string> = {};
  for (const { name, tarball } of selectPackedExtensions(packed, names)) {
    dependencies[name] = `file:${tarball}`;
  }
  return dependencies;
}

function selectPackedExtensions(
  packed: PackedWorkspace,
  names: readonly string[],
): PackedExtension[] {
  const extensions = new Map(
    packed.extensions.map((extension) => [extension.name, extension]),
  );
  return [...new Set(names)].sort().map((name) => {
    const extension = extensions.get(name);
    if (!extension) {
      throw new Error(`Packed extension is unavailable: ${name}`);
    }
    return extension;
  });
}

async function extractPackedDenoDependencies(
  packed: PackedWorkspace,
  names: readonly string[],
  destinationRoot: string,
  dependencyPrefix: string,
): Promise<Record<string, string>> {
  const dependencies: Record<string, string> = {};
  for (const { name, tarball } of selectPackedExtensions(packed, names)) {
    const directoryName = extensionDirectoryName(name);
    const destination = `${destinationRoot}/${directoryName}`;
    await Deno.mkdir(destination, { recursive: true });
    await runChecked("tar", ["-xzf", tarball, "-C", destination], {
      timeoutMs: 30_000,
    });
    dependencies[name] = `file:${dependencyPrefix}/${directoryName}/package`;
  }
  return dependencies;
}

async function replaceDirectorySymlink(
  path: string,
  target: string,
): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.symlink(target, path, { type: "dir" });
}

async function preparePackedDenoDependencies(
  packed: PackedWorkspace,
  names: readonly string[],
  destinationRoot: string,
  dependencyPrefix: string,
  veryfrontPackageDir: string,
): Promise<Record<string, string>> {
  // Deno resolves a file dependency from its extracted real path instead of
  // hoisting its dependencies and Veryfront peer into the caller's tree.
  // Install each trusted packed extension in place, then link its Veryfront
  // peer to the matching extracted root package.
  const dependencies = await extractPackedDenoDependencies(
    packed,
    names,
    destinationRoot,
    dependencyPrefix,
  );
  for (const { name } of selectPackedExtensions(packed, names)) {
    const extensionPackageDir = `${destinationRoot}/${
      extensionDirectoryName(name)
    }/package`;
    const manifestPath = `${extensionPackageDir}/package.json`;
    const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
    if (manifest.peerDependencies?.veryfront !== undefined) {
      delete manifest.peerDependencies.veryfront;
      if (Object.keys(manifest.peerDependencies).length === 0) {
        delete manifest.peerDependencies;
      }
      await Deno.writeTextFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    }
    await runChecked("deno", ["install"], {
      cwd: extensionPackageDir,
      timeoutMs: 180_000,
    });
    await replaceDirectorySymlink(
      `${extensionPackageDir}/node_modules/veryfront`,
      veryfrontPackageDir,
    );
  }
  return dependencies;
}

async function updateVeryfrontDependency(
  projectDir: string,
  packed: PackedWorkspace,
  extensionNames: readonly string[],
  runtime: "node" | "bun",
): Promise<void> {
  const packagePath = `${projectDir}/package.json`;
  const pkg = JSON.parse(await Deno.readTextFile(packagePath));
  pkg.dependencies ??= {};
  pkg.dependencies.veryfront = `file:${packed.root}`;
  const localExtensions = packedFileDependencies(packed, extensionNames);
  Object.assign(pkg.dependencies, localExtensions);
  if (runtime === "bun") {
    pkg.overrides ??= {};
    Object.assign(pkg.overrides, localExtensions);
  }
  await Deno.writeTextFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function usePackedVeryfrontDenoTasks(
  projectDir: string,
  packed: PackedWorkspace,
  projectExtensionNames: readonly string[],
): Promise<void> {
  const packagePath = `${projectDir}/package.json`;
  const pkg = JSON.parse(await Deno.readTextFile(packagePath));
  delete pkg.dependencies?.veryfront;
  pkg.dependencies ??= {};

  const packedCliDir = `${projectDir}/.veryfront-packed-cli`;
  await Deno.mkdir(packedCliDir, { recursive: true });
  await runChecked("tar", ["-xzf", packed.root, "-C", packedCliDir], {
    timeoutMs: 30_000,
  });
  const packedCliPackageDir = `${packedCliDir}/package`;
  const packedCliPackagePath = `${packedCliPackageDir}/package.json`;
  const packedCliPackage = JSON.parse(
    await Deno.readTextFile(packedCliPackagePath),
  );
  packedCliPackage.dependencies ??= {};
  Object.assign(
    packedCliPackage.dependencies,
    await preparePackedDenoDependencies(
      packed,
      packed.rootExtensionNames,
      `${packedCliPackageDir}/.veryfront-local-extensions`,
      "./.veryfront-local-extensions",
      packedCliPackageDir,
    ),
  );
  await Deno.writeTextFile(
    packedCliPackagePath,
    `${JSON.stringify(packedCliPackage, null, 2)}\n`,
  );
  await runChecked("deno", ["install"], {
    cwd: packedCliPackageDir,
    timeoutMs: 180_000,
  });
  await replaceDirectorySymlink(
    `${packedCliPackageDir}/node_modules/veryfront`,
    packedCliPackageDir,
  );

  Object.assign(
    pkg.dependencies,
    await preparePackedDenoDependencies(
      packed,
      projectExtensionNames,
      `${projectDir}/.veryfront-packed-extensions`,
      "./.veryfront-packed-extensions",
      packedCliPackageDir,
    ),
  );
  await Deno.writeTextFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

  const cliPath = JSON.stringify(
    `${packedCliPackageDir}/esm/cli/main.js`,
  );
  const denoConfigPath = `${projectDir}/deno.json`;
  const config = JSON.parse(await Deno.readTextFile(denoConfigPath));
  config.tasks ??= {};
  config.tasks.dev = `deno run -A ${cliPath} dev`;
  config.tasks.build = `deno run -A ${cliPath} build`;
  config.tasks.preview = `deno run -A ${cliPath} preview`;
  await Deno.writeTextFile(
    denoConfigPath,
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

export function assertCondition(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function allocatePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

export async function waitForRoute(
  url: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1_000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (response.ok) {
          await response.body?.cancel();
          return;
        }
        lastError = `HTTP ${response.status}`;
        await response.body?.cancel();
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `${url} did not become ready within ${timeoutMs}ms: ${lastError}`,
  );
}

export function getDevServerCommand(
  runtime: RuntimeName,
  port: number,
): { command: string; args: string[] } {
  return {
    command: runtime === "node" ? "npm" : runtime,
    args: runtime === "deno"
      ? ["task", "dev", "--port", String(port)]
      : ["run", "dev", "--", "--port", String(port)],
  };
}

export function getDevServerEnvironment(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    ANTHROPIC_API_KEY: "",
    GOOGLE_API_KEY: "",
    GOOGLE_GENERATIVE_AI_API_KEY: "",
    LOG_FORMAT: "text",
    MISTRAL_API_KEY: "",
    NODE_ENV: "development",
    OPENAI_API_KEY: "",
    REVALIDATION_PER_PROJECT_LIMIT: "0",
    SSR_TRANSFORM_PER_PROJECT_LIMIT: "0",
    VERYFRONT_API_TOKEN: "",
    VF_DISABLE_LRU_INTERVAL: "1",
    ...overrides,
  };
}

export function startDevServer(
  projectDir: string,
  runtime: RuntimeName,
  port: number,
  env: Record<string, string> = {},
): {
  abortController: AbortController;
  result: Promise<ManagedCommandResult>;
  stdout: string[];
  stderr: string[];
} {
  const { command, args } = getDevServerCommand(runtime, port);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const abortController = new AbortController();
  const result = runManagedCommand(command, {
    args,
    cwd: projectDir,
    env: getDevServerEnvironment(env),
    capture: true,
    signal: abortController.signal,
    terminateProcessTreeOnExit: true,
  }).then((commandResult) => {
    if (commandResult.stdout) stdout.push(commandResult.stdout);
    if (commandResult.stderr) stderr.push(commandResult.stderr);
    return commandResult;
  });

  return { abortController, result, stdout, stderr };
}

export async function stopDevServer(server: {
  abortController: AbortController;
  result: Promise<ManagedCommandResult>;
}): Promise<void> {
  server.abortController.abort();
  await server.result;
}

export async function scaffoldProject(
  workDir: string,
  packed: PackedWorkspace,
  template: string,
  runtime: RuntimeName,
  templateExtensionNames: readonly string[] = [],
): Promise<string> {
  const caseDir = `${workDir}/${runtime}-${template}`;
  const projectName = `vf-${runtime}-${template}`;
  await Deno.mkdir(caseDir, { recursive: true });
  await runChecked("npm", [
    "exec",
    "--yes",
    // `npm exec` resolves the CLI package's dependencies into its own prefix,
    // so the co-published extensions have to be named here too. Otherwise this
    // reaches the registry for a version that is not published yet.
    ...[
      packed.root,
      ...packed.extensions
        .filter(({ name }) => packed.rootExtensionNames.includes(name))
        .map(({ tarball }) => tarball),
    ].flatMap((
      tarball,
    ) => ["--package", tarball]),
    "--",
    "veryfront",
    "init",
    projectName,
    "--template",
    template,
    "--runtime",
    runtime,
    "--skip-install",
    "--skip-env-prompt",
  ], {
    cwd: caseDir,
    env: {
      npm_config_cache: `${workDir}/npm-cache`,
      npm_config_fund: "false",
      npm_config_audit: "false",
    },
    timeoutMs: 120_000,
  });

  const projectDir = `${caseDir}/${projectName}`;
  if (runtime === "deno") {
    await usePackedVeryfrontDenoTasks(
      projectDir,
      packed,
      templateExtensionNames,
    );
  } else {
    await updateVeryfrontDependency(
      projectDir,
      packed,
      [...packed.rootExtensionNames, ...templateExtensionNames],
      runtime,
    );
  }

  return projectDir;
}

export async function installDependencies(
  projectDir: string,
  runtime: RuntimeName,
  workDir: string,
): Promise<void> {
  if (runtime === "node") {
    await runChecked("npm", ["install", "--no-audit", "--fund=false"], {
      cwd: projectDir,
      env: { npm_config_cache: `${workDir}/npm-cache` },
      timeoutMs: 180_000,
    });
    return;
  }

  if (runtime === "deno") {
    await runChecked("deno", ["install"], {
      cwd: projectDir,
      timeoutMs: 180_000,
    });
    return;
  }

  await runChecked("bun", ["install"], {
    cwd: projectDir,
    timeoutMs: 180_000,
  });
}
