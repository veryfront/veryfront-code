import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { assert, assertEquals } from "veryfront/testing/assert";
import { it } from "veryfront/testing/bdd";
import { initializeExecutorRuntimeContracts } from "veryfront/agent/executor-runtime";
import {
  connectExecutorTransport,
  createManagedBrokerHandler,
  createManagedBrokerPersistence,
  createManagedExecutorBroker,
  startNodeManagedAgentBroker,
} from "veryfront/agent/managed-broker";

await initializeExecutorRuntimeContracts();
const modelId = "veryfront-cloud/openai/synthetic";
const owner = { scopeKind: "global", serviceName: "synthetic-broker" };
const source = { type: "release", releaseId: "synthetic-release" };
const projectId = "00000000-0000-4000-8000-000000000005";
const conversationId = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000002";
const image = `registry.example.test/executor@sha256:${"a".repeat(64)}`;
const usage = { inputTokens: 4, outputTokens: 2, totalTokens: 6 };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function bounded(promise, label, ms = 25_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function scenario(kind) {
  const steering = kind === "steering";
  const providerToolNames = steering ? ["web_search"] : [];
  const mode = kind === "sse" || kind === "disconnect" ? "sse" : "detached";
  const project = new URL(`./project-${kind}/`, import.meta.url);
  await mkdir(new URL("agents/", project), { recursive: true });
  await copyFile(new URL("./project-hooks.mjs", import.meta.url), new URL("hooks.mjs", project));
  await writeFile(
    new URL("veryfront.config.ts", project),
    'import "./hooks.mjs"; export default { ai: { agents: { discovery: { paths: ["agents"] } } } };',
  );
  await writeFile(
    new URL("agents/probe.ts", project),
    `import { agent } from "veryfront/agent";
export default agent({ id: "probe", model: ${JSON.stringify(modelId)},
  system: "Use host_probe once, then report its result.",
  tools: ${
      JSON.stringify(steering ? { host_probe: true, update_file: true } : { host_probe: true })
    },
  providerTools: ${JSON.stringify(providerToolNames)} });`,
  );

  const secrets = Object.fromEntries(["authorization", "api", "inference", "events"].map(
    (name) => [name, `synthetic-broker-private-${name}-${randomUUID()}`],
  ));
  const canaries = Object.values(secrets);
  const runId = `run-${kind}`;
  const path = `/api/control-plane/runs/${runId}/stream`;
  const run = {
    runId,
    conversationId,
    messageId,
    latestEventId: 0,
    latestExternalEventSequence: 0,
    waitingToolCallId: null,
    waitingToolName: null,
    status: "running",
    streamProtocolVersion: 2,
  };
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const body = JSON.stringify({
    run: {
      agentServiceId: "synthetic-service",
      agentId: "probe",
      conversationId,
      runId,
      messageId,
      inputAnchorMessageId: "00000000-0000-4000-8000-000000000003",
      requestedByUserId: "00000000-0000-4000-8000-000000000006",
      project: { projectId, projectSlug: "demo-project", runtimeTargetKind: "main_branch" },
    },
    messages: [{ id: "user", role: "user", content: "Run the host probe." }],
    tools: [],
    context: [],
    agentSource: source,
    credentials: { authToken: secrets.api, inferenceAuthToken: secrets.inference },
  });
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const nowSeconds = Math.floor(Date.now() / 1000);
  const signed = `${encode({ alg: "EdDSA", typ: "JWT" })}.${
    encode({
      iss: "veryfront-api",
      aud: "demo-project",
      sub: runId,
      surface: "studio",
      project_id: projectId,
      request_hash: createHash("sha256").update(body).digest("base64url"),
      request_method: "POST",
      request_path: path,
      iat: nowSeconds,
      exp: nowSeconds + 90,
    })
  }`;
  const headers = {
    authorization: `Bearer ${secrets.authorization}`,
    "x-veryfront-control-plane-jws": `${signed}.${
      sign(null, Buffer.from(signed), privateKey).toString("base64url")
    }`,
    "x-veryfront-run-event-token": secrets.events,
    "content-type": "application/json",
  };
  const clientAbort = new AbortController();
  const executionAbort = new AbortController();
  const secondModelCall = Promise.withResolvers();
  const terminalEntered = Promise.withResolvers();
  const terminalRelease = Promise.withResolvers();
  const finished = Promise.withResolvers();
  const allocations = [];
  const releases = [];
  const persisted = [];
  const completions = [];
  const modelCalls = [];
  const steeringRefreshes = [];
  const tools = [];
  const apiErrors = [];
  let cursor = 0;
  let child;
  let childExited;
  let childOutput = "";
  let handler;
  let server;
  let shutdown;
  let transportClosed = false;
  const broker = createManagedExecutorBroker({ maxActive: 1 });

  // A real HTTP endpoint checks the persistence wire contract. No live API or
  // provider is contacted; credentials are freshly generated synthetic canaries.
  const api = createServer(async (request, response) => {
    try {
      assertEquals(request.headers.authorization, `Bearer ${secrets.events}`);
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const data = JSON.parse(raw);
      for (const canary of canaries) {
        assert(!raw.includes(canary), "Credential entered persistence data");
      }
      response.setHeader("content-type", "application/json");
      if (Array.isArray(data.events)) {
        assertEquals(request.url, `/conversations/${conversationId}/runs/${runId}/events`);
        persisted.push(...data.events);
        cursor += data.events.length;
        response.end(JSON.stringify({
          latest_event_id: cursor,
          latest_external_event_sequence: cursor,
          appended_count: data.events.length,
          run: {
            run_id: runId,
            conversation_id: conversationId,
            latest_event_id: cursor,
            latest_external_event_sequence: cursor,
          },
        }));
      } else {
        assertEquals(request.url, `/runs/${runId}/complete`);
        completions.push(data);
        terminalEntered.resolve();
        if (kind === "delayed-persistence") await terminalRelease.promise;
        response.end(JSON.stringify({ completed: true, run: { runId, status: data.status } }));
      }
    } catch (error) {
      apiErrors.push(error);
      response.statusCode = 500;
      response.end("{}");
    }
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const apiUrl = `http://127.0.0.1:${api.address().port}`;

  const model = {
    specificationVersion: "v3",
    provider: "openai",
    modelId: "synthetic",
    doGenerate() {
      throw new Error("Unexpected non-streaming model call");
    },
    doStream(options) {
      modelCalls.push(options);
      const turn = modelCalls.length;
      for (const canary of canaries) {
        assert(
          !JSON.stringify(options).includes(canary),
          "Credential entered model application data",
        );
      }
      assert(turn <= 2, "Unexpected extra model call");
      return Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            if (turn === 1) {
              controller.enqueue({
                type: "tool-call",
                toolCallId: "host-call",
                toolName: "host_probe",
                input: {},
              });
              if (steering) {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: "steering-call",
                  toolName: "update_file",
                  input: { path: "AGENTS.md", project_reference: projectId },
                });
              }
              controller.enqueue({ type: "finish", finishReason: "tool-calls", totalUsage: usage });
              controller.close();
            } else {
              controller.enqueue({ type: "text-delta", text: "Host tool completed." });
              secondModelCall.resolve();
              if (kind === "kill" || kind === "disconnect") {
                const abort = () => controller.error(new Error("Synthetic provider cancelled"));
                if (options.abortSignal.aborted) abort();
                else options.abortSignal.addEventListener("abort", abort, { once: true });
              } else {
                controller.enqueue({ type: "finish", finishReason: "stop", totalUsage: usage });
                controller.close();
              }
            }
          },
        }),
      });
    },
  };

  try {
    handler = createManagedBrokerHandler({
      broker,
      responseMode: mode,
      resolveIngressOptions: () => ({
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
        audience: "demo-project",
        projectId,
        expectedSurface: "studio",
        boundSource: source,
        expectedOwner: owner,
        authorizeScope(authority) {
          assertEquals(authority.authorization, headers.authorization);
          assertEquals(authority.apiAuthToken, secrets.api);
          assertEquals(authority.runEventToken, secrets.events);
          return { authorized: true };
        },
      }),
      prepare({ ingress }) {
        assertEquals(ingress.privateAuthority.inferenceAuthToken, secrets.inference);
        const persistence = createManagedBrokerPersistence({
          apiUrl,
          runEventToken: ingress.privateAuthority.runEventToken,
          run,
          modelId,
          resolveProvider: () => "openai",
          fetch: globalThis.fetch,
        });
        const now = Date.now();
        const allocationRequest = {
          allocationId: randomUUID(),
          invocationId: randomUUID(),
          owner,
          source,
          requestedAt: now,
          prepareDeadlineAt: now + 45_000,
          hardDeadlineAt: now + 90_000,
        };
        const binding = {
          ...allocationRequest,
          generation: 1,
          brokerInstanceId: "synthetic-broker",
        };
        delete binding.requestedAt;
        delete binding.prepareDeadlineAt;
        delete binding.hardDeadlineAt;
        const allocation = (phase, reason) => ({
          binding,
          phase,
          expiresAt: allocationRequest.hardDeadlineAt,
          ...(reason ? { reason } : {}),
          ...(phase === "ready"
            ? {
              endpoint: {
                address: "127.0.0.1",
                port: 8081,
                podUid: "synthetic-executor",
                nodeName: "synthetic-node",
                image,
                channelAuthenticated: false,
              },
            }
            : {}),
        });
        const allocator = {
          async allocate(request, bootstrap) {
            allocations.push(request);
            const key = Buffer.from(bootstrap.channelKey);
            child = spawn(process.execPath, [
              fileURLToPath(new URL("./executor.mjs", import.meta.url)),
              fileURLToPath(project),
            ], {
              cwd: fileURLToPath(project),
              stdio: ["pipe", "pipe", "pipe"],
              // Deliberately omit all broker credentials and ambient provider configuration.
              env: {
                PATH: process.env.PATH,
                NODE_ENV: "production",
                VF_DISABLE_LRU_INTERVAL: "1",
                VERYFRONT_EXECUTOR_ALLOCATION_ID: request.allocationId,
                VERYFRONT_EXECUTOR_INVOCATION_ID: request.invocationId,
                VERYFRONT_EXECUTOR_GENERATION: "1",
                VERYFRONT_EXECUTOR_ACTIVE_DEADLINE_SECONDS: "90",
                VERYFRONT_EXECUTOR_HARD_DEADLINE_AT: String(request.hardDeadlineAt),
                PORT: "8081",
              },
            });
            childExited = new Promise((resolve, reject) => {
              child.once("error", reject);
              child.once("close", (code, signal) => resolve({ code, signal }));
            });
            void childExited.catch(() => {});
            const ready = Promise.withResolvers();
            let stdout = "";
            child.stdout.on("data", (chunk) => {
              stdout += chunk;
              childOutput += chunk;
              if (stdout.includes("\n")) {
                try {
                  ready.resolve(JSON.parse(stdout.split("\n")[0]));
                } catch {
                  ready.reject(new Error("Invalid executor readiness"));
                }
              }
            });
            child.stderr.on("data", (chunk) => {
              childOutput += chunk;
            });
            void childExited.then(
              () => ready.reject(new Error("Executor exited before readiness")),
              ready.reject,
            );
            child.stdin.end(key, () => key.fill(0));
            const endpoint = await bounded(ready.promise, "Executor readiness");
            assert(endpoint.pid !== process.pid);
            assertEquals(endpoint.port, 8081);
            return allocation("ready");
          },
          observe: () => Promise.resolve(allocation("ready")),
          renew: () => Promise.resolve(allocation("ready")),
          release(_binding, reason) {
            releases.push(reason);
            return Promise.resolve(allocation("released", reason));
          },
        };
        return Promise.resolve({
          start: {
            bindSessionOwnedWork: persistence.bindSessionOwnedWork,
            session: {
              request: allocationRequest,
              expectedBrokerInstanceId: "synthetic-broker",
              expectedImage: image,
              allocator,
              requestTimeoutMs: 30_000,
              cleanupTimeoutMs: 200,
              async connectTransport(options) {
                const transport = await connectExecutorTransport(options);
                return {
                  ...transport,
                  close() {
                    transportClosed = true;
                    return transport.close();
                  },
                };
              },
            },
            installation: {
              version: 1,
              root: "project",
              owner,
              source,
              grant: {
                agentId: "probe",
                defaultModelId: modelId,
                maxSteps: 4,
                models: [{ id: modelId, maxOutputTokens: 100, providerToolNames }],
                allowedToolNames: steering ? ["host_probe", "update_file"] : ["host_probe"],
                hostToolFacadeIds: ["host"],
                remoteToolSourceIds: steering ? ["state-tools"] : [],
                execution: {
                  kind: "canonical",
                  projectId: steering ? projectId : null,
                  conversationId,
                  runId,
                  messageId,
                  providerReplay: "disabled",
                },
              },
              capabilities: {
                persistence: { publishParentRunEvents: "parent", toolExposureCheckpoint: "tools" },
                ...(steering ? { projectSteering: "steering" } : {}),
              },
            },
            prepare: { agentId: "probe" },
            model: {
              resolver: () => model,
              runEventSink: persistence.modelRunEventSink,
              grant: {
                maxCalls: 3,
                maxConcurrentCalls: 1,
                models: new Map([[modelId, {
                  maxOutputTokens: 100,
                  providerTools: providerToolNames.map((name) => ({
                    type: "provider",
                    name,
                    id: `openai.${name}`,
                    args: {},
                  })),
                }]]),
              },
            },
            tools: {
              catalog: new Map([
                ["host_probe", {}],
                ...(steering ? [["update_file", {}]] : []),
              ]),
              maxCalls: 8,
              maxConcurrent: 1,
              sources: new Map([
                ["host", {
                  allowedToolNames: new Set(["host_probe"]),
                  context: {},
                  source: {
                    id: "host",
                    listTools: () =>
                      Promise.resolve([{
                        name: "host_probe",
                        description: "Read a synthetic result",
                        parameters: { type: "object", properties: {}, additionalProperties: false },
                      }]),
                    executeTool(name) {
                      tools.push(name);
                      return Promise.resolve({ text: "host-ok" });
                    },
                  },
                }],
                ...(steering
                  ? [["state-tools", {
                    allowedToolNames: new Set(["update_file"]),
                    context: {},
                    source: {
                      id: "state-tools",
                      listTools: () =>
                        Promise.resolve([{
                          name: "update_file",
                          description: "Update synthetic project instructions",
                          parameters: {
                            type: "object",
                            properties: {
                              path: { type: "string" },
                              project_reference: { type: "string" },
                            },
                            required: ["path", "project_reference"],
                          },
                        }]),
                      executeTool(name) {
                        tools.push(name);
                        return Promise.resolve({ success: true });
                      },
                    },
                  }]]
                  : []),
              ]),
            },
            persistence: {
              publishParentRunEvents: persistence.publishParentRunEvents,
              persistToolExposureCheckpoint: persistence.persistToolExposureCheckpoint,
              initialProviderReplayCheckpoints: [],
            },
            state: steering
              ? {
                prepareProjectSteering: ({ definition }) => Promise.resolve({ agent: definition }),
                refreshProjectSteering(_signal, names) {
                  steeringRefreshes.push(
                    [...names].sort((left, right) => left.localeCompare(right)),
                  );
                  return Promise.resolve("Synthetic refreshed steering");
                },
              }
              : {},
          },
          messages: ingress.executor.input.messages.map((message) => ({
            id: message.id,
            role: message.role,
            timestamp: 1,
            parts: [{ type: "text", text: message.content }],
          })),
          executionSignal: executionAbort.signal,
          output: persistence.output,
          async cleanup() {
            await persistence.cleanup();
            finished.resolve();
          },
        });
      },
    });
    const unsupported = { handle: () => new Response(null, { status: 404 }) };
    server = await startNodeManagedAgentBroker({
      port: 0,
      bindAddress: "127.0.0.1",
      signals: [],
      hardShutdownTimeoutMs: 10_000,
      broker,
      readiness: () => true,
      handlers: {
        signedStream: handler,
        durableStart: unsupported,
        agUi: unsupported,
        cancel: unsupported,
        resume: unsupported,
      },
    });
    if (kind === "detached") {
      const rejected = await fetch(`${server.url}${path}`, {
        method: "POST",
        body,
        headers: { ...headers, "x-veryfront-control-plane-jws": "invalid" },
      });
      assertEquals(rejected.status, 401);
      await rejected.body?.cancel();
      assertEquals(allocations.length, 0, "Invalid signatures must not allocate an executor");
    }
    const response = await fetch(`${server.url}${path}`, {
      method: "POST",
      headers,
      body,
      signal: clientAbort.signal,
    });
    assertEquals(
      response.status,
      mode === "sse" ? 200 : 202,
      await (response.status >= 400 ? response.text() : Promise.resolve("")),
    );
    let wire = "";
    if (mode === "detached") {
      assertEquals(await response.json(), { accepted: true, duplicate: false });
    }
    const reading = mode === "sse"
      ? response.text().then((text) => {
        wire = text;
      })
      : Promise.resolve();
    void reading.catch(() => {});
    await bounded(secondModelCall.promise, "Second model call");

    if (kind === "kill") {
      const duplicate = await fetch(`${server.url}${path}`, { method: "POST", headers, body });
      assertEquals(await duplicate.json(), { accepted: true, duplicate: true });
      child.kill("SIGKILL");
    } else if (kind === "disconnect") {
      clientAbort.abort();
      await reading.catch(() => {});
    } else if (kind === "delayed-persistence") {
      await bounded(terminalEntered.promise, "Terminal persistence");
      shutdown = server.stop();
      await bounded(broker.closed, "Bounded broker closure");
      assertEquals(broker.active, 1, "Pending persistence must retain admission");
      let settled = false;
      void broker.settled.then(() => {
        settled = true;
      });
      await tick();
      assertEquals(settled, false);
      terminalRelease.resolve();
    }
    await bounded(finished.promise, "Run cleanup");
    if (kind !== "disconnect") await bounded(reading, "SSE completion");
    const exit = await bounded(childExited, "Executor retirement");
    assertEquals(allocations.length, 1);
    assertEquals(releases.length, 1);
    assertEquals(transportClosed, true);
    assertEquals(
      [...tools].sort((left, right) => left.localeCompare(right)),
      steering ? ["host_probe", "update_file"] : ["host_probe"],
    );
    assertEquals(modelCalls.length, 2);
    assert(JSON.stringify(modelCalls[0].prompt).includes("Run the host probe."));
    assert(JSON.stringify(modelCalls[1].prompt).includes("host-ok"));
    if (steering) {
      assertEquals(steeringRefreshes, [["host_probe", "update_file", "web_search"]]);
      for (const call of modelCalls) {
        assert(call.tools.some((tool) => tool.name === "web_search"));
      }
      assert(JSON.stringify(modelCalls[1].prompt).includes("Synthetic refreshed steering"));
    }
    assertEquals(apiErrors, []);
    if (kind === "kill") assertEquals(exit.signal, "SIGKILL");
    else assertEquals(exit.code, 0);
    if (mode === "detached") {
      assertEquals(completions.length, 1, "Exactly one durable terminal update");
      assertEquals(completions[0].status, kind === "kill" ? "failed" : "completed");
      if (kind !== "kill") assert(JSON.stringify(persisted).includes("Host tool completed."));
    } else {
      assertEquals(completions.length, 0, "SSE persistence is owned by the stream consumer");
      if (kind === "sse") {
        assertEquals(wire.split("\n").filter((line) => line === "event: RunFinished").length, 1);
        assert(wire.includes("Host tool completed."));
        assert(!wire.includes("event: RunError"));
      }
    }
    assert(persisted.length > 0, "Canonical model/tool events must reach persistence");
    const observation = JSON.parse(await readFile(new URL("observations.json", project), "utf8"));
    assertEquals(observation.pid, child.pid);
    assertEquals(observation.controls, { call: true, json: true, decode: true, headers: true });
    assertEquals(observation.observations, 0, "Project hooks observed a broker canary");
    for (const canary of canaries) {
      assert(!`${wire}${childOutput}`.includes(canary), "Credential entered executor output");
    }
    await bounded(shutdown ?? server.stop(), "Server shutdown");
    await bounded(broker.settled, "Broker settlement");
    assertEquals(broker.active, 0);
  } finally {
    terminalRelease.resolve();
    clientAbort.abort();
    executionAbort.abort();
    child?.kill("SIGKILL");
    await childExited?.catch(() => {});
    await bounded(shutdown ?? server?.stop() ?? broker.shutdown(), "Cleanup").catch(() => {});
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
    await rm(project, { recursive: true, force: true });
  }
}

for (const kind of ["sse", "detached", "kill", "disconnect", "delayed-persistence", "steering"]) {
  it(`packed managed broker: ${kind}`, { timeout: 90_000 }, () => scenario(kind));
}
