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
  /** Tarballs for every co-published `@veryfront/*` package, in pack order. */
  readonly extensions: readonly string[];
  /** Repository root, for packing template-owned extensions on demand. */
  readonly rootDir: string;
  /** Directory holding the packed tarballs. */
  readonly packDir: string;
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
async function listCoPublishedExtensionDirs(
  rootDir: string,
): Promise<string[]> {
  const manifest = JSON.parse(
    await Deno.readTextFile(`${rootDir}/npm/package.json`),
  ) as { version?: string; dependencies?: Record<string, string> };
  const version = manifest.version;
  if (typeof version !== "string") {
    throw new Error("built npm package.json has no version");
  }
  return Object.entries(manifest.dependencies ?? {})
    .filter(([name, range]) =>
      name.startsWith("@veryfront/") && range === version
    )
    .map(([name]) =>
      `${rootDir}/npm/extensions/${name.slice("@veryfront/".length)}`
    )
    .sort();
}

export async function packNpmPackage(
  rootDir: string,
  workDir: string,
): Promise<PackedWorkspace> {
  const packDir = `${workDir}/packed`;
  await Deno.mkdir(packDir, { recursive: true });
  const root = await packOne(`${rootDir}/npm`, packDir);
  const extensions: string[] = [];
  for (const dir of await listCoPublishedExtensionDirs(rootDir)) {
    extensions.push(await packOne(dir, packDir));
  }
  return { root, extensions, rootDir, packDir };
}

/** Package name a packed tarball installs as, read from its own manifest. */
async function readPackedName(tarballPath: string): Promise<string> {
  const result = await runChecked("tar", [
    "-xzOf",
    tarballPath,
    "package/package.json",
  ], {
    timeoutMs: 30_000,
  });
  const name = JSON.parse(result.stdout).name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`packed tarball has no name: ${tarballPath}`);
  }
  return name;
}

/**
 * Point a manifest's co-published `@veryfront/*` pins at local tarballs.
 *
 * Only rewrites pins the manifest already declares, so it cannot widen what an
 * install pulls in. Used for the extracted CLI package, whose own manifest
 * carries the exact-version pins that a release-cut branch cannot resolve.
 */
async function redirectCoPublishedPins(
  packageDir: string,
  extensionTarballs: readonly string[],
): Promise<void> {
  if (extensionTarballs.length === 0) return;
  const packagePath = `${packageDir}/package.json`;
  const pkg = JSON.parse(await Deno.readTextFile(packagePath));
  const dependencies = pkg.dependencies as
    | Record<string, string>
    | undefined;
  if (!dependencies) return;

  for (const tarball of extensionTarballs) {
    const name = await readPackedName(tarball);
    if (name in dependencies) dependencies[name] = `file:${tarball}`;
  }
  await Deno.writeTextFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

/**
 * Pack and localise `@veryfront/*` pins a scaffolded template declares itself.
 *
 * Templates add first-party extensions the root does not depend on -- `minimal`
 * ships an .mdx route and installs `@veryfront/ext-content-mdx`, `docs-agent`
 * installs `@veryfront/ext-document-kreuzberg`. Those pins carry the build's own
 * version, so on a release-cut branch they resolve from the registry and fail
 * with ETARGET exactly like the root's.
 *
 * Driven by what the generated manifest actually declares, so only the selected
 * template's extensions are packed. Anything already packed as a root
 * co-publication is reused rather than packed twice.
 */
async function localiseTemplateExtensions(
  projectDir: string,
  packed: PackedWorkspace,
): Promise<void> {
  const packagePath = `${projectDir}/package.json`;
  const pkg = JSON.parse(await Deno.readTextFile(packagePath));
  const dependencies = pkg.dependencies as Record<string, string> | undefined;
  if (!dependencies) return;

  const built = JSON.parse(
    await Deno.readTextFile(`${packed.rootDir}/npm/package.json`),
  ) as { version?: string };
  const version = built.version;
  if (typeof version !== "string") return;
  const localRanges = new Set([version, `^${version}`, `~${version}`]);

  const alreadyPacked = new Set<string>();
  for (const tarball of packed.extensions) {
    alreadyPacked.add(await readPackedName(tarball));
  }

  let changed = false;
  for (const [name, range] of Object.entries(dependencies)) {
    if (!name.startsWith("@veryfront/")) continue;
    if (alreadyPacked.has(name)) continue;
    if (!localRanges.has(range)) continue;

    const dir = `${packed.rootDir}/npm/extensions/${
      name.slice("@veryfront/".length)
    }`;
    dependencies[name] = `file:${await packOne(dir, packed.packDir)}`;
    changed = true;
  }
  if (changed) {
    await Deno.writeTextFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

async function updateVeryfrontDependency(
  projectDir: string,
  packed: PackedWorkspace,
): Promise<void> {
  const packagePath = `${projectDir}/package.json`;
  const pkg = JSON.parse(await Deno.readTextFile(packagePath));
  pkg.dependencies ??= {};
  pkg.dependencies.veryfront = `file:${packed.root}`;
  // The root pins these to its own version. Naming them here keeps the install
  // entirely local; without them the pins go to the registry.
  for (const tarball of packed.extensions) {
    pkg.dependencies[await readPackedName(tarball)] = `file:${tarball}`;
  }
  await Deno.writeTextFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function usePackedVeryfrontDenoTasks(
  projectDir: string,
  packed: PackedWorkspace,
): Promise<void> {
  const packagePath = `${projectDir}/package.json`;
  const pkg = JSON.parse(await Deno.readTextFile(packagePath));
  delete pkg.dependencies?.veryfront;
  await Deno.writeTextFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

  const packedCliDir = `${projectDir}/.veryfront-packed-cli`;
  await Deno.mkdir(packedCliDir, { recursive: true });
  await runChecked("tar", ["-xzf", packed.root, "-C", packedCliDir], {
    timeoutMs: 30_000,
  });
  // The extracted manifest still pins the co-published extensions to its own
  // unpublished version, so `deno install` below would resolve them from the
  // registry and fail with ETARGET even though the sibling tarballs are already
  // on disk. The npm path avoids this by naming them in the fixture manifest;
  // the Deno path installs from the extracted package, so redirect them there.
  await redirectCoPublishedPins(`${packedCliDir}/package`, packed.extensions);
  await runChecked("deno", ["install"], {
    cwd: `${packedCliDir}/package`,
    timeoutMs: 180_000,
  });

  const cliPath = JSON.stringify(`${packedCliDir}/package/esm/cli/main.js`);
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
    ...[packed.root, ...packed.extensions].flatMap((
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
  // Before the runtime-specific wiring: both paths install from this manifest,
  // and a template's own extension pins are unresolvable on a release cut.
  await localiseTemplateExtensions(projectDir, packed);
  if (runtime === "deno") {
    await usePackedVeryfrontDenoTasks(projectDir, packed);
  } else {
    await updateVeryfrontDependency(projectDir, packed);
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
