import { Session } from "node:inspector";
import { cpuUsage } from "node:process";
import { startProductionServer } from "#veryfront/server/production-server.ts";
import { ensureDefaultBundlerContracts } from "#veryfront/extensions/bundler/defaults.ts";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";
import { fromFileUrl } from "#veryfront/compat/path/index.ts";
import { type CpuProfile, sanitizeProfile } from "./report.ts";
import { encodeMessage, readMessages } from "./protocol.ts";

if (Deno.args[0] === "--check-only") Deno.exit(0);

const [scenario, durationText, profilePath] = Deno.args;
const root = new URL("../../", import.meta.url);
const fixture = new URL(`.cache/perf/runtime-${Deno.pid}/`, root);
const project = new URL("project/", fixture);
const projectDir = fromFileUrl(project).replace(/\/$/, "");
Deno.env.set("VERYFRONT_CACHE_DIR", fromFileUrl(new URL("cache/", fixture)));
Deno.env.set("VERYFRONT_ENABLE_SERVER_TIMING", "1");
await Deno.mkdir(project, { recursive: true });

async function prepareFixture() {
  for (const path of ["app/api/items", "app/catalog", "public"]) {
    await Deno.mkdir(new URL(path, project), { recursive: true });
  }
  const files = {
    "veryfront.config.js": "export default { security: { csrf: false } };",
    "app/api/items/route.ts":
      "export function GET() { return Response.json({ items: Array.from({ length: 100 }, (_, i) => ({ id: i, title: 'Item ' + i })) }); }",
    "app/layout.tsx":
      "export default function Layout({ children }) { return <html><head/><body><nav>Performance fixture</nav>{children}</body></html>; }",
    "app/catalog/page.tsx":
      "export default function Page() { return <main><h1>Catalog fixture</h1>{Array.from({ length: 100 }, (_, i) => <article key={i}><h2>Item {i}</h2><p>Synthetic catalog content</p></article>)}</main>; }",
  };
  for (const [path, code] of Object.entries(files)) {
    await Deno.writeTextFile(new URL(path, project), code);
  }
  // Use the repository extensions through the normal bootstrap discovery path.
  for (const name of ["ext-parser-babel", "ext-css-tailwind"]) {
    await Deno.mkdir(new URL(`extensions/${name}/`, project), {
      recursive: true,
    });
    await Deno.writeTextFile(
      new URL(`extensions/${name}/index.ts`, project),
      `export { default } from ${
        JSON.stringify(new URL(`extensions/${name}/src/index.ts`, root).href)
      };`,
    );
  }
  await ensureDefaultBundlerContracts();
}

let server: Awaited<ReturnType<typeof startProductionServer>> | undefined;
let child: Deno.ChildProcess | undefined;
const session = new Session();
const post = (method: string) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    session.post(
      method,
      (error, result) =>
        error
          ? reject(error)
          : resolve((result ?? {}) as Record<string, unknown>),
    );
  });
try {
  await prepareFixture();
  const adapter = new DenoAdapter();
  let port = 0;
  const serve = adapter.serve;
  const captureAdapter = Object.assign(adapter, {
    serve: ((handler, options) =>
      serve(handler, {
        ...options,
        onListen: (address) => {
          port = address.port;
          options?.onListen?.(address);
        },
      })) as typeof adapter.serve,
  });
  const started = performance.now();
  server = await startProductionServer({
    projectDir,
    port: 0,
    bindAddress: "127.0.0.1",
    adapter: captureAdapter,
    defaultProjectSlug: "perf",
    defaultProjectId: "perf",
    defaultReleaseId: "standalone-dev",
    defaultEnvironment: "production",
    // Local discovery deliberately selects development compilation. Omit it
    // for the dedicated standalone production runtime backed by the same files.
    ...(scenario === "http-dev" ? { localProjects: { perf: projectDir } } : {}),
    unhandledRejectionGuard: false,
  });
  await server.ready;
  const startupMs = performance.now() - started;
  if (!port) throw new Error("HTTP fixture did not bind a port");
  child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--frozen",
      "--no-prompt",
      "--allow-net=127.0.0.1",
      "scripts/perf/http-client.ts",
      `http://127.0.0.1:${port}`,
      scenario!,
      durationText!,
    ],
    env: {},
    clearEnv: true,
    stdin: "piped",
    stdout: "piped",
    stderr: "inherit",
  }).spawn();
  const writer = child.stdin.getWriter();
  let cpuStart = cpuUsage();
  let measurement: Record<string, unknown> | undefined;
  for await (const message of readMessages(child.stdout)) {
    if (message.stage === "ready") {
      cpuStart = cpuUsage();
      await writer.write(encodeMessage({ stage: "measure" }));
    } else if (message.stage === "measured") {
      const cpu = cpuUsage(cpuStart);
      measurement = {
        ...message.measurement,
        cpuUsPerOperation: (cpu.user + cpu.system) /
          message.measurement.operations,
        rssBytes: Deno.memoryUsage().rss,
        startupMs,
      };
      if (profilePath) {
        session.connect();
        await post("Profiler.enable");
        await post("Profiler.start");
        await writer.write(encodeMessage({ stage: "profile" }));
      } else {
        await writer.write(encodeMessage({ stage: "stop" }));
        await writer.close();
      }
    } else if (message.stage === "profiled") {
      const { profile } = await post("Profiler.stop");
      session.disconnect();
      await Deno.writeTextFile(
        profilePath!,
        JSON.stringify(sanitizeProfile(profile as CpuProfile, root.href)),
      );
      await writer.write(encodeMessage({ stage: "stop" }));
      await writer.close();
    } else throw new Error("Unknown performance control message");
  }
  if (!(await child.status).success || !measurement) {
    throw new Error("HTTP client did not complete its measurement");
  }
  await Deno.stdout.write(encodeMessage(measurement));
} finally {
  session.disconnect();
  try {
    child?.kill("SIGKILL");
  } catch { /* Already exited. */ }
  await server?.stop();
  await Deno.remove(fixture, { recursive: true });
}
// The disposable runtime owns React scheduler ports and extension resources.
Deno.exit(0);
