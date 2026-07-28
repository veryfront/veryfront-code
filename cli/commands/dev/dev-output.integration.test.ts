import "#veryfront/schemas/_test-setup.ts";

import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "#veryfront/testing/deno-compat";
import { delay } from "#std/async";
import { TEST_TIMEOUTS } from "../../../tests/_helpers/constants.ts";
import { withTestContext } from "../../../tests/_helpers/context.ts";
import { fetchWithTimeout, pollHttpReadyByTimeout } from "../../../tests/_helpers/http-polling.ts";

const NOISY_DEFAULT_FRAGMENTS = [
  "declares capabilities",
  "loaded from",
  "Pre-converted schema",
  "Using pre-converted schema",
  "Pod-level module cache initialized",
  "Pod-level ESM cache initialized",
  "Initialized with gateway",
  "Subscribing to ReloadNotifier",
  "Primitive discovery completed",
  "Using import map",
  "built handler",
  "Using runtime model",
  "GET / 200",
] as const;

const DEBUG_EXTENSION_DIAGNOSTICS = [
  "declares capabilities",
  "loaded from",
] as const;

const DEBUG_REQUEST_DIAGNOSTICS = [
  "GET / 200",
] as const;

const DEBUG_API_BUILD_DIAGNOSTICS = [
  "Using import map",
  "built handler",
] as const;

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");

interface CliRun {
  output: () => string;
  stop: () => Promise<void>;
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}

function assertIncludesAny(
  output: string,
  candidates: readonly string[],
  message: string,
): void {
  assert(
    candidates.some((fragment) => output.includes(fragment)),
    `${message}\nExpected one of: ${candidates.join(", ")}\nOutput:\n${output}`,
  );
}

async function scaffoldMinimalProject(projectDir: string): Promise<void> {
  await writeTextFile(
    join(projectDir, "veryfront.config.js"),
    `export default {
  title: "Quiet Dev Logs Contract",
  dev: {
    host: "127.0.0.1"
  },
  resolve: {
    importMap: {
      imports: {
        "@/": "./"
      }
    }
  }
};
`,
  );

  await mkdir(join(projectDir, "app", "api", "ping"), { recursive: true });
  await mkdir(join(projectDir, "lib"), { recursive: true });
  await writeTextFile(
    join(projectDir, "app", "page.tsx"),
    `export default function Page() {
  return <main>quiet dev logs page</main>;
}
`,
  );
  await writeTextFile(
    join(projectDir, "lib", "ping.ts"),
    `export const pingPayload = { ok: true };
`,
  );
  await writeTextFile(
    join(projectDir, "app", "api", "ping", "route.ts"),
    `import { pingPayload } from "@/lib/ping.ts";

export function GET() {
  return Response.json(pingPayload);
}
`,
  );
}

function makeChildEnv(
  projectDir: string,
  debugEnv: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {
    PATH: Deno.env.get("PATH") ?? "",
    HOME: projectDir,
    TMPDIR: Deno.env.get("TMPDIR") ?? "/tmp",
    CI: "1",
    DENO_TESTING: "1",
    NO_COLOR: "1",
    NODE_ENV: "development",
    LOG_FORMAT: "text",
    LOG_LEVEL: "INFO",
    VERYFRONT_API_TOKEN: "",
    VERYFRONT_DEBUG: "",
    VERYFRONT_NO_UPDATE_CHECK: "1",
    VF_DISABLE_LRU_INTERVAL: "1",
    SSR_TRANSFORM_PER_PROJECT_LIMIT: "0",
    REVALIDATION_PER_PROJECT_LIMIT: "0",
    ...debugEnv,
  };

  const denoDir = Deno.env.get("DENO_DIR");
  const homeDir = Deno.env.get("HOME");
  if (denoDir) {
    env.DENO_DIR = denoDir;
  } else if (homeDir) {
    env.DENO_DIR = join(homeDir, "Library", "Caches", "deno");
  }

  return env;
}

