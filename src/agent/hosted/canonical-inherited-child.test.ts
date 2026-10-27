import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  type AgentModelRuntimeResolver,
  revokeModelRuntimeResolver,
} from "../runtime/model-transport.ts";
import { startHostedChildForkRuntimeWithHostTools } from "./child-fork-runtime-start.ts";
import { FakeTime } from "#std/testing/time";
import {
  hostedBoundRunStatus,
  hostedInheritedEventWriter,
  hostedInheritedInferenceModelResolver,
  hostedInheritedInvocationCredentialReader,
  hostedInheritedRunAdmitter,
  hostedTerminalRunFinalizer,
  registerHostedTerminalCredential,
  transferHostedTerminalAuthority,
} from "./terminal-credential.ts";
import { createHostedConversationRunChunkMirrorFromCapability } from "./child-run-event-writer-token.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
const parentId = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";
const token = (runId: string, canonicalRunId: string, signature = "signature") =>
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
  }.${signature}`;
const renewedAuthorityHeaders = (generation: string) => ({
  "Cache-Control": "no-store",
  "X-Veryfront-Run-Credential-Rotation": "v2",
  "X-Veryfront-Inference-Token": `child-inference-${generation}`,
  "X-Veryfront-Run-Invocation-Token": `child-invocation-${generation}`,
  "X-Veryfront-Run-Terminal-Token": token("child", childId, generation),
  "X-Veryfront-Run-Renewal-Token": `child-renewal-${generation}`,
  "X-Veryfront-Run-Event-Token": `child-event-${generation}`,
});
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
              "X-Veryfront-Inference-Token": "child-inference",
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
  assertExists(calls[0]);
  assertEquals(calls[0].headers.get("Accept"), "application/vnd.veryfront.inherited-run+json");
  const resolverFactory = hostedInheritedInferenceModelResolver;
  assertEquals(typeof resolverFactory, "function");
  const resolver = resolverFactory(run)!;
  assertEquals(typeof resolver, "function");
  assertEquals(resolver("openai/gpt-5.5"), undefined);
  assertEquals(resolver("veryfront-cloud/openai/gpt-5.5")!.modelId, "gpt-5.5");
  assertEquals(resolverFactory({ runId: run.runId }), undefined);
  assertEquals(JSON.stringify(run).includes("child-inference"), false);
  const identifiers = {
    childRunId: run.runId,
    childCanonicalRunId: run.canonicalRunId!,
    childConversationId: run.conversationId,
    childMessageId: run.messageId,
    latestEventId: run.latestEventId,
    latestExternalEventSequence: run.latestExternalEventSequence,
  };
  transferHostedTerminalAuthority(run, identifiers);
  let childSteps = 0;
  let previousResolver: AgentModelRuntimeResolver | undefined;
  const started = startHostedChildForkRuntimeWithHostTools({
    apiUrl: "https://wrong.example.test",
    authToken: "parent-invocation",
    projectId: parentId,
    provider: "openai",
    forkModel: "veryfront-cloud/openai/gpt-5.5",
    prompt: "child prompt",
    maxSteps: 1,
    maxContinuationSteps: 1,
    onBeforeStop: ({ stepIndex }) => stepIndex === 0 ? "Continue child execution" : null,
    forkTools: {},
    buildInstructions: () => "Reply briefly",
    durableChildRun: identifiers,
    monitorChildRunStatus: async () => {},
    runStep: async (input) => {
      assertEquals(typeof input.resolveModelRuntime, "function");
      assertEquals(input.resolveModelRuntime!(input.model)!.modelId, "gpt-5.5");
      assertEquals(input.resolveModelRuntime === previousResolver, false);
      previousResolver = input.resolveModelRuntime;
      revokeModelRuntimeResolver(input.resolveModelRuntime);
      childSteps++;
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        responsePromise: Promise.resolve({
          text: "result",
          messages: [],
          toolCalls: [],
          status: "completed",
          metadata: { finishReason: "stop" },
        }),
      };
    },
  });
  for await (const _part of started.streamResult.fullStream) { /* Drain the child execution. */ }
  assertEquals(childSteps, 2);
  assertEquals(run.latestEventId, 7);
  assertEquals(run.latestExternalEventSequence, 3);
  assertEquals(calls[0]!.headers.get("X-Veryfront-Run-Execution-Mode"), "inherited");
  const admission = await calls[0]!.json();
  assertEquals(admission.target, { type: "agent", id: "agent" });
  assertEquals(admission.input, { text: "raw prompt" });
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
        assert(init && "headers" in init, "fetch must receive request options");
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
                "X-Veryfront-Inference-Token": "child-inference",
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
        assertEquals(
          new Headers(init && "headers" in init ? init.headers : undefined).get("Authorization"),
          "Bearer child-renewal",
        );
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
    const rejection = assertRejects(
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
    await time.tickAsync(mode === "parent-during" ? 1 : 10);
    await time.tickAsync(0);
    if (hangs || mode === "retry-expired") await time.tickAsync(10);
    await rejection;
    clearTimeout(cancelTimer);
    assertEquals(aborted, mode !== "expired" && mode !== "parent-before");
    if (mode === "retry-expired") assertEquals(calls > 1, true);
    else assertEquals(calls, mode === "expired" || mode.startsWith("parent-") ? 1 : 2);
  });
}

for (const failure of ["network", 503, 429] as const) {
  it(`retries transient renewal ${failure} while the current lease remains valid`, async () => {
    using time = new FakeTime();
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
            }, { headers: renewedAuthorityHeaders("retry") }),
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
              "X-Veryfront-Inference-Token": "child-inference",
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
    const result = withHostedInheritedLease(run, (signal) => {
      signal!.addEventListener(
        "abort",
        () => completed.reject(new Error("aborted before completion")),
        { once: true },
      );
      return completed.promise;
    });
    await time.tickAsync(100);
    await time.tickAsync(50);
    await time.tickAsync(1);
    assertEquals(await result, "completed");
    assertEquals(renewals, 2);
  });
}

it("keeps local work running across transient renewal failures while the lease is valid", async () => {
  using time = new FakeTime();
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
              "X-Veryfront-Inference-Token": "child-inference",
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
        }, { headers: renewedAuthorityHeaders("transient") }),
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

  const result = withHostedInheritedLease(run, async (signal) => {
    await renewedOnce;
    abortedBeforeRenewal = signal!.aborted;
    return "completed";
  });

  await time.tickAsync(200);
  await time.tickAsync(100);
  await time.tickAsync(50);
  assertEquals(await result, "completed");
  assertEquals(heartbeatOutcomes, ["network", "503", "renewed"]);
  assertEquals(abortedBeforeRenewal, false);
});

for (
  const eventPadding of ["", "x".repeat(20 * 1024), "x".repeat(32 * 1024 - "child-event-2".length)]
) {
  it(`rotates full exact-child authority with ${eventPadding.length} event padding bytes`, async () => {
    using time = new FakeTime();
    const request = {
      projectId: parentId,
      authToken: "parent-invocation",
      durableRootRun: { runId: "parent" },
    } as ParsedHostedChatRequest;
    registerHostedTerminalCredential(request, token("parent", parentId));
    const heartbeatAuthorization: string[] = [];
    const eventAuthorization: string[] = [];
    let heartbeatCount = 0;
    const twiceRenewed = Promise.withResolvers<void>();
    const admit = hostedInheritedRunAdmitter(request, {
      apiUrl: "https://api.example.test",
      fetch: (input, init) => {
        const url = String(input);
        const authorization = new Headers(init?.headers).get("Authorization") ?? "";
        if (url.endsWith("/heartbeats")) {
          assertEquals(
            new Headers(init?.headers).get("X-Veryfront-Run-Credential-Rotation"),
            "v2",
          );
          heartbeatAuthorization.push(authorization);
          heartbeatCount++;
          if (heartbeatCount === 2) twiceRenewed.resolve();
          return Promise.resolve(Response.json({
            run_id: childId,
            expires_at: new Date(Date.now() + 120).toISOString(),
          }, {
            headers: {
              ...renewedAuthorityHeaders(String(heartbeatCount)),
              "X-Veryfront-Run-Event-Token": `child-event-${heartbeatCount}${eventPadding}`,
            },
          }));
        }
        if (url.endsWith("/events")) {
          eventAuthorization.push(authorization);
          return Promise.resolve(Response.json({
            run_id: childId,
            latest_event_id: 1,
            latest_external_event_sequence: 1,
            appended_count: 1,
          }));
        }
        if (url.endsWith(`/runs/${childId}`)) {
          eventAuthorization.push(authorization);
          return Promise.resolve(Response.json({ id: childId, status: "running" }));
        }
        return Promise.resolve(Response.json({
          id: childId,
          conversation_id: parentId,
          output_message_id: childId,
          status: "running",
        }, {
          headers: {
            "Cache-Control": "no-store",
            "X-Veryfront-Inference-Token": "child-inference",
            "X-Veryfront-Run-Invocation-Token": "child-invocation",
            "X-Veryfront-Run-Terminal-Token": token("child", childId),
            "X-Veryfront-Run-Event-Token": "child-event",
            "X-Veryfront-Run-Renewal-Token": "child-renewal",
            "X-Veryfront-Run-Event-Sequence": "0",
            "X-Veryfront-Run-External-Event-Sequence": "0",
            "X-Veryfront-Run-Lease-Expires-At": new Date(Date.now() + 80).toISOString(),
          },
        }));
      },
    })!;
    const run = await admit("tool-rotate", "prompt")({
      authToken: "ignored",
      apiUrl: "ignored",
      conversationId: parentId,
      parentRunId: "parent",
      agentId: "agent",
      projectId: parentId,
    });
    const writer = hostedInheritedEventWriter(run)!;
    const mirror = createHostedConversationRunChunkMirrorFromCapability(writer, {
      expectedRunId: run.runId,
      conversationId: run.conversationId,
      latestEventId: 0,
      latestExternalEventSequence: 0,
    })!;
    const getInvocation = hostedInheritedInvocationCredentialReader(run)!;
    assertEquals(getInvocation(), "child-invocation");
    const result = withHostedInheritedLease(run, async () => {
      await twiceRenewed.promise;
      await mirror.appendEvents([{ type: "TEXT_MESSAGE_CONTENT", delta: "late" }]);
      await mirror.flush();
      await hostedBoundRunStatus(run, run.runId)!();
      return "completed";
    });

    await time.tickAsync(40);
    await time.tickAsync(60);
    assertEquals(await result, "completed");
    assertEquals(getInvocation(), "child-invocation-2");
    assertEquals(heartbeatAuthorization, ["Bearer child-renewal", "Bearer child-renewal-1"]);
    assertEquals(eventAuthorization, [
      `Bearer child-event-2${eventPadding}`,
      "Bearer child-invocation-2",
    ]);
  });
}

it("keeps current authority when a legacy heartbeat does not acknowledge credential rotation", async () => {
  using time = new FakeTime();
  const request = {
    projectId: parentId,
    authToken: "parent-invocation",
    durableRootRun: { runId: "parent" },
  } as ParsedHostedChatRequest;
  registerHostedTerminalCredential(request, token("parent", parentId));
  const heartbeatSeen = Promise.withResolvers<void>();
  const statusAuthorization: string[] = [];
  const admit = hostedInheritedRunAdmitter(request, {
    apiUrl: "https://api.example.test",
    fetch: (input, init) => {
      const url = String(input);
      if (url.endsWith("/heartbeats")) {
        assertEquals(
          new Headers(init?.headers).get("X-Veryfront-Run-Credential-Rotation"),
          "v2",
        );
        heartbeatSeen.resolve();
        return Promise.resolve(Response.json({
          run_id: childId,
          expires_at: new Date(Date.now() + 120).toISOString(),
        }));
      }
      if (url.endsWith(`/runs/${childId}`)) {
        statusAuthorization.push(new Headers(init?.headers).get("Authorization") ?? "");
        return Promise.resolve(Response.json({ id: childId, status: "running" }));
      }
      return Promise.resolve(Response.json({
        id: childId,
        conversation_id: parentId,
        output_message_id: childId,
        status: "running",
      }, {
        headers: {
          "Cache-Control": "no-store",
          "X-Veryfront-Inference-Token": "child-inference",
          "X-Veryfront-Run-Invocation-Token": "child-invocation",
          "X-Veryfront-Run-Terminal-Token": token("child", childId),
          "X-Veryfront-Run-Event-Token": "child-event",
          "X-Veryfront-Run-Renewal-Token": "child-renewal",
          "X-Veryfront-Run-Event-Sequence": "0",
          "X-Veryfront-Run-External-Event-Sequence": "0",
          "X-Veryfront-Run-Lease-Expires-At": new Date(Date.now() + 80).toISOString(),
        },
      }));
    },
  })!;
  const run = await admit("tool-legacy-heartbeat", "prompt")({
    authToken: "ignored",
    apiUrl: "ignored",
    conversationId: parentId,
    parentRunId: "parent",
    agentId: "agent",
    projectId: parentId,
  });
  const result = withHostedInheritedLease(run, async () => {
    await heartbeatSeen.promise;
    await hostedBoundRunStatus(run, run.runId)!();
    return "completed";
  });

  await time.tickAsync(40);
  assertEquals(await result, "completed");
  assertEquals(statusAuthorization, ["Bearer child-invocation"]);
});

for (
  const invalidRotation of [
    "partial-v2",
    "partial-without-ack",
    "unknown-version",
    "oversized-events",
    "oversized-invocation",
  ] as const
) {
  it(`fails closed for ${invalidRotation} heartbeat credential rotation`, async () => {
    using time = new FakeTime();
    const request = {
      projectId: parentId,
      authToken: "parent-invocation",
      durableRootRun: { runId: "parent" },
    } as ParsedHostedChatRequest;
    registerHostedTerminalCredential(request, token("parent", parentId));
    const admit = hostedInheritedRunAdmitter(request, {
      apiUrl: "https://api.example.test",
      fetch: (input) => {
        if (String(input).endsWith("/heartbeats")) {
          return Promise.resolve(Response.json({
            run_id: childId,
            expires_at: new Date(Date.now() + 120).toISOString(),
          }, {
            headers:
              invalidRotation === "oversized-events" || invalidRotation === "oversized-invocation"
                ? {
                  ...renewedAuthorityHeaders("oversized"),
                  [
                    invalidRotation === "oversized-events"
                      ? "X-Veryfront-Run-Event-Token"
                      : "X-Veryfront-Run-Invocation-Token"
                  ]: "x".repeat(invalidRotation === "oversized-events" ? 32769 : 16385),
                }
                : invalidRotation === "partial-v2"
                ? {
                  "Cache-Control": "no-store",
                  "X-Veryfront-Run-Credential-Rotation": "v2",
                  "X-Veryfront-Run-Invocation-Token": "partial",
                }
                : invalidRotation === "partial-without-ack"
                ? { "X-Veryfront-Run-Invocation-Token": "partial" }
                : { "X-Veryfront-Run-Credential-Rotation": "v3" },
          }));
        }
        return Promise.resolve(Response.json({
          id: childId,
          conversation_id: parentId,
          output_message_id: childId,
          status: "running",
        }, {
          headers: {
            "Cache-Control": "no-store",
            "X-Veryfront-Inference-Token": "child-inference",
            "X-Veryfront-Run-Invocation-Token": "child-invocation",
            "X-Veryfront-Run-Terminal-Token": token("child", childId),
            "X-Veryfront-Run-Event-Token": "child-event",
            "X-Veryfront-Run-Renewal-Token": "child-renewal",
            "X-Veryfront-Run-Event-Sequence": "0",
            "X-Veryfront-Run-External-Event-Sequence": "0",
            "X-Veryfront-Run-Lease-Expires-At": new Date(Date.now() + 80).toISOString(),
          },
        }));
      },
    })!;
    const run = await admit(`tool-${invalidRotation}`, "prompt")({
      authToken: "ignored",
      apiUrl: "ignored",
      conversationId: parentId,
      parentRunId: "parent",
      agentId: "agent",
      projectId: parentId,
    });
    const rejected = assertRejects(
      () => withHostedInheritedLease(run, () => new Promise<void>(() => {})),
      Error,
      invalidRotation === "partial-v2" || invalidRotation === "oversized-events" ||
        invalidRotation === "oversized-invocation"
        ? "authority binding mismatch"
        : "acknowledgement mismatch",
    );

    await time.tickAsync(40);
    await rejected;
  });
}

it("persists structured child text even when provider deltas already match it", async () => {
  const { runInheritedLocalAgent } = await import("../composition/inherited-local-agent.ts");
  for (
    const [text, data] of [
      ['{\n  "count": 1\n}', { count: 1 }],
      ['{"count":"1"}', { count: 1, enabled: true }],
    ] as const
  ) {
    const parent = {
      projectId: parentId,
      authToken: "parent-invocation",
      durableRootRun: { runId: "parent" },
    } as ParsedHostedChatRequest;
    registerHostedTerminalCredential(parent, token("parent", parentId));
    let finalBody: Record<string, unknown> | undefined;
    let cursor = 0;
    const transport: typeof fetch = async (input, init) => {
      const req = new Request(input, init);
      if (req.url.endsWith("/finalize")) {
        finalBody = await req.json();
        return Response.json({ id: childId, status: "completed" });
      }
      if (req.url.includes("/events")) {
        const body = await req.json();
        cursor += body.events.length;
        return Response.json({
          run_id: childId,
          appended_count: body.events.length,
          latest_event_id: cursor,
          latest_external_event_sequence: cursor,
        });
      }
      return Response.json({
        id: childId,
        conversation_id: parentId,
        output_message_id: childId,
        status: "running",
      }, {
        headers: {
          "Cache-Control": "no-store",
          "X-Veryfront-Run-Lease-Expires-At": new Date(Date.now() + 60_000).toISOString(),
          "X-Veryfront-Inference-Token": "child-inference",
          "X-Veryfront-Run-Invocation-Token": "child-invocation",
          "X-Veryfront-Run-Terminal-Token": token("child", childId),
          "X-Veryfront-Run-Renewal-Token": "child-renewal",
          "X-Veryfront-Run-Event-Token": "child-event",
          "X-Veryfront-Run-Event-Sequence": "0",
          "X-Veryfront-Run-External-Event-Sequence": "0",
        },
      });
    };
    const admit = hostedInheritedRunAdmitter(parent, {
      apiUrl: "https://api.example.test",
      fetch: transport,
    })!;
    const child = await admit("structured", "prompt")({
      authToken: "",
      apiUrl: "https://api.example.test",
      parentRunId: "parent",
      projectId: parentId,
      agentId: "agent",
    });
    const result = await runInheritedLocalAgent(child, {
      projectId: parentId,
      apiUrl: "https://api.example.test",
      fetch: transport,
    }, async (_signal, onEvent) => {
      await onEvent?.({ type: "text-delta", id: "text", delta: text });
      return {
        success: true,
        output: { text, data, object: data, status: "completed", toolCalls: 0 },
        executionTime: 0,
      };
    });
    assertEquals(result.success, true, result.error);
    assertEquals(finalBody?.final_text, text);
    assertEquals(finalBody?.output, data);
    const replay = await runInheritedLocalAgent(
      {
        terminalReceipt: {
          status: "completed",
          outputFormat: "text-data-v1",
          output: { text: finalBody?.final_text, data: finalBody?.output },
        },
      },
      { projectId: parentId, apiUrl: "https://api.example.test", fetch: transport },
      () => {
        throw new Error("Stored replay must not execute the child");
      },
    );
    assertEquals(replay.output, { text, data, object: data, status: "completed" });
  }
});
