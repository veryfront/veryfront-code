import { TEMPLATES } from "../../cli/commands/init/catalog.ts";

type RuntimeName = "node" | "bun";
type TemplateName = typeof TEMPLATES[number]["id"];

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface BrowserEnvelope<T> {
  success: boolean;
  data: T;
  error: unknown;
}

interface BrowserErrors {
  errors: unknown[];
}

interface BrowserRequests {
  requests: BrowserRequest[];
}

interface BrowserRequest {
  url?: string;
  status?: number;
  failure?: string | null;
  error?: string | null;
}

const DEFAULT_RUNTIMES: RuntimeName[] = ["node", "bun"];
const TEMPLATE_ROUTES: Partial<Record<TemplateName, string[]>> = {
  "agentic-workflow": ["/workflows/test-run"],
};

const decoder = new TextDecoder();

function parseCsvFlag(name: string): string[] | null {
  const prefix = `--${name}=`;
  const inline = Deno.args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length).split(",").map((value) => value.trim()).filter(Boolean);
  }

  const index = Deno.args.indexOf(`--${name}`);
  if (index >= 0) {
    const value = Deno.args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`--${name} requires a comma-separated value`);
    }
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }

  return null;
}

function hasFlag(name: string): boolean {
  return Deno.args.includes(`--${name}`);
}

function selectedTemplates(): TemplateName[] {
  const requested = parseCsvFlag("templates");
  const all = TEMPLATES.map((template) => template.id);
  if (!requested) {
    return [...all];
  }

  const invalid = requested.filter((template) => !all.includes(template as TemplateName));
  if (invalid.length > 0) {
    throw new Error(`Unknown templates: ${invalid.join(", ")}`);
  }

  return requested as TemplateName[];
}

