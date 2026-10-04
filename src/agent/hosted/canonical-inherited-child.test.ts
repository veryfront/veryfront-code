import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  hostedInheritedRunAdmitter,
  hostedTerminalRunFinalizer,
  registerHostedTerminalCredential,
} from "./terminal-credential.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
const parentId = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";
const token = (runId: string, canonicalRunId: string) =>
  `header.${
    btoa(
      JSON.stringify({
        runId,
        canonicalRunId,
        tokenUse: "run_event_writer",
        writerPurpose: "current_run_terminal",
        dispatchNonce: "generation",
      }),
    )
  }.signature`;
it("admits one inherited child with the parent's capability and binds exact-child terminal authority privately", async () => {
  const request = {
    projectId: parentId,
    authToken: "parent-invocation",
    durableRootRun: { runId: "parent" },
  } as ParsedHostedChatRequest;
  registerHostedTerminalCredential(request, token("parent", parentId));
  const calls: Request[] = [];
  const admit = hostedInheritedRunAdmitter(request, {
    apiUrl: "https://api.example.test",
    fetch: (input, init) => {
      calls.push(new Request(input, init));
      return Promise.resolve(
        calls.length === 1
          ? Response.json({
            id: childId,
            conversation_id: parentId,
            output_message_id: childId,
            status: "running",
          }, {
            headers: {
              "Cache-Control": "no-store",
              "X-Veryfront-Run-Invocation-Token": "child-invocation",
              "X-Veryfront-Run-Terminal-Token": token("child", childId),
              "X-Veryfront-Run-Renewal-Token": "child-renewal",
              "X-Veryfront-Run-Event-Token": "child-event",
              "X-Veryfront-Run-Event-Sequence": "7",
              "X-Veryfront-Run-External-Event-Sequence": "3",
            },
          })
          : Response.json({ id: childId, status: "completed" }),
      );
    },
  })!;
  const run = await admit("tool-one", "raw prompt")({
    authToken: "ignored",
    apiUrl: "https://wrong.example.test",
    conversationId: parentId,
    parentRunId: "parent",
    agentId: "agent",
    projectId: parentId,
  });
  assertEquals(run.latestEventId, 7);
  assertEquals(run.latestExternalEventSequence, 3);
  assertEquals(calls[0]!.headers.get("X-Veryfront-Run-Execution-Mode"), "inherited");
  assertEquals((await calls[0]!.json()).target, { type: "agent", id: "agent" });
  assertEquals(JSON.stringify(run).includes("child-invocation"), false);
  await hostedTerminalRunFinalizer(run)!({
    authToken: "ignored",
    apiUrl: "https://wrong.example.test",
    conversationId: parentId,
    runId: "child",
    status: "completed",
    output: "result",
    model: "model",
    provider: "provider",
  });
  assertEquals(calls[1]!.url, `https://api.example.test/runs/${childId}/finalize`);
  assertEquals(calls[1]!.headers.get("Authorization"), "Bearer child-invocation");
  assertEquals(calls[1]!.headers.get("X-Veryfront-Run-Terminal-Token"), token("child", childId));
});

import { assertRejects } from "#veryfront/testing/assert.ts";
import { withHostedInheritedLease } from "./terminal-credential.ts";
for (
  const mode of [
    "fenced",
    "hung",
    "expired",
    "parent-before",
    "parent-during",
    "retry-expired",
  ] as const
) {
  const hangs = mode === "hung";
  it(`aborts local work when renewal ${mode}`, async () => {
    using time = new FakeTime();
    const request = {
      projectId: parentId,
      authToken: "parent-invocation",
      durableRootRun: { runId: "parent" },
    } as ParsedHostedChatRequest;
    registerHostedTerminalCredential(request, token("parent", parentId));
    let calls = 0;
    let aborted = false;
    const admit = hostedInheritedRunAdmitter(request, {
      apiUrl: "https://api.example.test",
      fetch: (input, init) => {
        calls++;
        if (calls === 1) {
          return Promise.resolve(
            Response.json({
              id: childId,
              conversation_id: parentId,
              output_message_id: childId,
              status: "running",
            }, {
              headers: {
                "Cache-Control": "no-store",
                "X-Veryfront-Run-Invocation-Token": "child-invocation",
                "X-Veryfront-Run-Terminal-Token": token("child", childId),
                "X-Veryfront-Run-Event-Token": "child-event",
                "X-Veryfront-Run-Renewal-Token": "child-renewal",
                "X-Veryfront-Run-Event-Sequence": "0",
                "X-Veryfront-Run-External-Event-Sequence": "0",
                "X-Veryfront-Run-Lease-Expires-At": new Date(
                  Date.now() + (mode === "expired" ? -1000 : 20),
                ).toISOString(),
              },
            }),
          );
        }
        assertEquals(String(input), `https://api.example.test/runs/${childId}/heartbeats`);
        assertEquals(new Headers(init?.headers).get("Authorization"), "Bearer child-renewal");
        if (hangs) return new Promise<Response>(() => {});
        if (mode === "retry-expired") return Promise.resolve(Response.json({}, { status: 503 }));
        return Promise.resolve(Response.json({ detail: "generation fenced" }, { status: 403 }));
      },
    })!;
    const run = await admit("tool-lease", "prompt")({
      authToken: "ignored",
      apiUrl: "ignored",
      conversationId: parentId,
      parentRunId: "parent",
      agentId: "agent",
      projectId: parentId,
    });
    const parentController = new AbortController();
    const parentCancellation = new Error("Parent execution cancelled");
    if (mode === "parent-before") parentController.abort(parentCancellation);
    const cancelTimer = mode === "parent-during"
      ? setTimeout(() => parentController.abort(parentCancellation), 1)
      : undefined;
    const rejected = assertRejects(
      () =>
        withHostedInheritedLease(
          run,
          (signal) =>
            new Promise<void>((resolve) =>
              signal!.addEventListener("abort", () => {
                aborted = true;
                resolve();
              }, { once: true })
            ),
          parentController.signal,
        ),
      Error,
      mode.startsWith("parent-")
        ? "Parent execution cancelled"
        : mode === "expired" || mode === "retry-expired" || hangs
        ? "lease expired"
        : "lease renewal failed",
    );
    await time.tickAsync(mode === "fenced" ? 10 : 20);
    await rejected;
    clearTimeout(cancelTimer);
    assertEquals(aborted, mode !== "expired" && mode !== "parent-before");
    if (mode === "retry-expired") assertEquals(calls > 1, true);
    else assertEquals(calls, mode === "expired" || mode.startsWith("parent-") ? 1 : 2);
  });
}

