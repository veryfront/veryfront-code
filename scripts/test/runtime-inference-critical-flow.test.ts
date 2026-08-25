import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";
import {
  artifactClaim,
  assertListedRunFailure,
  parseAgUiTextDeltas,
  parsePackedArtifactDirectory,
  parseRuntimeSelection,
  parseScopedResponseJson,
  sanitizeRuntimeCriticalFlowFailureText,
  validateAnthropicRequest,
  waitForProviderCancellation,
  waitForProviderReceipt,
  waitForTerminalRun,
} from "./runtime-inference-critical-flow.ts";
import {
  inspectModuleExports,
  packedFileDependencies,
  parseCommaSeparatedFlag,
} from "./runtime-e2e-helpers.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";

const VALID_WIRE_MODEL = "claude-haiku-4-5-20251001";
const VALID_KEY = "vf-runtime-critical-flow-key";
const FLOW_TEST_PATH = "scripts/test/runtime-inference-critical-flow.test.ts";
const FLOW_HARNESS_PATH = "scripts/test/runtime-inference-critical-flow.ts";
const REPO_ROOT = new URL("../../", import.meta.url);

function anthropicRequest(overrides: {
  method?: string;
  path?: string;
  key?: string;
  anthropicVersion?: string | null;
  contentType?: string | null;
  body?: unknown;
} = {}): Request {
  const headers = new Headers({
    "x-api-key": overrides.key ?? VALID_KEY,
  });
  if (overrides.anthropicVersion !== null) {
    headers.set(
      "anthropic-version",
      overrides.anthropicVersion ?? "2023-06-01",
    );
  }
  if (overrides.contentType !== null) {
    headers.set(
      "content-type",
      overrides.contentType ?? "application/json",
    );
  }
  return new Request(`http://127.0.0.1${overrides.path ?? "/v1/messages"}`, {
    method: overrides.method ?? "POST",
    headers,
    body: JSON.stringify(
      overrides.body ?? {
        model: VALID_WIRE_MODEL,
        messages: [{ role: "user", content: "marker: contract-marker" }],
      },
    ),
  });
}

async function assertRejectsWithMessage(
  fn: () => Promise<unknown>,
  expected: string,
  assertionMessage: string,
): Promise<void> {
  const error = await assertRejects(
    fn,
    Error,
    undefined,
    assertionMessage,
  );
  assertStringIncludes((error as Error).message, expected, assertionMessage);
}

