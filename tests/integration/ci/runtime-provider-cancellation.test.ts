import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  startProvider,
  waitForProviderCancellation,
} from "../../../scripts/test/runtime-inference-critical-flow.ts";
const VALID_WIRE_MODEL = "claude-haiku-4-5-20251001";
const VALID_KEY = "vf-runtime-critical-flow-key";
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

describe("runtime provider cancellation", () => {
  it("observes child client disconnect before pending response headers and excludes cleanup", async () => {
    for (const abortClient of [true, false]) {
      const provider = await startProvider(
        "agent-marker",
        "workflow-marker",
        "black-hole",
      );
      const clientSource = `
        const controller = new AbortController();
        const pending = fetch(Deno.args[0], {
          method: "POST",
          headers: { "x-api-key": "${VALID_KEY}", "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "${VALID_WIRE_MODEL}", messages: [{ role: "user", content: "workflow-marker" }] }),
          signal: controller.signal,
        }).then(async response => ({ status: response.status, body: await response.text() }),
          error => ({ aborted: error.name === "AbortError" }));
        await Deno.stdin.read(new Uint8Array(1));
        if (Deno.args[1] === "abort") controller.abort();
        console.log(JSON.stringify(await pending));
      `;
      const child = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--no-config",
          "--no-lock",
          "--allow-net=127.0.0.1",
          `data:application/javascript,${encodeURIComponent(clientSource)}`,
          new URL("messages", provider.url.href + "/").href,
          abortClient ? "abort" : "hold",
        ],
        clearEnv: true,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(10_000),
      }).spawn();
      const output = child.output();
      const writer = child.stdin.getWriter();
      try {
        const receiptDeadline = Date.now() + 5_000;
        while (!provider.received.includes("workflow-marker")) {
          if (provider.validationFailure()) throw provider.validationFailure();
          assert(
            Date.now() < receiptDeadline,
            "Child request never reached the provider",
          );
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await writer.write(new Uint8Array([1]));
        await writer.close();
        if (abortClient) {
          // Use the actual strict harness deadline, with response headers still pending.
          await waitForProviderCancellation(provider, "deno");
        } else {
          await assertRejects(() => waitForProviderCancellation(provider, "deno"));
          assertEquals(provider.cancellationEvidence(), undefined);
        }
      } finally {
        provider.abort();
        await provider.server.shutdown();
        await provider.closed;
        const result = await output;
        assert(result.success, new TextDecoder().decode(result.stderr));
        const observed = JSON.parse(new TextDecoder().decode(result.stdout));
        if (abortClient) assertEquals(observed.aborted, true);
        else {
          assertEquals(provider.cancellationEvidence(), undefined);
        }
      }
    }
  });
  it("preserves validated JSON/SSE replies and excludes normal completion from cancellation", async () => {
    for (
      const [mode, marker, stream] of [
        ["black-hole", "agent-marker", false],
        ["black-hole", "agent-marker", true],
        ["respond", "workflow-marker", false],
        ["respond", "workflow-marker", true],
      ] as const
    ) {
      const provider = await startProvider(
        "agent-marker",
        "workflow-marker",
        mode,
      );
      try {
        const template = anthropicRequest({
          body: {
            model: VALID_WIRE_MODEL,
            messages: [{ role: "user", content: marker }],
            stream,
          },
        });
        const response = await fetch(
          new URL("messages", provider.url.href + "/"),
          {
            method: template.method,
            headers: template.headers,
            body: await template.text(),
          },
        );
        assertEquals(response.status, 200);
        assertStringIncludes(
          response.headers.get("content-type")!,
          stream ? "text/event-stream" : "application/json",
        );
        assertStringIncludes(await response.text(), marker);
        assertEquals(provider.received, [marker]);
        assertEquals(provider.validationFailure(), undefined);
        assertEquals(provider.cancellationEvidence(), undefined);
      } finally {
        provider.abort();
        await provider.server.shutdown();
        await provider.closed;
      }
      assertEquals(provider.cancellationEvidence(), undefined);
    }
  });

  it("rejects invalid provider authorization before recording receipt or cancellation", async () => {
    const provider = await startProvider(
      "agent-marker",
      "workflow-marker",
      "black-hole",
    );
    try {
      const template = anthropicRequest({ key: "wrong-key" });
      const response = await fetch(
        new URL("messages", provider.url.href + "/"),
        {
          method: template.method,
          headers: template.headers,
          body: await template.text(),
        },
      );
      assertEquals(response.status, 400);
      assertStringIncludes(await response.text(), "expected x-api-key");
      assertEquals(provider.received, []);
      assertStringIncludes(
        provider.validationFailure()!.message,
        "expected x-api-key",
      );
      assertEquals(provider.cancellationEvidence(), undefined);
    } finally {
      provider.abort();
      await provider.server.shutdown();
      await provider.closed;
    }
    assertEquals(provider.cancellationEvidence(), undefined);
  });
});
