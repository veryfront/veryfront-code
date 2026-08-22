import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  artifactClaim,
  parseRuntimeSelection,
  validateAnthropicRequest,
  waitForProviderReceipt,
  waitForTerminalRun,
} from "./runtime-inference-critical-flow.ts";

const VALID_WIRE_MODEL = "claude-haiku-4-5-20251001";
const VALID_KEY = "vf-runtime-critical-flow-key";

function anthropicRequest(overrides: {
  method?: string;
  path?: string;
  key?: string;
  body?: unknown;
} = {}): Request {
  return new Request(`http://127.0.0.1${overrides.path ?? "/v1/messages"}`, {
    method: overrides.method ?? "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": overrides.key ?? VALID_KEY,
    },
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
): Promise<void> {
  const error = await assertRejects(fn, Error);
  assertStringIncludes((error as Error).message, expected);
}

describe("runtime inference critical-flow pure contract", () => {
  it("selects all runtimes by default in stable order", () => {
    assertEquals(parseRuntimeSelection([]), ["node", "bun", "deno"]);
  });

  it("selects explicit runtimes from inline or separate flags", () => {
    assertEquals(parseRuntimeSelection(["--runtime=node"]), ["node"]);
    assertEquals(parseRuntimeSelection(["--runtime", "bun"]), ["bun"]);
    assertEquals(parseRuntimeSelection(["--runtimes=deno,node"]), [
      "deno",
      "node",
    ]);
  });

  it("rejects missing, unknown, and duplicate runtime selections", () => {
    assertThrows(
      () => parseRuntimeSelection(["--runtime"]),
      Error,
      "--runtime requires a comma-separated value",
    );
    assertThrows(
      () => parseRuntimeSelection(["--runtime=python"]),
      Error,
      "Unknown runtime: python",
    );
    assertThrows(
      () => parseRuntimeSelection(["--runtime=node,node"]),
      Error,
      "Duplicate runtime: node",
    );
  });

  it("states honest runtime artifact claims", () => {
    assertStringIncludes(artifactClaim("node"), "packed npm consumer");
    assertStringIncludes(artifactClaim("bun"), "packed package consumer");
    assertStringIncludes(artifactClaim("deno"), "packed CLI");
    assertEquals(artifactClaim("deno").includes("npm install"), false);
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
    );
    await assertRejectsWithMessage(
      () =>
        validateAnthropicRequest(
          anthropicRequest({ path: "/wrong" }),
          "contract-marker",
        ),
      "POST /v1/messages",
    );
    await assertRejectsWithMessage(
      () =>
        validateAnthropicRequest(
          anthropicRequest({ key: "wrong" }),
          "contract-marker",
        ),
      "x-api-key",
    );
    await assertRejectsWithMessage(
      () =>
        validateAnthropicRequest(
          new Request("http://127.0.0.1/v1/messages", {
            method: "POST",
            headers: { "x-api-key": VALID_KEY },
            body: "{",
          }),
          "contract-marker",
        ),
      "valid JSON",
    );
    await assertRejectsWithMessage(
      () =>
        validateAnthropicRequest(
          anthropicRequest({ body: { model: "wrong", messages: [] } }),
          "contract-marker",
        ),
      VALID_WIRE_MODEL,
    );
    await assertRejectsWithMessage(
      () =>
        validateAnthropicRequest(
          anthropicRequest({ body: { model: VALID_WIRE_MODEL, messages: [] } }),
          "contract-marker",
        ),
      "contract-marker",
    );
  });

  it("surfaces provider validation failures instead of generic receipt timeouts", async () => {
    const detailCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: URL | RequestInfo) => {
      detailCalls.push(String(input));
      return Promise.resolve(Response.json({ status: "running" }));
    }) as typeof fetch;

    try {
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
              url: new URL("http://127.0.0.1:1/v1"),
            },
            "node",
            new URL("http://127.0.0.1/runs/validation-failed"),
          ),
        `Expected Anthropic model ${VALID_WIRE_MODEL}, got wrong`,
      );
      assertEquals(detailCalls.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces provider validation failures that arrive with terminal detail", async () => {
    const originalFetch = globalThis.fetch;
    let validationFailure: Error | undefined;
    globalThis.fetch = (() => {
      validationFailure = new Error(
        `Expected Anthropic model ${VALID_WIRE_MODEL}, got wrong`,
      );
      return Promise.resolve(Response.json({ status: "failed" }));
    }) as typeof fetch;

    try {
      await assertRejectsWithMessage(
        () =>
          waitForProviderReceipt(
            {
              received: [],
              server: {} as Deno.HttpServer,
              abort() {},
              closed: Promise.resolve(),
              validationFailure: () => validationFailure,
              url: new URL("http://127.0.0.1:1/v1"),
            },
            "node",
            new URL("http://127.0.0.1/runs/terminal-validation-failed"),
          ),
        `Expected Anthropic model ${VALID_WIRE_MODEL}, got wrong`,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
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
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      const body = states[Math.min(calls, states.length - 1)];
      calls += 1;
      return Promise.resolve(Response.json(body));
    }) as typeof fetch;

    try {
      const detail = await waitForTerminalRun(
        new URL("http://127.0.0.1/runs/1"),
        1_000,
      );
      assertEquals(detail.status, "failed");
      assertEquals(calls, 3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects terminal success and preserves last observation on deadline", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({ status: "completed" }),
      )) as typeof fetch;
    try {
      await assertRejectsWithMessage(
        () => waitForTerminalRun(new URL("http://127.0.0.1/runs/ok"), 1_000),
        "unexpected terminal status",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({
          status: "running",
          nodeStates: { "call-provider": { status: "running" } },
        }),
      )) as typeof fetch;
    try {
      const error = await assertRejects(
        () => waitForTerminalRun(new URL("http://127.0.0.1/runs/slow"), 40),
        Error,
      );
      assertStringIncludes((error as Error).message, "timed out");
      assertStringIncludes((error as Error).message, "running");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("aborts each poll fetch independently", async () => {
    const originalFetch = globalThis.fetch;
    const observed: AbortSignal[] = [];
    globalThis.fetch = ((_input: URL | RequestInfo, init?: RequestInit) => {
      assert(init?.signal instanceof AbortSignal);
      observed.push(init.signal);
      return Promise.resolve(Response.json({ status: "failed" }));
    }) as typeof fetch;

    try {
      await waitForTerminalRun(new URL("http://127.0.0.1/runs/1"), 1_000);
      assertEquals(observed.length, 1);
      assertEquals(observed[0]?.aborted, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not execute the critical-flow journey on import", async () => {
    const controller = new AbortController();
    const timeoutMs = 7_500;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let result: Deno.CommandOutput;

    try {
      result = await new Deno.Command(Deno.execPath(), {
        args: [
          "eval",
          "--config=scripts/test.deno.json",
          "--no-check",
          `const mod = await import("./scripts/test/runtime-inference-critical-flow.ts");
console.log(JSON.stringify(Object.keys(mod).sort()));`,
        ],
        signal: controller.signal,
        stdout: "piped",
        stderr: "piped",
      }).output();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `runtime inference import subprocess timed out after ${timeoutMs}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    assertEquals(new TextDecoder().decode(result.stderr), "");
    assertEquals(result.code, 0);
    const exports = JSON.parse(new TextDecoder().decode(result.stdout));
    assert(exports.includes("parseRuntimeSelection"));
    assert(exports.includes("runRuntimeInferenceCriticalFlow"));
  });
});