function selectedRuntimes(): RuntimeName[] {
  const requested = parseCsvFlag("runtimes");
  if (!requested) {
    return DEFAULT_RUNTIMES;
  }

  const invalid = requested.filter((runtime) => runtime !== "node" && runtime !== "bun");
  if (invalid.length > 0) {
    throw new Error(`Unknown runtimes: ${invalid.join(", ")}`);
  }

  return requested as RuntimeName[];
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
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function runChecked(
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

async function ensureCommand(command: string, args: string[] = ["--version"]): Promise<void> {
  await runChecked(command, args, { timeoutMs: 30_000 });
}

async function packNpmPackage(rootDir: string, workDir: string): Promise<string> {
  const packDir = `${workDir}/packed`;
  await Deno.mkdir(packDir, { recursive: true });
  const result = await runChecked("npm", ["pack", "--pack-destination", packDir], {
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

async function updateVeryfrontDependency(projectDir: string, tarballPath: string): Promise<void> {
  const packagePath = `${projectDir}/package.json`;
  const pkg = JSON.parse(await Deno.readTextFile(packagePath));
  pkg.dependencies ??= {};
  pkg.dependencies.veryfront = `file:${tarballPath}`;
  await Deno.writeTextFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function allocatePort(): Promise<number> {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

async function waitForRoute(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1_000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) {
        await response.body?.cancel();
        return;
      }
      lastError = `HTTP ${response.status}`;
      await response.body?.cancel();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`${url} did not become ready within ${timeoutMs}ms: ${lastError}`);
}

async function collectStream(
  stream: ReadableStream<Uint8Array> | null,
  output: string[],
): Promise<void> {
  if (!stream) {
    return;
  }

  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      output.push(decoder.decode(value));
    }
  } finally {
    reader.releaseLock();
  }
}

function startDevServer(
  projectDir: string,
  runtime: RuntimeName,
  port: number,
): {
  child: Deno.ChildProcess;
  status: Promise<Deno.CommandStatus>;
  stdout: string[];
  stderr: string[];
} {
  const command = runtime === "node" ? "npm" : "bun";
  const args = runtime === "node"
    ? ["run", "dev", "--", "--port", String(port)]
    : ["run", "dev", "--", "--port", String(port)];
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

async function stopDevServer(server: {
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

function parseBrowserEnvelope<T>(stdout: string, command: string): T {
  const envelope = JSON.parse(stdout) as BrowserEnvelope<T>;
  if (!envelope.success) {
    throw new Error(`${command} failed: ${JSON.stringify(envelope.error)}`);
  }
  return envelope.data;
}

function isIgnoredNetworkFailure(request: BrowserRequest): boolean {
  if (request.status !== 404 || !request.url) {
    return false;
  }

  try {
    return new URL(request.url).pathname === "/favicon.ico";
  } catch {
    return false;
  }
}

async function runAgentBrowser(
  session: string,
  args: string[],
  options: { json?: boolean } = {},
): Promise<string> {
  const commandArgs = ["--session", session, ...args];
  if (options.json) {
    commandArgs.push("--json");
  }

  const result = await runChecked("agent-browser", commandArgs, { timeoutMs: 45_000 });
  return result.stdout;
}

async function verifyBrowserRoute(
  session: string,
  url: string,
): Promise<void> {
  await runAgentBrowser(session, ["errors", "--clear"], { json: true }).catch(() => {});
  await runAgentBrowser(session, ["network", "requests", "--clear"], { json: true }).catch(
    () => {},
  );
  await runAgentBrowser(session, ["open", url]);
  await runAgentBrowser(session, ["wait", "1000"]);

  const errors = parseBrowserEnvelope<BrowserErrors>(
    await runAgentBrowser(session, ["errors"], { json: true }),
    "agent-browser errors",
  );
  if (errors.errors.length > 0) {
    throw new Error(`Browser errors at ${url}: ${JSON.stringify(errors.errors)}`);
  }

  const network = parseBrowserEnvelope<BrowserRequests>(
    await runAgentBrowser(session, ["network", "requests"], { json: true }),
    "agent-browser network requests",
  );
  const failures = network.requests.filter((request) =>
    !isIgnoredNetworkFailure(request) &&
    ((typeof request.status === "number" && request.status >= 400) ||
      request.failure ||
      request.error)
  );
  if (failures.length > 0) {
    throw new Error(`Network failures at ${url}: ${JSON.stringify(failures)}`);
  }
}

async function scaffoldProject(
  rootDir: string,
  workDir: string,
  tarballPath: string,
  template: TemplateName,
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
  await updateVeryfrontDependency(projectDir, tarballPath);

  if (rootDir.length === 0) {
    throw new Error("Root directory could not be resolved");
  }

  return projectDir;
}

async function installDependencies(
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

  await runChecked("bun", ["install"], {
    cwd: projectDir,
    timeoutMs: 180_000,
  });
}

async function testCase(
  rootDir: string,
  workDir: string,
  tarballPath: string,
  template: TemplateName,
  runtime: RuntimeName,
): Promise<void> {
  const label = `${runtime}/${template}`;
  console.log(`test ${label}: scaffold`);
  const projectDir = await scaffoldProject(rootDir, workDir, tarballPath, template, runtime);

  console.log(`test ${label}: install`);
  await installDependencies(projectDir, runtime, workDir);

  const port = await allocatePort();
  const server = startDevServer(projectDir, runtime, port);
  const session = `vfte-${runtime[0]}-${template.replaceAll("-", "")}-${
    crypto.randomUUID().slice(0, 8)
  }`;

  try {
    const rootUrl = `http://127.0.0.1:${port}/`;
    console.log(`test ${label}: wait ${rootUrl}`);
    await waitForRoute(rootUrl);

    const routes = ["/", ...(TEMPLATE_ROUTES[template] ?? [])];
    for (const route of routes) {
      const url = new URL(route, rootUrl).toString();
      console.log(`test ${label}: browser ${route}`);
      await verifyBrowserRoute(session, url);
    }
  } catch (error) {
    const stdout = server.stdout.join("").trim();
    const stderr = server.stderr.join("").trim();
    throw new Error(
      [
        `${label} failed`,
        error instanceof Error ? error.message : String(error),
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
      ].filter(Boolean).join("\n\n"),
    );
  } finally {
    await runAgentBrowser(session, ["close"]).catch(() => {});
    await stopDevServer(server);
  }
}

async function main(): Promise<void> {
  const rootDir = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
  const templates = selectedTemplates();
  const runtimes = selectedRuntimes();
  const keepWorkDir = hasFlag("keep");
  const skipBuild = hasFlag("skip-build");
  const workDir = await Deno.makeTempDir({ prefix: "veryfront-template-e2e-" });

  console.log(`templates: ${templates.join(", ")}`);
  console.log(`runtimes: ${runtimes.join(", ")}`);

  try {
    await ensureCommand("npm");
    await ensureCommand("node");
    if (runtimes.includes("bun")) {
      await ensureCommand("bun");
    }
    await ensureCommand("agent-browser", ["--version"]);

    if (!skipBuild) {
      console.log("build npm package");
      await runChecked("deno", ["task", "build:npm"], {
        cwd: rootDir,
        timeoutMs: 300_000,
      });
    }

    console.log("pack npm package");
    const tarballPath = await packNpmPackage(rootDir, workDir);

    for (const template of templates) {
      for (const runtime of runtimes) {
        await testCase(rootDir, workDir, tarballPath, template, runtime);
      }
    }

    console.log(`passed ${templates.length * runtimes.length} template runtime e2e cases`);
  } finally {
    if (keepWorkDir) {
      console.log(`kept work dir: ${workDir}`);
    } else {
      await Deno.remove(workDir, { recursive: true }).catch(() => {});
    }
  }
}

if (import.meta.main) {
  await main();
}