function startVeryfrontDev(
  projectDir: string,
  port: number,
  args: string[] = [],
  env: Record<string, string> = {},
): CliRun {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      "--unstable-worker-options",
      "--unstable-net",
      "cli/main.ts",
      "dev",
      "--project",
      projectDir,
      "--port",
      String(port),
      "--no-hmr",
      ...args,
    ],
    cwd: Deno.cwd(),
    clearEnv: true,
    env: makeChildEnv(projectDir, env),
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });

  const child = command.spawn();
  const decoder = new TextDecoder();
  let captured = "";

  const drain = async (stream: ReadableStream<Uint8Array> | null): Promise<void> => {
    if (!stream) return;
    const reader = stream.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        captured += decoder.decode(value, { stream: true });
      }
      captured += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  };

  const stdoutDone = drain(child.stdout);
  const stderrDone = drain(child.stderr);

  return {
    output: () => stripAnsi(captured),
    stop: async () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Process may already have exited.
      }

      const status = await Promise.race([
        child.status,
        delay(2_000).then(() => undefined),
      ]);

      if (status === undefined) {
        try {
          child.kill("SIGKILL");
        } catch {
          // Process may already have exited.
        }
        await child.status;
      }

      await Promise.race([
        Promise.all([stdoutDone, stderrDone]),
        delay(1_000),
      ]);
    },
  };
}

async function requestPageAndApi(port: number): Promise<void> {
  const pageResponse = await fetchWithTimeout(`http://127.0.0.1:${port}/`);
  try {
    assertEquals(pageResponse.status, 200);
    assertStringIncludes(await pageResponse.text(), "quiet dev logs page");
  } finally {
    await pageResponse.body?.cancel().catch(() => {});
  }

  const apiResponse = await fetchWithTimeout(`http://127.0.0.1:${port}/api/ping`);
  try {
    assertEquals(apiResponse.status, 200);
    assertEquals(await apiResponse.json(), { ok: true });
  } finally {
    await apiResponse.body?.cancel().catch(() => {});
  }
}

describe(
  "veryfront dev output",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it(
      "keeps default dev output focused on readiness and hides routine diagnostics",
      { timeout: TEST_TIMEOUTS.INTEGRATION },
      async () => {
        await withTestContext("quiet-dev-output-default", async (context) => {
          await scaffoldMinimalProject(context.projectDir);
          const port = await context.allocatePort();
          const run = startVeryfrontDev(context.projectDir, port);
          context.addCleanup(run.stop);

          const ready = await pollHttpReadyByTimeout(`http://127.0.0.1:${port}/`, {
            timeoutMs: TEST_TIMEOUTS.SERVER_STARTUP,
            requestTimeoutMs: 1_000,
            verifyWithSecondRequest: false,
          });
          assert(ready.ready, `dev server did not become ready:\n${run.output()}`);

          await requestPageAndApi(port);
          await delay(300);

          const output = run.output();
          assertStringIncludes(output, "Server ready at");

          for (const fragment of NOISY_DEFAULT_FRAGMENTS) {
            assert(
              !output.includes(fragment),
              `default dev output should not include "${fragment}"\nOutput:\n${output}`,
            );
          }
        });
      },
    );

    it(
      "keeps representative diagnostics visible with --debug",
      { timeout: TEST_TIMEOUTS.INTEGRATION },
      async () => {
        await withTestContext("quiet-dev-output-debug", async (context) => {
          await scaffoldMinimalProject(context.projectDir);
          const port = await context.allocatePort();
          const run = startVeryfrontDev(context.projectDir, port, ["--debug"]);
          context.addCleanup(run.stop);

          const ready = await pollHttpReadyByTimeout(`http://127.0.0.1:${port}/`, {
            timeoutMs: TEST_TIMEOUTS.SERVER_STARTUP,
            requestTimeoutMs: 1_000,
            verifyWithSecondRequest: false,
          });
          assert(ready.ready, `debug dev server did not become ready:\n${run.output()}`);

          await requestPageAndApi(port);
          await delay(300);

          const output = run.output();
          assertStringIncludes(output, "Server ready at");
          assertIncludesAny(
            output,
            DEBUG_EXTENSION_DIAGNOSTICS,
            "--debug should expose extension diagnostics",
          );
          assertIncludesAny(
            output,
            DEBUG_REQUEST_DIAGNOSTICS,
            "--debug should expose request diagnostics",
          );
          assertIncludesAny(
            output,
            DEBUG_API_BUILD_DIAGNOSTICS,
            "--debug should expose API build diagnostics",
          );
        });
      },
    );
  },
);
