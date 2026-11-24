import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createManagedAgentBrokerIngress } from "./managed-broker-ingress.ts";

function fixture() {
  const calls: { kind: string; runId?: string; body: string; signed: string | null }[] = [];
  const handlers = Object.fromEntries(
    ["signedStream", "durableStart", "agUi", "cancel", "resume", "capabilities"].map((
      kind,
    ) => [kind, {
      async handle(request: Request, input: { runId?: string }) {
        calls.push({
          kind,
          ...input,
          body: await request.text(),
          signed: request.headers.get("x-veryfront-control-plane-jws"),
        });
        return new Response(kind, { status: 202 });
      },
    }]),
  ) as Parameters<typeof createManagedAgentBrokerIngress>[0]["handlers"];
  let ready = true;
  const ingress = createManagedAgentBrokerIngress({ handlers, readiness: () => ready });
  return {
    ingress,
    handlers,
    calls,
    setReady(value: boolean) {
      ready = value;
    },
  };
}

describe("managed agent production ingress", () => {
  it("dispatches exact operations with the original signed body and run target", async () => {
    const f = fixture();
    for (
      const [method, path, kind, runId] of [
        ["POST", "/api/control-plane/runs/run-1/stream", "signedStream", "run-1"],
        ["POST", "/api/control-plane/runs/run-1/resume", "resume", "run-1"],
        ["DELETE", "/api/control-plane/runs/run-1", "cancel", "run-1"],
        ["POST", "/api/runs/run-1/resume", "resume", "run-1"],
        ["DELETE", "/api/runs/run-1", "cancel", "run-1"],
        ["POST", "/api/runs", "durableStart", undefined],
        ["POST", "/api/ag-ui", "agUi", undefined],
        ["POST", "/api/control-plane/runtime/capabilities", "capabilities", undefined],
      ] as const
    ) {
      const request = new Request("https://runtime.example.test" + path, {
        method,
        body: '{"exact":"body"}',
        headers: { "x-veryfront-control-plane-jws": "signed-envelope" },
      });
      assertEquals((await f.ingress(request))?.status, 202);
      assertEquals(f.calls.at(-1), {
        kind,
        ...(runId ? { runId } : {}),
        body: '{"exact":"body"}',
        signed: "signed-envelope",
      });
    }
  });
  it("keeps health and application routes outside managed execution", async () => {
    const f = fixture();
    for (
      const path of [
        "/liveness",
        "/readiness",
        "/api/runs",
        "/api/control-plane/project-route",
        "/",
      ]
    ) {
      assertEquals(await f.ingress(new Request("https://runtime.example.test" + path)), null);
    }
    assertEquals(f.calls, []);
  });
  it("refuses malformed run IDs before invoking an authenticated handler", async () => {
    const f = fixture();
    const response = await f.ingress(
      new Request("https://runtime.example.test/api/control-plane/runs/%ZZ/stream", {
        method: "POST",
      }),
    );
    assertEquals(response?.status, 400);
    assertEquals(f.calls, []);
  });
  it("snapshots handlers and does not advertise capabilities while unavailable", async () => {
    const f = fixture();
    f.handlers.cancel.handle = () => {
      throw new Error("mutated");
    };
    f.setReady(false);
    assertEquals(
      (await f.ingress(
        new Request("https://runtime.example.test/api/control-plane/runtime/capabilities", {
          method: "POST",
        }),
      ))?.status,
      503,
    );
    // Cancellation remains routable while admission/metadata readiness is down.
    assertEquals(
      (await f.ingress(
        new Request("https://runtime.example.test/api/control-plane/runs/run-1", {
          method: "DELETE",
        }),
      ))?.status,
      202,
    );
    assertEquals(f.calls.map((x) => x.kind), ["cancel"]);
  });
  it("refuses incomplete configuration and invalid handler output without falling through", async () => {
    const f = fixture();
    assertThrows(
      () => createManagedAgentBrokerIngress({ handlers: {} as never, readiness: () => true }),
      TypeError,
    );
    f.handlers.signedStream.handle = () => Promise.reject(new Error("execution unavailable"));
    const failure = createManagedAgentBrokerIngress({
      handlers: f.handlers,
      readiness: () => true,
    });
    await assertRejects(
      () =>
        failure(
          new Request("https://runtime.example.test/api/control-plane/runs/run-1/stream", {
            method: "POST",
          }),
        ),
      Error,
      "execution unavailable",
    );
    f.handlers.signedStream.handle = () => undefined as never;
    const invalid = createManagedAgentBrokerIngress({
      handlers: f.handlers,
      readiness: () => true,
    });
    await assertRejects(
      () =>
        invalid(
          new Request("https://runtime.example.test/api/control-plane/runs/run-1/stream", {
            method: "POST",
          }),
        ),
      TypeError,
      "Invalid managed agent response",
    );
  });
  it("retains every distinct cleanup and refuses admission after close failure", async () => {
    const failure = new Error("synthetic managed cleanup failure");
    let firstClosed = 0;
    let secondClosed = 0;
    let handled = 0;
    const first = {
      handle: () => {
        handled++;
        return new Response("accepted");
      },
      close() {
        firstClosed++;
        return Promise.reject(failure);
      },
    };
    const second = {
      handle: first.handle,
      close() {
        secondClosed++;
      },
    };
    const ingress = createManagedAgentBrokerIngress({
      handlers: {
        signedStream: first,
        durableStart: first,
        agUi: second,
        cancel: second,
        resume: second,
      },
      readiness: () => true,
    });
    const closing = ingress.close();
    const response = await ingress(new Request("https://broker.test/api/runs", { method: "POST" }));
    assertEquals(response?.status, 503);
    assertEquals(await ingress.readiness(), false);
    const error = await assertRejects(() => closing, AggregateError);
    if (!(error instanceof AggregateError)) throw error;
    assertEquals(error.errors, [failure]);
    assertEquals(ingress.close() === closing, true);
    assertEquals([firstClosed, secondClosed, handled], [1, 1, 0]);
  });
});
