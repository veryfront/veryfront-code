import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  getHostedChildTaskInputResolver,
  type HostedChildTaskInputResolver,
  withHostedChildTaskInputResolver,
} from "./accepted-child-input-scope.ts";

const request: Parameters<HostedChildTaskInputResolver>[0] = {
  projectId: "project",
  parentRunId: "parent",
  targetAgentId: "child",
  toolCallId: "call",
  evidence: {
    readParentToolResults: () => Promise.resolve([]),
    readCommittedVersion: () => Promise.reject(new Error("Unexpected version read")),
  },
};

it("revokes a captured accepted-input resolver when the parent scope exits", async () => {
  let calls = 0;
  const retained = await withHostedChildTaskInputResolver(async function (this: unknown) {
    assertEquals(this, undefined);
    calls++;
    return undefined;
  }, async () => {
    const resolver = getHostedChildTaskInputResolver()!;
    await resolver(request);
    await withHostedChildTaskInputResolver(undefined, async () => {
      assertEquals(getHostedChildTaskInputResolver(), undefined);
    });
    return resolver;
  });
  await assertRejects(() => retained(request), Error, "no longer active");
  assertEquals(calls, 1);
});

it("rejects an accepted-input resolution that finishes after parent revocation", async () => {
  const pending = Promise.withResolvers<void>();
  let resolution: ReturnType<HostedChildTaskInputResolver> | undefined;
  await withHostedChildTaskInputResolver(async () => {
    await pending.promise;
    return undefined;
  }, async () => {
    resolution = getHostedChildTaskInputResolver()!(request);
    resolution.catch(() => {});
  });
  pending.resolve();
  await assertRejects(() => resolution!, Error, "no longer active");
});

it("retains the resolver until a streamed response finishes", async () => {
  const gate = Promise.withResolvers<void>();
  let captured: HostedChildTaskInputResolver | undefined;
  const response = await withHostedChildTaskInputResolver(async () => undefined, async () => {
    captured = getHostedChildTaskInputResolver();
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          await gate.promise;
          try {
            const resolver = getHostedChildTaskInputResolver();
            assertEquals(typeof resolver, "function");
            await resolver!(request);
            controller.enqueue(new TextEncoder().encode("done"));
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      }),
    );
  });
  assertEquals(getHostedChildTaskInputResolver(), undefined);
  gate.resolve();
  assertEquals(await response.text(), "done");
  await assertRejects(() => captured!(request), Error, "no longer active");
});

it("revokes streaming resolver authority on cancellation and propagates cancellation", async () => {
  let captured: HostedChildTaskInputResolver | undefined;
  let cancelled: unknown;
  const response = await withHostedChildTaskInputResolver(async () => undefined, async () => {
    captured = getHostedChildTaskInputResolver();
    return new Response(
      new ReadableStream<Uint8Array>({
        cancel(reason) {
          cancelled = reason;
        },
      }),
      { status: 202, headers: { "X-Stream": "preserved" } },
    );
  });
  assertEquals(response.status, 202);
  assertEquals(response.headers.get("X-Stream"), "preserved");
  await captured!(request);
  await response.body!.cancel("client left");
  assertEquals(cancelled, "client left");
  await assertRejects(() => captured!(request), Error, "no longer active");
});

it("revokes streaming resolver authority when the source fails", async () => {
  let captured: HostedChildTaskInputResolver | undefined;
  const gate = Promise.withResolvers<void>();
  const response = await withHostedChildTaskInputResolver(async () => undefined, async () => {
    captured = getHostedChildTaskInputResolver();
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          await gate.promise;
          controller.error(new Error("source failed"));
        },
      }),
    );
  });
  gate.resolve();
  await assertRejects(() => response.text(), Error, "source failed");
  await assertRejects(() => captured!(request), Error, "no longer active");
});

it("revokes resolver authority for bodyless responses and failed operations", async () => {
  let captured: HostedChildTaskInputResolver | undefined;
  const response = await withHostedChildTaskInputResolver(async () => undefined, async () => {
    captured = getHostedChildTaskInputResolver();
    return new Response(null, { status: 204 });
  });
  assertEquals(response.status, 204);
  await assertRejects(() => captured!(request), Error, "no longer active");
  await assertRejects(
    () =>
      withHostedChildTaskInputResolver(async () => undefined, async () => {
        captured = getHostedChildTaskInputResolver();
        throw new Error("operation failed");
      }),
    Error,
    "operation failed",
  );
  await assertRejects(() => captured!(request), Error, "no longer active");
});

for (const streaming of [false, true]) {
  it(`revokes retained evidence readers after ${streaming ? "stream EOF" : "parent return"}`, async () => {
    let reads = 0;
    let evidence: Parameters<HostedChildTaskInputResolver>[0]["evidence"] | undefined;
    const input = {
      ...request,
      evidence: {
        readParentToolResults: () => {
          reads++;
          return Promise.resolve([]);
        },
        readCommittedVersion: () => {
          reads++;
          return Promise.resolve({ path: "note", versionId: "version", content: "private" });
        },
      },
    };
    const response = await withHostedChildTaskInputResolver(async (input) => {
      evidence = input.evidence;
      await evidence.readParentToolResults();
      await evidence.readCommittedVersion("note", "version");
      return undefined;
    }, async () => {
      await getHostedChildTaskInputResolver()!(input);
      return streaming ? new Response("done") : undefined;
    });
    if (response) await response.text();
    await assertRejects(() => evidence!.readParentToolResults(), Error, "no longer active");
    await assertRejects(
      () => evidence!.readCommittedVersion("note", "version"),
      Error,
      "no longer active",
    );
    assertEquals(reads, 2);
  });
}

for (const reader of ["parent", "version"] as const) {
  it(`rejects an in-flight ${reader} evidence read after parent revocation`, async () => {
    const gate = Promise.withResolvers<void>();
    let pending: Promise<unknown> | undefined;
    await withHostedChildTaskInputResolver(async (input) => {
      pending = reader === "parent"
        ? input.evidence.readParentToolResults()
        : input.evidence.readCommittedVersion("note", "version");
      pending.catch(() => {});
      return undefined;
    }, async () => {
      await getHostedChildTaskInputResolver()!({
        ...request,
        evidence: {
          readParentToolResults: async () => {
            await gate.promise;
            return [];
          },
          readCommittedVersion: async () => {
            await gate.promise;
            return { path: "note", versionId: "version", content: "private" };
          },
        },
      });
    });
    gate.resolve();
    await assertRejects(() => pending!, Error, "no longer active");
  });
}
