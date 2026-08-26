import "#veryfront/schemas/_test-setup.ts";

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "#veryfront/testing/deno-compat";
import { TEST_TIMEOUTS } from "../../../tests/_helpers/constants.ts";
import { withTestContext } from "../../../tests/_helpers/context.ts";
import {
  fetchWithTimeout,
  pollUrlReady,
  waitForPromiseWithTimeout,
} from "../../../tests/_helpers/server.ts";
import { VERSION } from "#cli/utils";

const NOISY_DEFAULT_FRAGMENTS = [
  "Dev server running at",
  "Listening on http://",
  "Shutting down dev server",
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
  "GET /_ws 101",
  "Neither CORS nor CSRF protection is configured",
  "[HMR] Re-discovered:",
  "triggerReload called",
  "Global cache cleared",
  "Skipping cache invalidation",
  "[CLIENT WARN] Console warning",
  "[HMR] Reloading page:",
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
  hmr = false,
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
      ...(hmr ? [] : ["--no-hmr"]),
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
  const status = child.status;
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

      try {
        await waitForPromiseWithTimeout(status, 2_000, "dev server did not stop after SIGTERM");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // Process may already have exited.
        }
        await status;
      }

      await Promise.all([stdoutDone, stderrDone]);
    },
  };
}

interface PageReader {
  read(): Promise<ReadableStreamReadResult<Uint8Array>>;
  cancel(): Promise<void>;
  releaseLock(): void;
}

interface PageResponse {
  readonly body: { getReader(): PageReader } | null;
}

type PageRequest = (url: string, timeoutMs: number) => Promise<PageResponse>;

async function waitForPageContent(
  port: number,
  expected: string,
  timeoutMs: number = TEST_TIMEOUTS.SERVER_STARTUP,
  requestPage: PageRequest = fetchWithTimeout,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await requestPage(`http://127.0.0.1:${port}/`, 1_000);
      const content = await readResponseTextAndRelease(response);
      if (content.includes(expected)) return;
    } catch {
      // The server may be between reloads.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for page content "${expected}"`);
}

async function readResponseTextAndRelease(response: PageResponse): Promise<string> {
  const body = response.body;
  if (body === null) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let content = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return content + decoder.decode();
      content += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
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
  () => {
    it("releases page response readers after successful and failed reads", async () => {
      const failedResponse = new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.error(new DOMException("Body read aborted", "AbortError"));
          },
        }),
      );
      const successfulResponse = new Response("updated dev logs page");
      const failedBody = failedResponse.body;
      const successfulBody = successfulResponse.body;
      assert(failedBody !== null);
      assert(successfulBody !== null);

      await assertRejects(
        () => readResponseTextAndRelease(failedResponse),
        DOMException,
        "Body read aborted",
      );
      assertEquals(
        await readResponseTextAndRelease(successfulResponse),
        "updated dev logs page",
      );
      assert(!failedBody.locked);
      assert(!successfulBody.locked);
    });

    it("cancels page readers while polling after successful and failed reads", async () => {
      const cancelled: string[] = [];
      const released: string[] = [];
      const failedResponse: PageResponse = {
        body: {
          getReader: () => ({
            read: () => Promise.reject(new DOMException("Body read aborted", "AbortError")),
            cancel: () => {
              cancelled.push("failed");
              return Promise.resolve();
            },
            releaseLock: () => released.push("failed"),
          }),
        },
      };
      let successfulRead = false;
      const successfulResponse: PageResponse = {
        body: {
          getReader: () => ({
            read: (): Promise<ReadableStreamReadResult<Uint8Array>> => {
              if (successfulRead) return Promise.resolve({ done: true, value: undefined });
              successfulRead = true;
              return Promise.resolve({
                done: false,
                value: new TextEncoder().encode("updated dev logs page"),
              });
            },
            cancel: () => {
              cancelled.push("successful");
              return Promise.resolve();
            },
            releaseLock: () => released.push("successful"),
          }),
        },
      };
      const responses = [failedResponse, successfulResponse];
      const requests: Array<{ url: string; timeoutMs: number }> = [];

      await waitForPageContent(4_246, "updated dev logs page", 1_000, (url, timeoutMs) => {
        requests.push({ url, timeoutMs });
        return Promise.resolve(responses.shift()!);
      });

      assertEquals(cancelled, ["failed", "successful"]);
      assertEquals(released, ["failed", "successful"]);
      assertEquals(requests, [
        { url: "http://127.0.0.1:4246/", timeoutMs: 1_000 },
        { url: "http://127.0.0.1:4246/", timeoutMs: 1_000 },
      ]);
    });

    it(
      "keeps default dev output focused on readiness and hides routine diagnostics",
      { timeout: TEST_TIMEOUTS.INTEGRATION },
      async () => {
        await withTestContext("quiet-dev-output-default", async (context) => {
          await scaffoldMinimalProject(context.projectDir);
          const port = await context.allocatePort();
          const run = startVeryfrontDev(context.projectDir, port);
          context.addCleanup(run.stop);

          const ready = await pollUrlReady(`http://127.0.0.1:${port}/`, {
            timeoutMs: TEST_TIMEOUTS.SERVER_STARTUP,
            requestTimeoutMs: 1_000,
            verifyWithSecondRequest: false,
          });
          assert(ready.ready, `dev server did not become ready:\n${run.output()}`);

          await requestPageAndApi(port);
          await run.stop();

          const output = run.output();
          assertStringIncludes(output, `Veryfront (v${VERSION})`);
          assertStringIncludes(output, "Ready in");
          assert(!output.includes("Logged in as"));
          assert(!output.includes("Press s to"));

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

          const ready = await pollUrlReady(`http://127.0.0.1:${port}/`, {
            timeoutMs: TEST_TIMEOUTS.SERVER_STARTUP,
            requestTimeoutMs: 1_000,
            verifyWithSecondRequest: false,
          });
          assert(ready.ready, `debug dev server did not become ready:\n${run.output()}`);

          await requestPageAndApi(port);
          await run.stop();

          const output = run.output();
          assertStringIncludes(output, "Ready in");
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

    it(
      "reloads changed files without printing routine HMR internals",
      { timeout: TEST_TIMEOUTS.INTEGRATION },
      async () => {
        await withTestContext("quiet-dev-output-hmr", async (context) => {
          await scaffoldMinimalProject(context.projectDir);
          const port = await context.allocatePort();
          const run = startVeryfrontDev(context.projectDir, port, [], {}, true);
          context.addCleanup(run.stop);

          const ready = await pollUrlReady(`http://127.0.0.1:${port}/`, {
            timeoutMs: TEST_TIMEOUTS.SERVER_STARTUP,
            requestTimeoutMs: 1_000,
            verifyWithSecondRequest: false,
          });
          assert(ready.ready, `HMR dev server did not become ready:\n${run.output()}`);

          await writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `export default function Page() {
  return <main>updated dev logs page</main>;
}
`,
          );

          await waitForPageContent(port, "updated dev logs page");

          await new Promise((resolve) => setTimeout(resolve, 250));
          await run.stop();

          const output = run.output();
          assertStringIncludes(output, "Ready in");
          for (const fragment of NOISY_DEFAULT_FRAGMENTS) {
            assert(
              !output.includes(fragment),
              `default HMR output should not include "${fragment}"\nOutput:\n${output}`,
            );
          }
        });
      },
    );
  },
);