function yamlRecord(value: unknown, context: string): Record<string, unknown> {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${context} must be an object`,
  );
  return value as Record<string, unknown>;
}

function unresolvedCancellationFields(): {
  cancellationEvidence: () => undefined;
  cancellation: Promise<string>;
} {
  return {
    cancellationEvidence: () => undefined,
    cancellation: new Promise<string>(() => {}),
  };
}

describe("runtime inference critical-flow pure contract", () => {
  it("accepts the canonical packed artifact directory as an inline or separate flag", () => {
    assertEquals(
      parsePackedArtifactDirectory(["--packed-dir=dist/npm-compatibility"]),
      "dist/npm-compatibility",
    );
    assertEquals(
      parsePackedArtifactDirectory(["--packed-dir", "/tmp/npm-artifact"]),
      "/tmp/npm-artifact",
    );
    assertEquals(parsePackedArtifactDirectory([]), undefined);
    assertThrows(
      () => parsePackedArtifactDirectory(["--packed-dir"]),
      Error,
      "--packed-dir requires a directory",
    );
  });

  it("maps only selected packed extensions to local file dependencies", () => {
    const packed = {
      root: "/packs/veryfront.tgz",
      rootExtensionNames: ["@veryfront/ext-bundler-esbuild"],
      extensions: [
        {
          name: "@veryfront/ext-bundler-esbuild",
          tarball: "/packs/ext-bundler-esbuild.tgz",
        },
        {
          name: "@veryfront/ext-content-mdx",
          tarball: "/packs/ext-content-mdx.tgz",
        },
      ],
    };

    assertEquals(
      packedFileDependencies(packed, packed.rootExtensionNames),
      {
        "@veryfront/ext-bundler-esbuild": "file:/packs/ext-bundler-esbuild.tgz",
      },
    );
    assertEquals(
      packedFileDependencies(packed, ["@veryfront/ext-content-mdx"]),
      {
        "@veryfront/ext-content-mdx": "file:/packs/ext-content-mdx.tgz",
      },
    );
    assertThrows(
      () => packedFileDependencies(packed, ["@veryfront/ext-missing"]),
      Error,
      "Packed extension is unavailable: @veryfront/ext-missing",
    );
  });

  it("redacts local paths from critical-flow command failures", () => {
    const checkoutPath = "/workspace/veryfront-code";
    const message = sanitizeRuntimeCriticalFlowFailureText(
      [
        "deno task build:npm --packed-dir=/private/tmp/vf/artifact failed",
        "stderr: cannot read file:///private/tmp/vf/cache/mod.ts",
        `stack: at main (${checkoutPath}/scripts/test/runtime-inference-critical-flow.ts:1:1)`,
      ].join("\n"),
      [checkoutPath],
    );

    assertStringIncludes(
      message,
      "<REDACTED>",
      "Redacted critical-flow failures should preserve placeholder evidence",
    );
    assert(
      !message.includes("/private/tmp/vf"),
      "Redacted critical-flow failures must not include temp artifact paths",
    );
    assert(
      !message.includes("file:///private/tmp"),
      "Redacted critical-flow failures must not include file URL paths",
    );
    assert(
      !message.includes(checkoutPath),
      "Redacted critical-flow failures must not include the checkout path",
    );
  });

  it("selects all runtimes by default in stable order", () => {
    assertEquals(
      parseRuntimeSelection([]),
      ["node", "bun", "deno"],
      "Default runtime selection should cover all supported runtimes in stable order",
    );
  });

  it("selects explicit runtimes from inline or separate flags", () => {
    assertEquals(
      parseRuntimeSelection(["--runtime=node"]),
      ["node"],
      "Inline --runtime should select exactly the requested runtime",
    );
    assertEquals(
      parseRuntimeSelection(["--runtime", "bun"]),
      ["bun"],
      "Separate --runtime value should select exactly the requested runtime",
    );
    assertEquals(
      parseRuntimeSelection(["--runtimes=deno,node"]),
      ["deno", "node"],
      "Comma-separated --runtimes should preserve explicit runtime order",
    );
    assertEquals(
      parseCommaSeparatedFlag(["--runtime=node,bun"], ["runtime"]),
      ["node", "bun"],
      "Shared comma flag parser should return trimmed runtime entries",
    );
  });

  it("rejects missing, unknown, and duplicate runtime selections", () => {
    assertThrows(
      () => parseRuntimeSelection(["--runtime"]),
      Error,
      "--runtime requires a comma-separated value",
      "Missing runtime flag value should throw the parser's validation error",
    );
    assertThrows(
      () => parseRuntimeSelection(["--runtime=python"]),
      Error,
      "Unknown runtime: python",
      "Unknown runtime names should be rejected before execution",
    );
    assertThrows(
      () => parseRuntimeSelection(["--runtime=node,node"]),
      Error,
      "Duplicate runtime: node",
      "Duplicate runtime names should be rejected before execution",
    );
  });

  it("states honest runtime artifact claims", () => {
    assertStringIncludes(
      artifactClaim("node"),
      "packed npm consumer",
      "Node artifact claim should name npm consumer coverage",
    );
    assertStringIncludes(
      artifactClaim("bun"),
      "packed package consumer",
      "Bun artifact claim should name package consumer coverage",
    );
    assertStringIncludes(
      artifactClaim("deno"),
      "packed CLI",
      "Deno artifact claim should name packed CLI coverage",
    );
    assertEquals(
      artifactClaim("deno").includes("npm install"),
      false,
      "Deno artifact claim should not imply npm installation semantics",
    );
  });

  it("accepts exact Anthropic requests with the expected marker", async () => {
    await validateAnthropicRequest(
      anthropicRequest(),
      "contract-marker",
    );
  });

  it("rejects invalid Anthropic request shape before recording success", async () => {
    await assertRejectsWithMessage(
      () =>
        validateAnthropicRequest(
          new Request("http://127.0.0.1/v1/messages", { method: "GET" }),
          "contract-marker",
        ),
      "POST /v1/messages",
      "Validator should reject requests that do not use POST /v1/messages",
    );
    await assertRejectsWithMessage(
      () =>
        validateAnthropicRequest(
          anthropicRequest({ path: "/wrong" }),
          "contract-marker",
        ),
      "POST /v1/messages",
      "Validator should reject requests sent to the wrong Anthropic path",
    );
    await assertRejectsWithMessage(
      () =>
        validateAnthropicRequest(
          anthropicRequest({ key: "wrong" }),
          "contract-marker",
        ),
      "x-api-key",
      "Validator should reject requests without the expected test API key",
    );
    await assertRejectsWithMessage(
      () =>
        validateAnthropicRequest(
          anthropicRequest({ anthropicVersion: null }),
          "contract-marker",
        ),
      "anthropic-version",
      "Validator should reject requests without the required Anthropic version",
    );
    await assertRejectsWithMessage(
      () =>
        validateAnthropicRequest(
          anthropicRequest({ contentType: "text/plain" }),
          "contract-marker",
        ),
      "application/json",
      "Validator should reject requests without a JSON content type",
    );
    await assertRejectsWithMessage(
      () =>
        validateAnthropicRequest(
          new Request("http://127.0.0.1/v1/messages", {
            method: "POST",
            headers: {
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
              "x-api-key": VALID_KEY,
            },
            body: "{",
          }),
          "contract-marker",
        ),
      "valid JSON",
      "Validator should preserve invalid JSON validation failures",
    );
    await assertRejectsWithMessage(
      () =>
        validateAnthropicRequest(
          anthropicRequest({ body: { model: "wrong", messages: [] } }),
          "contract-marker",
        ),
      VALID_WIRE_MODEL,
      "Validator should preserve wrong model validation failures",
    );
    await assertRejectsWithMessage(
      () =>
        validateAnthropicRequest(
          anthropicRequest({ body: { model: VALID_WIRE_MODEL, messages: [] } }),
          "contract-marker",
        ),
      "contract-marker",
      "Validator should reject requests that omit the workflow marker",
    );
  });

  it("extracts assistant text deltas without matching user-message snapshots", () => {
    const marker = "agent-output-marker";
    const stream = [
      `event: MessagesSnapshot\ndata: ${
        JSON.stringify({ messages: [{ role: "user", content: marker }] })
      }`,
      `event: TextMessageContent\ndata: ${JSON.stringify({ delta: marker })}`,
      `event: RunFinished\ndata: {}`,
      "",
    ].join("\n\n");
    assertEquals(
      parseAgUiTextDeltas(stream),
      [marker],
      "AG-UI output proof should read assistant TextMessageContent deltas only",
    );
    assertEquals(
      parseAgUiTextDeltas(
        `event: MessagesSnapshot\ndata: ${
          JSON.stringify({ messages: [{ role: "user", content: marker }] })
        }\n\n`,
      ),
      [],
      "A user-message snapshot must not count as assistant/provider output",
    );
  });

  it("surfaces provider validation failures instead of generic receipt timeouts", async () => {
    const detailCalls: string[] = [];
    await withMockFetch(
      ((input: URL | RequestInfo) => {
        detailCalls.push(String(input));
        return Promise.resolve(Response.json({ status: "running" }));
      }) as typeof fetch,
      async () => {
        await assertRejectsWithMessage(
          () =>
            waitForProviderReceipt(
              {
                received: [],
                server: {} as Deno.HttpServer,
                abort() {},
                closed: Promise.resolve(),
                validationFailure: () =>
                  new Error(
                    `Expected Anthropic model ${VALID_WIRE_MODEL}, got wrong`,
                  ),
                ...unresolvedCancellationFields(),
                url: new URL("http://127.0.0.1:1/v1"),
              },
              "node",
              new URL("http://127.0.0.1/runs/validation-failed"),
            ),
          `Expected Anthropic model ${VALID_WIRE_MODEL}, got wrong`,
          "Provider receipt wait should surface validation failures before polling detail",
        );
        assertEquals(
          detailCalls.length,
          0,
          "Provider receipt wait should not poll run detail after validation already failed",
        );
      },
    );
  });

  it("surfaces provider validation failures that arrive with terminal detail", async () => {
    let validationFailure: Error | undefined;
    await withMockFetch(
      (() => {
        validationFailure = new Error(
          `Expected Anthropic model ${VALID_WIRE_MODEL}, got wrong`,
        );
        return Promise.resolve(Response.json({ status: "failed" }));
      }) as typeof fetch,
      async () => {
        await assertRejectsWithMessage(
          () =>
            waitForProviderReceipt(
              {
                received: [],
                server: {} as Deno.HttpServer,
                abort() {},
                closed: Promise.resolve(),
                validationFailure: () => validationFailure,
                ...unresolvedCancellationFields(),
                url: new URL("http://127.0.0.1:1/v1"),
              },
              "node",
              new URL("http://127.0.0.1/runs/terminal-validation-failed"),
            ),
          `Expected Anthropic model ${VALID_WIRE_MODEL}, got wrong`,
          "Provider receipt wait should surface validation failures observed during terminal polling",
        );
      },
    );
  });

  it("preserves terminal-detail validation failure observed during provider wait", async () => {
    const expectedMessage =
      `Expected Anthropic model ${VALID_WIRE_MODEL}, got wrong`;
    let validationFailure: Error | undefined;
    await withMockFetch(
      (() => {
        validationFailure = new Error(expectedMessage);
        return Promise.resolve(Response.json({ status: "failed" }));
      }) as typeof fetch,
      async () => {
        const error = await assertRejects(
          () =>
            waitForProviderReceipt(
              {
                received: [],
                server: {} as Deno.HttpServer,
                abort() {},
                closed: Promise.resolve(),
                validationFailure: () => validationFailure,
                ...unresolvedCancellationFields(),
                url: new URL("http://127.0.0.1:1/v1"),
              },
              "node",
              new URL("http://127.0.0.1/runs/deadline-edge-validation-failed"),
            ),
          Error,
          undefined,
          "Provider wait should reject when validation fails during terminal polling",
        );
        assertEquals(
          (error as Error).message,
          expectedMessage,
          "Provider wait should not replace validation error text with generic timeout text",
        );
      },
    );
  });

  it("requires provider-side client abort evidence before cleanup can release the black-hole response", async () => {
    await waitForProviderCancellation(
      {
        received: [],
        server: {} as Deno.HttpServer,
        abort() {
          throw new Error("cleanup abort should not be needed for evidence");
        },
        closed: Promise.resolve(),
        validationFailure: () => undefined,
        cancellationEvidence: () => "client connection aborted",
        cancellation: Promise.resolve("client connection aborted"),
        url: new URL("http://127.0.0.1:1/v1"),
      },
      "node",
      25,
    );

    await assertRejectsWithMessage(
      () =>
        waitForProviderCancellation(
          {
            received: [],
            server: {} as Deno.HttpServer,
            abort() {
              throw new Error(
                "cleanup abort should not be needed for evidence",
              );
            },
            closed: Promise.resolve(),
            validationFailure: () => undefined,
            cancellationEvidence: () => undefined,
            cancellation: new Promise<string>(() => {}),
            url: new URL("http://127.0.0.1:1/v1"),
          },
          "node",
          10,
        ),
      "provider request was not aborted by the client before cleanup",
      "Provider cancellation wait should fail if cleanup would be the only release path",
    );
  });

  it("polls through non-terminal states and returns terminal failure details", async () => {
    const states = [
      { status: "pending" },
      { status: "running" },
      {
        status: "failed",
        nodeStates: { "call-provider": { status: "failed" } },
      },
    ];
    let calls = 0;
    await withMockFetch(
      (() => {
        const body = states[Math.min(calls, states.length - 1)];
        calls += 1;
        return Promise.resolve(Response.json(body));
      }) as typeof fetch,
      async () => {
        const detail = await waitForTerminalRun(
          new URL("http://127.0.0.1/runs/1"),
          1_000,
        );
        assertEquals(
          detail.status,
          "failed",
          "Terminal run polling should return the failed detail payload",
        );
        assertEquals(
          calls,
          3,
          "Terminal run polling should continue through pending and running states",
        );
      },
    );
  });

  it("rejects terminal success and preserves last observation on deadline", async () => {
    await withMockFetch(
      (() =>
        Promise.resolve(
          Response.json({ status: "completed" }),
        )) as typeof fetch,
      async () => {
        await assertRejectsWithMessage(
          () => waitForTerminalRun(new URL("http://127.0.0.1/runs/ok"), 1_000),
          "unexpected terminal status",
          "Terminal run polling should reject completed runs for the timeout contract",
        );
      },
    );

    await withMockFetch(
      (() =>
        Promise.resolve(
          Response.json({
            status: "running",
            nodeStates: { "call-provider": { status: "running" } },
          }),
        )) as typeof fetch,
      async () => {
        const error = await assertRejects(
          () => waitForTerminalRun(new URL("http://127.0.0.1/runs/slow"), 40),
          Error,
          undefined,
          "Terminal run polling should reject when the deadline expires",
        );
        assertStringIncludes(
          (error as Error).message,
          "timed out",
          "Terminal run polling deadline should report a timeout",
        );
        assertStringIncludes(
          (error as Error).message,
          "running",
          "Terminal run polling deadline should include the last observed state",
        );
      },
    );
  });

  it("aborts each poll fetch independently", async () => {
    const observed: AbortSignal[] = [];
    await withMockFetch(
      ((_input: URL | RequestInfo, init?: RequestInit) => {
        assert(
          init?.signal instanceof AbortSignal,
          "Terminal run polling should attach an AbortSignal to each fetch",
        );
        observed.push(init.signal);
        return Promise.resolve(Response.json({ status: "failed" }));
      }) as typeof fetch,
      async () => {
        await waitForTerminalRun(new URL("http://127.0.0.1/runs/1"), 1_000);
        assertEquals(
          observed.length,
          1,
          "Terminal run polling should issue exactly one fetch for immediate failure",
        );
        assertEquals(
          observed[0]?.aborted,
          false,
          "Terminal run polling should clear the timeout without aborting a completed fetch",
        );
      },
    );
  });

  it("requires the listed run to carry the failed provider node state", () => {
    const listed = assertListedRunFailure(
      "node/packed npm consumer",
      {
        runs: [{
          id: "run-1",
          status: "failed",
          nodeStates: {
            "call-provider": {
              status: "failed",
              error: "Agent timed out after 2000ms",
            },
          },
        }],
      },
      "run-1",
    );

    assertEquals(
      listed.id,
      "run-1",
      "List assertion should return the same run that matched the requested run id",
    );

    assertThrows(
      () =>
        assertListedRunFailure(
          "node/packed npm consumer",
          { runs: [] },
          "run-1",
        ),
      Error,
      "persistence/list: failed run was not listed",
      "List assertion should reject a response that omits the requested run",
    );
    assertThrows(
      () =>
        assertListedRunFailure(
          "node/packed npm consumer",
          {
            runs: [{
              id: "run-1",
              status: "running",
              nodeStates: { "call-provider": { status: "running" } },
            }],
          },
          "run-1",
        ),
      Error,
      "persistence/list: listed run was not failed",
      "List assertion should reject a requested run that is not failed",
    );

    assertThrows(
      () =>
        assertListedRunFailure(
          "node/packed npm consumer",
          {
            runs: [{
              id: "run-1",
              status: "failed",
              nodeStates: { "call-provider": { status: "running" } },
            }],
          },
          "run-1",
        ),
      Error,
      "persistence/list: call-provider was not failed",
      "List assertion should reject a listed run whose provider node is not failed",
    );
    assertThrows(
      () =>
        assertListedRunFailure(
          "node/packed npm consumer",
          {
            runs: [{
              id: "run-1",
              status: "failed",
              nodeStates: { "call-provider": { status: "failed" } },
            }],
          },
          "run-1",
        ),
      Error,
      "expected 2000ms timeout evidence for call-provider",
      "List assertion should reject a failed provider node with missing timeout error evidence",
    );
    assertThrows(
      () =>
        assertListedRunFailure(
          "node/packed npm consumer",
          {
            runs: [{
              id: "run-1",
              status: "failed",
              nodeStates: {
                "call-provider": {
                  status: "failed",
                  error: "provider returned 401",
                },
              },
            }],
          },
          "run-1",
        ),
      Error,
      "expected 2000ms timeout evidence for call-provider",
      "List assertion should reject a failed provider node with non-timeout error evidence",
    );
  });

  it("classifies successful plaintext start responses as route/start JSON failures", () => {
    assertThrows(
      () =>
        parseScopedResponseJson(
          "node/packed npm consumer",
          "route/start",
          "this is not json",
        ),
      Error,
      "node/packed npm consumer route/start: response was not JSON: this is not json",
      "Route/start JSON parser should preserve the route/start failure scope",
    );
  });

  it("classifies successful plaintext list responses as persistence/list JSON failures", () => {
    assertThrows(
      () =>
        parseScopedResponseJson(
          "bun/packed package consumer",
          "persistence/list",
          "plain text list response",
        ),
      Error,
      "bun/packed package consumer persistence/list: response was not JSON: plain text list response",
      "Persistence/list JSON parser should preserve the list failure scope",
    );
  });

  it("does not execute the critical-flow journey on import", async () => {
    const exports = await inspectModuleExports(
      new URL("./runtime-inference-critical-flow.ts", import.meta.url),
      "runtime inference",
    );
    assert(
      exports.includes("parseRuntimeSelection"),
      "Critical-flow module should export parseRuntimeSelection on import",
    );
    assert(
      exports.includes("runRuntimeInferenceCriticalFlow"),
      "Critical-flow module should export runRuntimeInferenceCriticalFlow on import",
    );
  });
});

describe("runtime inference critical-flow CI contract", () => {
  it("exposes the focused script test and executable runtime task", async () => {
    const denoConfig = JSON.parse(
      await Deno.readTextFile(new URL("deno.json", REPO_ROOT)),
    ) as {
      tasks: Record<string, string | { command: string }>;
    };

    const testScripts = String(denoConfig.tasks["test:scripts"]);
    assertStringIncludes(
      testScripts,
      FLOW_TEST_PATH,
      "test:scripts should include the critical-flow unit test",
    );

    const task = denoConfig.tasks["test:e2e:runtime-inference-critical-flow"];
    assertEquals(
      typeof task,
      "string",
      "Critical-flow E2E task should be registered as a string command",
    );
    assertStringIncludes(
      String(task),
      `deno run --allow-all ${FLOW_HARNESS_PATH}`,
      "Critical-flow E2E task should execute the shared TypeScript harness",
    );
  });

  it("runs a dedicated runtime critical-flow matrix with stable check names", async () => {
    const workflow = yamlRecord(
      parse(
        await Deno.readTextFile(
          new URL(".github/workflows/cicd.yml", REPO_ROOT),
        ),
      ),
      "cicd workflow",
    );
    const jobs = yamlRecord(workflow.jobs, "cicd workflow jobs");
    const job = yamlRecord(
      jobs["tests-runtime-critical-flow"],
      "tests-runtime-critical-flow job",
    );

    assertEquals(
      job.name,
      "tests (runtime critical flow: ${{ matrix.runtime }})",
      "Runtime critical-flow job should expose stable matrix check names",
    );
    assertEquals(
      job["runs-on"],
      "ubuntu-latest",
      "Runtime critical-flow job should run on Ubuntu",
    );
    assertEquals(
      job["timeout-minutes"],
      20,
      "Runtime critical-flow job should keep a bounded timeout",
    );

    const strategy = yamlRecord(job.strategy, "runtime critical-flow strategy");
    const matrix = yamlRecord(strategy.matrix, "runtime critical-flow matrix");
    assertEquals(
      matrix.runtime,
      ["deno", "node", "bun"],
      "Runtime critical-flow matrix should include Deno, Node, and Bun lanes",
    );

    const steps = job.steps as Array<Record<string, unknown>>;
    assert(
      steps.some((step) => step.uses === "./.github/actions/setup-deno"),
      "Runtime critical-flow job should install Deno",
    );
    assert(
      steps.some((step) =>
        step.uses ===
          "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020" &&
        yamlRecord(step.with, "setup-node with")["node-version"] === "24"
      ),
      "Runtime critical-flow job should install Node 24",
    );
    assert(
      steps.some((step) =>
        step.uses ===
          "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6" &&
        yamlRecord(step.with, "setup-bun with")["bun-version"] === "1.3.6"
      ),
      "Runtime critical-flow job should install Bun 1.3.6 for the Bun lane",
    );
    assert(
      steps.some((step) =>
        step.name === "Run runtime critical flow" &&
        step.run ===
          "deno run -A scripts/test/runtime-inference-critical-flow.ts --runtime=${{ matrix.runtime }} --packed-dir=dist/npm-compatibility"
      ),
      "Runtime critical-flow job should consume the canonical artifact for the matrix runtime",
    );
  });
});
