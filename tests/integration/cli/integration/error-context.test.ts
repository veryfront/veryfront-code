import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { cliErrorBoundary, VeryfrontError } from "veryfront/errors";
import { IntegrationApiError } from "veryfront/integrations";
import { classifyCliError, safeJsonErrorContext } from "../../../../cli/router.ts";
import { createErrorEnvelope, outputJson } from "../../../../cli/shared/json-output.ts";

async function emittedContext(error: VeryfrontError): Promise<unknown> {
  const lines: string[] = [];
  const log = console.log;
  const exit = Deno.exit;
  console.log = (value) => lines.push(String(value));
  class Exit extends Error {}
  Object.defineProperty(Deno, "exit", {
    configurable: true,
    value: () => {
      throw new Exit();
    },
  });
  try {
    const result = await assertRejects(() =>
      cliErrorBoundary(() => Promise.reject(error), {
        onError: async (_raw, typed) => {
          const classification = classifyCliError(typed);
          await outputJson(
            createErrorEnvelope("integration", {
              code: classification.code,
              slug: classification.slug,
              message: typed.message,
              context: safeJsonErrorContext(typed.context, _raw),
            }),
          );
        },
        getExitCode: (_raw, typed) => classifyCliError(typed).exitCode,
      })
    );
    assertInstanceOf(result, Exit);
    assertEquals(lines.length, 1);
    assertEquals(lines[0]!.includes("synthetic-private"), false);
    const envelope = JSON.parse(lines[0]!);
    assertEquals(envelope.error.code, classifyCliError(error).code);
    assertEquals(envelope.error.slug, classifyCliError(error).slug);
    return envelope.error.context;
  } finally {
    console.log = log;
    Object.defineProperty(Deno, "exit", { configurable: true, value: exit });
  }
}

describe("integration JSON safety metadata", () => {
  for (
    const [kind, status, unknown] of [
      ["transport", undefined, false],
      ["transport", undefined, true],
      ["http", 408, true],
      ["http", 409, true],
    ] as const
  ) {
    it(`emits ${kind}/${status}/${unknown} outcome metadata through the CLI boundary`, async () => {
      const problem = status
        ? {
          slug: status === 409 ? "integration-execution-outcome-unknown" : "request-timeout",
          status,
          detail: "synthetic-private",
        }
        : undefined;
      const context = await emittedContext(
        new IntegrationApiError(kind, status, unknown, undefined, problem),
      );
      assertEquals(context, {
        kind,
        outcomeUnknown: unknown,
        automaticReplay: false,
        retryable: false,
        ...(status ? { httpStatus: status, httpProblem: { slug: problem!.slug, status } } : {}),
      });
    });
  }
  it("preserves validated provider condition and retry timing while excluding raw Problem fields", async () => {
    const condition = {
      slug: "rate-limit-exceeded",
      status: 429,
      retryable: true,
      retry_after_seconds: 3,
    };
    const context = await emittedContext(
      new IntegrationApiError("http", 429, false, condition, {
        ...condition,
        private: "synthetic-private",
      }),
    );
    assertEquals(context, {
      kind: "http",
      outcomeUnknown: false,
      automaticReplay: false,
      retryable: false,
      httpStatus: 429,
      httpProblem: { slug: condition.slug, status: 429 },
      condition,
    });
  });
  it("drops unbranded, inherited, accessor and secret fields without invoking getters", () => {
    let reads = 0;
    const base = {
      integrationOperation: true,
      outcomeUnknown: true,
      automaticReplay: false,
      retryable: false,
    };
    assertEquals(
      safeJsonErrorContext({ outcomeUnknown: true, automaticReplay: false, retryable: false }),
      undefined,
    );
    assertEquals(safeJsonErrorContext(Object.create(base)), undefined);
    const hostile = Object.defineProperty({ ...base }, "outcomeUnknown", {
      enumerable: true,
      get() {
        reads++;
        return true;
      },
    });
    assertEquals(safeJsonErrorContext(hostile), undefined);
    const withSecrets = Object.defineProperty(
      {
        ...base,
        secret: "synthetic-private",
        condition: {
          slug: "rate-limit-exceeded",
          status: 429,
          retryable: true,
          retry_after_seconds: -1,
          private: "synthetic-private",
        },
      },
      "unknown",
      {
        enumerable: true,
        get() {
          reads++;
          return "synthetic-private";
        },
      },
    );
    const sanitized = safeJsonErrorContext(withSecrets);
    assertEquals(sanitized, {
      outcomeUnknown: true,
      automaticReplay: false,
      retryable: false,
      condition: { slug: "rate-limit-exceeded", status: 429, retryable: true },
    });
    const nested = Object.defineProperty(
      { slug: "rate-limit-exceeded", status: 429, retryable: true },
      "retry_after_seconds",
      {
        get() {
          reads++;
          return 10;
        },
      },
    );
    assertEquals(
      safeJsonErrorContext({
        ...base,
        condition: nested,
        httpProblem: Object.create({ slug: "private", status: 500 }),
      }),
      {
        outcomeUnknown: true,
        automaticReplay: false,
        retryable: false,
        condition: { slug: "rate-limit-exceeded", status: 429, retryable: true },
      },
    );
    const throwable = Object.defineProperty(new Error("synthetic-private"), "context", {
      get() {
        reads++;
        return base;
      },
    });
    assertEquals(safeJsonErrorContext(undefined, throwable), undefined);
    assertEquals(safeJsonErrorContext(undefined, Object.create({ context: base })), undefined);
    assertEquals(reads, 0);
  });
});

describe("integration usage errors before HTTP", () => {
  it("classifies malformed canonical names as exit2 and emits a usage envelope without dispatch", async () => {
    const { handleIntegrationCommand } = await import(
      "../../../../cli/commands/integration/handler.ts"
    );
    const { withMockFetch } = await import("#veryfront/testing/mock-fetch.ts");
    for (
      const [operation, target] of [
        ["call", "github"],
        ["call", "github__read__extra"],
        ["get", "../github"],
        ["tools", "bad/name"],
        ["connect", "bad name"],
        ["status", "?github"],
        ["connections", "a".repeat(129)],
      ]
    ) {
      let requests = 0;
      const error = await withMockFetch(
        () => {
          requests++;
          throw new Error("unexpected HTTP");
        },
        () =>
          assertRejects(() =>
            handleIntegrationCommand({ _: ["integration", operation!, target!] }, {
              resolveConfig: () =>
                Promise.resolve({
                  apiUrl: "https://api.example.test",
                  apiToken: "synthetic-token",
                  projectSlug: "project",
                }),
              registerSignals: () => () => {},
            })
          ),
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(classifyCliError(error), {
        code: "USAGE_ERROR",
        slug: "invalid-arguments",
        exitCode: 2,
      });
      await emittedContext(error);
      assertEquals(requests, 0);
    }
  });
});