for (const failure of ["network", 503, 429] as const) {
  it(`retries transient renewal ${failure} while the current lease remains valid`, async () => {
    const request = {
      projectId: parentId,
      authToken: "parent-invocation",
      durableRootRun: { runId: "parent" },
    } as ParsedHostedChatRequest;
    registerHostedTerminalCredential(request, token("parent", parentId));
    let renewals = 0;
    const completed = Promise.withResolvers<string>();
    const admit = hostedInheritedRunAdmitter(request, {
      apiUrl: "https://api.example.test",
      fetch: (input) => {
        if (String(input).endsWith("/heartbeats")) {
          renewals++;
          if (renewals === 1) {
            if (failure === "network") {
              return Promise.reject(new TypeError("temporary transport failure"));
            }
            return Promise.resolve(Response.json({}, { status: failure }));
          }
          setTimeout(() => completed.resolve("completed"), 1);
          return Promise.resolve(
            Response.json({
              run_id: childId,
              expires_at: new Date(Date.now() + 1000).toISOString(),
            }),
          );
        }
        return Promise.resolve(
          Response.json({
            id: childId,
            conversation_id: parentId,
            output_message_id: childId,
            status: "running",
          }, {
            headers: {
              "Cache-Control": "no-store",
              "X-Veryfront-Run-Invocation-Token": "child-invocation",
              "X-Veryfront-Run-Terminal-Token": token("child", childId),
              "X-Veryfront-Run-Event-Token": "child-event",
              "X-Veryfront-Run-Renewal-Token": "child-renewal",
              "X-Veryfront-Run-Event-Sequence": "0",
              "X-Veryfront-Run-External-Event-Sequence": "0",
              "X-Veryfront-Run-Lease-Expires-At": new Date(Date.now() + 200).toISOString(),
            },
          }),
        );
      },
    })!;
    const run = await admit("retry-tool", "prompt")({
      authToken: "ignored",
      apiUrl: "ignored",
      parentRunId: "parent",
      agentId: "agent",
      projectId: parentId,
    });
    const result = await withHostedInheritedLease(run, (signal) => {
      signal!.addEventListener(
        "abort",
        () => completed.reject(new Error("aborted before completion")),
        { once: true },
      );
      return completed.promise;
    });
    assertEquals(result, "completed");
    assertEquals(renewals, 2);
  });
}

it("keeps local work running across transient renewal failures while the lease is valid", async () => {
  const request = {
    projectId: parentId,
    authToken: "parent-invocation",
    durableRootRun: { runId: "parent" },
  } as ParsedHostedChatRequest;
  registerHostedTerminalCredential(request, token("parent", parentId));
  const heartbeatOutcomes: string[] = [];
  let renewed!: () => void;
  const renewedOnce = new Promise<void>((resolve) => {
    renewed = resolve;
  });
  let calls = 0;
  const admit = hostedInheritedRunAdmitter(request, {
    apiUrl: "https://api.example.test",
    fetch: () => {
      calls++;
      if (calls === 1) {
        return Promise.resolve(
          Response.json({
            id: childId,
            conversation_id: parentId,
            output_message_id: childId,
            status: "running",
          }, {
            headers: {
              "Cache-Control": "no-store",
              "X-Veryfront-Run-Invocation-Token": "child-invocation",
              "X-Veryfront-Run-Terminal-Token": token("child", childId),
              "X-Veryfront-Run-Event-Token": "child-event",
              "X-Veryfront-Run-Renewal-Token": "child-renewal",
              "X-Veryfront-Run-Event-Sequence": "0",
              "X-Veryfront-Run-External-Event-Sequence": "0",
              "X-Veryfront-Run-Lease-Expires-At": new Date(Date.now() + 400).toISOString(),
            },
          }),
        );
      }
      if (calls === 2) {
        heartbeatOutcomes.push("network");
        return Promise.reject(new TypeError("network connection lost"));
      }
      if (calls === 3) {
        heartbeatOutcomes.push("503");
        return Promise.resolve(Response.json({ detail: "unavailable" }, { status: 503 }));
      }
      heartbeatOutcomes.push("renewed");
      renewed();
      return Promise.resolve(
        Response.json({
          run_id: childId,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      );
    },
  })!;
  const run = await admit("tool-lease-transient", "prompt")({
    authToken: "ignored",
    apiUrl: "ignored",
    conversationId: parentId,
    parentRunId: "parent",
    agentId: "agent",
    projectId: parentId,
  });
  let abortedBeforeRenewal: boolean | undefined;

  const result = await withHostedInheritedLease(run, async (signal) => {
    await renewedOnce;
    abortedBeforeRenewal = signal!.aborted;
    return "completed";
  });

  assertEquals(result, "completed");
  assertEquals(heartbeatOutcomes, ["network", "503", "renewed"]);
  assertEquals(abortedBeforeRenewal, false);
});
