import { TEMPLATES } from "../../cli/commands/init/catalog.ts";
import {
  allocatePort,
  assertCondition,
  ensureCommand,
  installDependencies,
  packNpmPackage,
  parseCommaSeparatedFlag,
  runChecked,
  type RuntimeName,
  scaffoldProject,
  startDevServer,
  stopDevServer,
  waitForRoute,
} from "./runtime-e2e-helpers.ts";

export {
  assertCondition,
  ensureCommand,
  getDevServerCommand,
  installDependencies,
  packNpmPackage,
  parseCommaSeparatedFlag,
  runChecked,
  scaffoldProject,
  startDevServer,
  stopDevServer,
  waitForRoute,
} from "./runtime-e2e-helpers.ts";
export type { CommandResult, RuntimeName } from "./runtime-e2e-helpers.ts";

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

type TemplateName = typeof TEMPLATES[number]["id"];

const VALID_RUNTIMES: RuntimeName[] = ["node", "bun", "deno"];
const DEFAULT_RUNTIMES: RuntimeName[] = VALID_RUNTIMES;
const TEMPLATE_ROUTE_EXPECTATIONS: Partial<
  Record<TemplateName, Array<{ route: string; contains?: string[] }>>
> = {
  "agentic-workflow": [
    { route: "/", contains: ["Content Pipeline", "Recent Runs"] },
    { route: "/workflows/test-run" },
  ],
};

function hasFlag(name: string): boolean {
  return Deno.args.includes(`--${name}`);
}

function selectedTemplates(): TemplateName[] {
  const requested = parseCommaSeparatedFlag(Deno.args, ["templates"]);
  const all = TEMPLATES.map((template) => template.id);
  if (!requested) {
    return [...all];
  }

  const invalid = requested.filter((template) =>
    !all.includes(template as TemplateName)
  );
  if (invalid.length > 0) {
    throw new Error(`Unknown templates: ${invalid.join(", ")}`);
  }

  return requested as TemplateName[];
}

function selectedRuntimes(): RuntimeName[] {
  const requested = parseCommaSeparatedFlag(Deno.args, ["runtimes"]);
  if (!requested) {
    return DEFAULT_RUNTIMES;
  }

  const invalid = requested.filter((runtime) =>
    !VALID_RUNTIMES.includes(runtime as RuntimeName)
  );
  if (invalid.length > 0) {
    throw new Error(`Unknown runtimes: ${invalid.join(", ")}`);
  }

  return requested as RuntimeName[];
}

async function verifyHttpRoute(
  url: string,
  expectedText: string[] = [],
): Promise<void> {
  const response = await fetch(url);
  const body = await response.text();

  assertCondition(response.ok, `${url} returned HTTP ${response.status}`);
  assertCondition(
    !body.includes("Module not found"),
    `${url} rendered a module resolution error`,
  );
  assertCondition(
    !body.includes("Internal Server Error"),
    `${url} rendered an internal error`,
  );

  for (const text of expectedText) {
    assertCondition(
      body.includes(text),
      `${url} did not include expected text: ${text}`,
    );
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

  const result = await runChecked("agent-browser", commandArgs, {
    timeoutMs: 45_000,
  });
  return result.stdout;
}

async function verifyBrowserRoute(
  session: string,
  url: string,
): Promise<void> {
  await runAgentBrowser(session, ["errors", "--clear"], { json: true }).catch(
    () => {},
  );
  await runAgentBrowser(session, ["network", "requests", "--clear"], {
    json: true,
  }).catch(
    () => {},
  );
  await runAgentBrowser(session, ["open", url]);
  await runAgentBrowser(session, ["wait", "1000"]);

  const errors = parseBrowserEnvelope<BrowserErrors>(
    await runAgentBrowser(session, ["errors"], { json: true }),
    "agent-browser errors",
  );
  if (errors.errors.length > 0) {
    throw new Error(
      `Browser errors at ${url}: ${JSON.stringify(errors.errors)}`,
    );
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

async function verifyAgenticWorkflowDemo(rootUrl: string): Promise<void> {
  const topic = `Runtime E2E ${crypto.randomUUID().slice(0, 8)}`;
  const startResponse = await fetch(
    new URL("/api/workflows/content-pipeline/start", rootUrl),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { topic } }),
    },
  );
  const started = await startResponse.json() as { runId?: string; id?: string };
  const runId = started.runId ?? started.id;

  assertCondition(
    startResponse.ok,
    `workflow start returned HTTP ${startResponse.status}`,
  );
  assertCondition(
    typeof runId === "string" && runId.length > 0,
    "workflow start omitted run id",
  );

  const listResponse = await fetch(
    new URL("/api/workflows/runs?workflowId=content-pipeline", rootUrl),
  );
  const list = await listResponse.json() as {
    runs?: Array<{ id?: string; input?: { topic?: string } }>;
  };
  const listedRun = list.runs?.find((run) => run.id === runId);
  assertCondition(
    listResponse.ok,
    `workflow list returned HTTP ${listResponse.status}`,
  );
  assertCondition(
    Boolean(listedRun),
    "started workflow run was not returned by the list API",
  );
  assertCondition(
    listedRun?.input?.topic === topic,
    "started workflow run did not preserve the submitted topic in the list API",
  );

  const detailResponse = await fetch(
    new URL(`/api/workflows/runs/${runId}`, rootUrl),
  );
  const detail = await detailResponse.json() as { input?: { topic?: string } };
  assertCondition(
    detailResponse.ok,
    `workflow detail returned HTTP ${detailResponse.status}`,
  );
  assertCondition(
    detail.input?.topic === topic,
    "started workflow run did not preserve the submitted topic in the detail API",
  );
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
  const projectDir = await scaffoldProject(
    rootDir,
    workDir,
    tarballPath,
    template,
    runtime,
  );

  console.log(`test ${label}: install`);
  await installDependencies(projectDir, runtime, workDir);

  const port = allocatePort();
  const server = startDevServer(projectDir, runtime, port);
  const session = `vfte-${runtime[0]}-${template.replaceAll("-", "")}-${
    crypto.randomUUID().slice(0, 8)
  }`;

  try {
    const rootUrl = `http://127.0.0.1:${port}/`;
    console.log(`test ${label}: wait ${rootUrl}`);
    await waitForRoute(rootUrl);

    const routes = TEMPLATE_ROUTE_EXPECTATIONS[template] ?? [{ route: "/" }];
    for (const { route, contains } of routes) {
      const url = new URL(route, rootUrl).toString();
      console.log(`test ${label}: http ${route}`);
      await verifyHttpRoute(url, contains);
      console.log(`test ${label}: browser ${route}`);
      await verifyBrowserRoute(session, url);
    }

    if (template === "agentic-workflow") {
      console.log(`test ${label}: workflow API`);
      await verifyAgenticWorkflowDemo(rootUrl);
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
  const rootDir = new URL("../../", import.meta.url).pathname.replace(
    /\/$/,
    "",
  );
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
    if (runtimes.includes("deno")) {
      await ensureCommand("deno");
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

    console.log(
      `passed ${templates.length * runtimes.length} template runtime e2e cases`,
    );
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
