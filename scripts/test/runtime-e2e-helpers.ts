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

export async function packNpmPackage(
  rootDir: string,
  workDir: string,
): Promise<string> {
  const packDir = `${workDir}/packed`;
  await Deno.mkdir(packDir, { recursive: true });
  const result = await runChecked("npm", [
    "pack",
    "--pack-destination",
    packDir,
  ], {
    cwd: `${rootDir}/npm`,
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

async function updateVeryfrontDependency(
  projectDir: string,
  tarballPath: string,
): Promise<void> {
  const packagePath = `${projectDir}/package.json`;
  const pkg = JSON.parse(await Deno.readTextFile(packagePath));
  pkg.dependencies ??= {};
  pkg.dependencies.veryfront = `file:${tarballPath}`;
  await Deno.writeTextFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function usePackedVeryfrontDenoTasks(
  projectDir: string,
  tarballPath: string,
): Promise<void> {
  const packagePath = `${projectDir}/package.json`;
  const pkg = JSON.parse(await Deno.readTextFile(packagePath));
  delete pkg.dependencies?.veryfront;
  await Deno.writeTextFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

  const packedCliDir = `${projectDir}/.veryfront-packed-cli`;
  await Deno.mkdir(packedCliDir, { recursive: true });
  await runChecked("tar", ["-xzf", tarballPath, "-C", packedCliDir], {
    timeoutMs: 30_000,
  });
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

async function collectStream(
  stream: ReadableStream<Uint8Array> | null,
  output: string[],
): Promise<void> {
  if (!stream) return;

  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      output.push(decoder.decode(value));
    }
  } finally {
    reader.releaseLock();
  }
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

export function startDevServer(
  projectDir: string,
  runtime: RuntimeName,
  port: number,
): {
  child: Deno.ChildProcess;
  status: Promise<Deno.CommandStatus>;
  stdout: string[];
  stderr: string[];
} {
  const { command, args } = getDevServerCommand(runtime, port);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const child = new Deno.Command(command, {
    args,
    cwd: projectDir,
    env: {
      LOG_FORMAT: "text",
      NODE_ENV: "development",
      REVALIDATION_PER_PROJECT_LIMIT: "0",
      SSR_TRANSFORM_PER_PROJECT_LIMIT: "0",
      VF_DISABLE_LRU_INTERVAL: "1",
    },
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  void collectStream(child.stdout, stdout);
  void collectStream(child.stderr, stderr);

  return { child, status: child.status, stdout, stderr };
}

export async function stopDevServer(server: {
  child: Deno.ChildProcess;
  status: Promise<Deno.CommandStatus>;
}): Promise<void> {
  try {
    server.child.kill("SIGTERM");
  } catch {
    return;
  }

  const exited = await Promise.race([
    server.status.then(() => true).catch(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);

  if (!exited) {
    try {
      server.child.kill("SIGKILL");
    } catch {
      // The process may have exited between the timeout and SIGKILL.
    }
    await server.status.catch(() => {});
  }
}

export async function scaffoldProject(
  rootDir: string,
  workDir: string,
  tarballPath: string,
  template: string,
  runtime: RuntimeName,
): Promise<string> {
  const caseDir = `${workDir}/${runtime}-${template}`;
  const projectName = `vf-${runtime}-${template}`;
  await Deno.mkdir(caseDir, { recursive: true });
  await runChecked("npm", [
    "exec",
    "--yes",
    "--package",
    tarballPath,
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
    await usePackedVeryfrontDenoTasks(projectDir, tarballPath);
  } else {
    await updateVeryfrontDependency(projectDir, tarballPath);
  }

  if (rootDir.length === 0) {
    throw new Error("Root directory could not be resolved");
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
