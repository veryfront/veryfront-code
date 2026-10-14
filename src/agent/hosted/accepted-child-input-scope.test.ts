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
