// Establish the actual operator boot key before any SDK module captures host env.
const signingKey = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
if (!("publicKey" in signingKey)) throw new Error("Ed25519 did not generate a key pair");
const publicDer = await crypto.subtle.exportKey("spki", signingKey.publicKey);
const publicBase64 = btoa(String.fromCharCode(...new Uint8Array(publicDer)));
const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${
  publicBase64.match(/.{1,64}/g)?.join("\n")
}\n-----END PUBLIC KEY-----`;
Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", publicKeyPem);
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const utf8 = new TextEncoder();
/** Real SDK child for the API loopback HTTP/PostgreSQL crash integration test. */
await import("#veryfront/schemas/_test-setup.ts");
const { defineSchema } = await import("#veryfront/schemas/index.ts");
const {
  getRecoveryAdmissionSchema,
  getRecoveryGenerationSchema,
} = await import("#veryfront/internal-agents/recovery-admission-schema.ts");
const {
  createCtx,
} = await import("#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts");
const { verifyControlPlaneRequest } = await import(
  "#veryfront/internal-agents/control-plane-auth.ts"
);
const {
  bindManagedRecoveryCredentials,
  createManagedRecoveryHttpTransport,
} = await import("#veryfront/internal-agents/managed-recovery-http.ts");
const { RecoverySessionOwner } = await import(
  "#veryfront/internal-agents/recovery-session-owner.ts"
);
const { DurableRunHome } = await import("#veryfront/internal-agents/durable-run-home.ts");
const { parseRecoverySnapshot } = await import("#veryfront/internal-agents/recovery-snapshot.ts");
const {
  materializeAuthenticatedRecoverySuffix,
  readAuthenticatedRecoverySuffix,
} = await import("#veryfront/internal-agents/recovery-suffix.ts");
const { createManagedRecoveryWriter } = await import(
  "#veryfront/internal-agents/managed-recovery-writer.ts"
);
const { createEphemeralAgentWithRuntimeOptions } = await import("#veryfront/agent/factory.ts");
const { scriptedModel } = await import("#veryfront/agent/runtime/model-runtime.test-helpers.ts");
const { tool } = await import("#veryfront/tool");
const { runWithToolCallOccurrences } = await import("#veryfront/runtime/tool-call-occurrence.ts");
const { runWithRecoveryToolExecutionPolicy } = await import(
  "#veryfront/runtime/execution-ownership-guard.ts"
);
const {
  createStreamTransformState,
  mapRuntimeEventToAgUi,
  parseSseJsonEvents,
} = await import("#veryfront/internal-agents/ag-ui-sse.ts");

const input = defineSchema((v) =>
  v.object({
    mode: v.enum(["A", "B"]),
    directory: v.string().min(1),
    loopbackOrigin: v.string().url(),
    admission: getRecoveryAdmissionSchema(),
    retiredGeneration: getRecoveryGenerationSchema().optional(),
    credentials: v.object({
      authToken: v.string().min(1),
      terminalToken: v.string().min(1),
      writerToken: v.string().min(1),
    }).strict(),
  }).strict()
)().parse(JSON.parse(await new Response(Deno.stdin.readable).text()));
const loopback = new URL(input.loopbackOrigin);
if (
  loopback.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(loopback.hostname)
) throw new Error("Fixture requires loopback HTTP");
const body = JSON.stringify({
  managedRecoveryAdmission: input.admission,
  credentials: input.credentials,
});
const now = Math.floor(Date.now() / 1000);
const requestPath = `/api/control-plane/runs/${input.admission.identity.publicRunId}/stream`;
const header = encode(utf8.encode(JSON.stringify({ alg: "EdDSA", typ: "JWT" })));
const payload = encode(utf8.encode(JSON.stringify({
  iss: "veryfront-api",
  aud: "demo-project",
  sub: input.admission.identity.publicRunId,
  surface: "studio",
  project_id: input.admission.identity.projectId,
  request_hash: encode(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8.encode(body)))),
  request_method: "POST",
  request_path: requestPath,
  iat: now,
  exp: Math.max(now + 60, input.admission.expiresAt),
})));
const signingInput = `${header}.${payload}`;
const signature = await crypto.subtle.sign(
  "Ed25519",
  signingKey.privateKey,
  utf8.encode(signingInput),
);
const jws = `${signingInput}.${encode(new Uint8Array(signature))}`;
const ctx = createCtx(publicKeyPem);
ctx.projectId = input.admission.identity.projectId;
const claims = await verifyControlPlaneRequest(
  new Request(
    `https://veryfront.test/api/control-plane/runs/${input.admission.identity.publicRunId}/stream`,
    { method: "POST", headers: { "x-veryfront-control-plane-jws": jws } },
  ),
  ctx,
  body,
);
bindManagedRecoveryCredentials(claims, input.credentials);
const transport = createManagedRecoveryHttpTransport("https://veryfront.test", (url, init) => {
  const target = new URL(url instanceof Request ? url.url : String(url));
  if (target.origin !== "https://veryfront.test") {
    throw new Error("Unexpected fixture transport origin");
  }
  return fetch(new URL(target.pathname + target.search, loopback), init);
});
await Deno.mkdir(input.directory, { recursive: true });
const effectPath = `${input.directory}/actual-effects.jsonl`;
async function effectCount() {
  try {
    return (await Deno.readTextFile(effectPath)).trim().split("\n").filter(Boolean).length;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return 0;
    throw error;
  }
}
const owner = await RecoverySessionOwner.acquire({
  claims,
  directory: `${input.directory}/owner`,
  validateCurrentOwnership: () => transport.readOwnership(claims),
  awaitRetiredPreviousOwner: async (previous) => {
    const retired = input.retiredGeneration;
    if (
      input.mode !== "B" || !retired || previous.workerId !== retired.workerId ||
      previous.dispatchNonce !== retired.dispatchNonce ||
      previous.transportRecoveryAttempt !== retired.transportRecoveryAttempt
    ) {
      throw new Error("Parent has not joined this exact predecessor generation");
    }
  },
});
const home = await DurableRunHome.open({
  directory: `${input.directory}/${input.admission.identity.canonicalRunId}.snapshot`,
  identity: input.admission.identity,
});
let restored;
if (input.mode === "B") {
  const records = await home.read();
  const last = records.at(-1);
  if (!last) throw new Error("Original child did not publish an earlier real snapshot");
  const snapshot = parseRecoverySnapshot(last.value);
  const suffix = await readAuthenticatedRecoverySuffix({
    snapshot,
    claims,
    readPage: (request) => transport.readRecoverySuffixPage(claims, request),
    assertCurrentOwnership: () => owner.assertCurrentOwnership(),
  });
  restored = await owner.validateRestoredSnapshot(
    materializeAuthenticatedRecoverySuffix({ snapshot, suffix }),
  );
  if (restored.runtimeContinuation?.nextStep !== 2) {
    throw new Error("Authenticated suffix did not restore nextStep 2");
  }
}
const model = scriptedModel(
  input.mode === "A"
    ? [{ toolCalls: [{ id: "prepare-call", name: "prepare", input: {} }] }, {
      toolCalls: [{ id: "current-call", name: "inspect", input: {} }],
    }, { text: "Complete" }]
    : [{ text: "Complete" }],
  { only: "stream", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
);
const append = await transport.createEventAppender(claims);
const writer = await createManagedRecoveryWriter({
  claims,
  owner,
  directory: input.directory,
  bindAdmissionWriter: transport.createToolAdmissionBinder(claims),
  ...(restored ? { restoredSnapshot: restored } : {}),
  append: async (event, occurrence, checkpoint) => {
    const receipt = await append(event, occurrence, checkpoint);
    if (
      input.mode === "A" && checkpoint?.snapshot.runtimeContinuation.nextStep === 2 &&
      !checkpoint.snapshot.runtimeContinuation.completed &&
      checkpoint.snapshot.toolBoundaries.some((boundary) =>
        boundary.kind === "acknowledged-receipt" &&
        boundary.admissionReceipt.toolCallId === "current-call"
      )
    ) {
      console.log(
        JSON.stringify({
          phase: "checkpoint-committed",
          checkpoint: receipt.recoveryCheckpoint,
          nextStep: 2,
          effectCount: await effectCount(),
          modelCalls: model.callCount,
        }),
      );
      // The parent asserts the actual committed database facts, then kills this child.
      await new Promise<never>(() => {
        setInterval(() => {}, 1000);
      });
    }
    return receipt;
  },
});
writer.bindSignal(new AbortController().signal);
const runtime = createEphemeralAgentWithRuntimeOptions({
  model: "veryfront-cloud/openai/gpt-5.4",
  system: "Synthetic",
  maxSteps: 3,
  tools: {
    prepare: tool({
      id: "prepare",
      description: "Side-effect-free preparation",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => Promise.resolve({ prepared: true }),
    }),
    inspect: tool({
      id: "inspect",
      description: "Synthetic",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => {
        await Deno.writeTextFile(effectPath, JSON.stringify({ tool: "inspect" }) + "\n", {
          append: true,
          create: true,
        });
        return { ok: true };
      },
    }),
  },
}, {
  resolveModelRuntime: () => model,
  persistRecoveryBoundary: writer.persistBoundary,
  ...(restored?.runtimeContinuation ? { recoveryContinuation: restored.runtimeContinuation } : {}),
});
const result = await runWithRecoveryToolExecutionPolicy(
  writer.executeTool,
  () => runWithToolCallOccurrences(() => runtime.stream({ input: "Synthetic" })),
);
const reader = result.toDataStreamResponse().body!.getReader();
const decoder = new TextDecoder();
const state = createStreamTransformState();
let remainder = "";
while (true) {
  const chunk = await reader.read();
  if (chunk.done) break;
  const parsed = parseSseJsonEvents(remainder + decoder.decode(chunk.value, { stream: true }));
  remainder = parsed.remainder;
  for (const event of parsed.events) {
    for (const mapped of mapRuntimeEventToAgUi(state, event)) {
      await writer.appendMappedEvent(
        mapped,
        mapped.event === "ToolCallStart" && typeof event.privateToolCallOccurrenceId === "string"
          ? event.privateToolCallOccurrenceId
          : undefined,
      );
    }
  }
}
reader.releaseLock();
const final = parseRecoverySnapshot((await home.read()).at(-1)!.value);
if (
  input.mode === "B" &&
  (model.callCount !== 1 || await effectCount() !== 1 ||
    final.runtimeContinuation?.latestAssistantText !== "Complete")
) {
  throw new Error(
    `Replacement failed to complete the actual restored run exactly once: ${
      JSON.stringify({
        modelCalls: model.callCount,
        effectCount: await effectCount(),
        finalContinuation: final.runtimeContinuation,
      })
    }`,
  );
}
console.log(JSON.stringify({
  phase: "completed",
  effectCount: await effectCount(),
  modelCalls: model.callCount,
  restoredNextStep: restored?.runtimeContinuation?.nextStep,
  finalNextStep: final.runtimeContinuation?.nextStep,
  toolBoundaries: final.toolBoundaries,
  modelTurns: final.modelTurns,
  restoredSnapshot: restored,
  finalContinuation: final.runtimeContinuation,
}));
