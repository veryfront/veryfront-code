import "#veryfront/schemas/_test-setup.ts";
import { generateKeyPairSync, sign } from "node:crypto";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createAgentServiceSandboxTools } from "#veryfront/sandbox";
import { createConnectedLocalPlatformTools } from "../../../src/agent/ag-ui/connected-local-platform-tools.ts";
import {
  createHostedRunEventWriterCapability,
} from "../../../src/agent/hosted/child-run-event-writer-token.ts";
import {
  registerHostedChildPlatformDependencies,
  runWithHostedPlatformDependencies,
} from "../../../src/agent/hosted/platform-dependency-credential.ts";
import { getVerifiedSkillScriptExecutionCredential } from "../../../src/skill/execution-credential.ts";

async function fixture(
  operation: (input: {
    transport: typeof fetch;
    scope: { projectId: string; runId: string; agentId: string };
    eventToken: (runId: string, agentId?: string) => string;
    authToken: string;
  }) => Promise<void>,
) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const scope = {
    projectId: "22222222-2222-4222-8222-222222222222",
    runId: "cleanup-root",
    agentId: "coder",
  };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signed = (claims: unknown) => {
    const unsigned = `${encode({ alg: "RS256", kid: "cleanup" })}.${encode(claims)}`;
    return `${unsigned}.${
      sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")
    }`;
  };
  const eventToken = (runId: string, agentId = scope.agentId) =>
    signed({
      ...scope,
      runId,
      agentId,
      userId: "server",
      serviceAccountId: "server",
      actorType: "service_account",
      tokenUse: "run_event_writer",
      scopes: ["agent-runs:events:append"],
      platformToolDependencies: [],
      exp: Math.floor(Date.now() / 1000) + 60,
    });
  const authToken = signed({ scope: ["sandboxes:write"] });
  const transport: typeof fetch = () =>
    Promise.resolve(
      Response.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "cleanup" }] }),
    );
  await withMockFetch(transport, () => operation({ transport, scope, eventToken, authToken }));
}

it("closes each descendant sandbox at its own owner lifetime", async () => {
  await fixture(async ({ transport, scope, eventToken, authToken }) => {
    const closed: number[] = [];
    let created = 0;
    const tools = createConnectedLocalPlatformTools("https://api.veryfront.com", transport, {
      async createSandboxTools(input) {
        const sandbox = await createAgentServiceSandboxTools(input);
        const id = created++;
        return {
          ...sandbox,
          async closeSandbox() {
            closed.push(id);
            await sandbox.closeSandbox();
          },
        };
      },
    });
    const root = { runId: scope.runId };
    const child = { childRunId: "cleanup-child" };
    const grandchild = { childRunId: "cleanup-grandchild" };
    await tools.register(root, scope, eventToken(scope.runId), authToken);
    await registerHostedChildPlatformDependencies(
      root,
      child,
      { ...scope, runId: child.childRunId },
      eventToken(child.childRunId),
      authToken,
    );
    await registerHostedChildPlatformDependencies(
      child,
      grandchild,
      { ...scope, runId: grandchild.childRunId },
      eventToken(grandchild.childRunId),
      authToken,
    );
    assertEquals(created, 3);
    await tools.revoke(child);
    assertEquals(closed.sort(), [1, 2]);
    await tools.revoke(grandchild);
    assertEquals(closed.sort(), [1, 2]);
    await tools.revoke(root);
    assertEquals(closed.sort(), [0, 1, 2]);
    await tools.revoke(root);
    assertEquals(closed.sort(), [0, 1, 2]);
  });
});

it("rolls back authority and closes its sandbox if source configuration throws", async () => {
  await fixture(async ({ transport, scope, eventToken, authToken }) => {
    let closed = 0;
    const tools = createConnectedLocalPlatformTools("https://api.veryfront.com", transport, {
      async createSandboxTools(input) {
        const sandbox = await createAgentServiceSandboxTools(input);
        return {
          ...sandbox,
          tools: new Proxy(sandbox.tools, {
            ownKeys() {
              throw new Error("source configuration failed");
            },
          }),
          async closeSandbox() {
            closed++;
            await sandbox.closeSandbox();
          },
        };
      },
    });
    const owner = { runId: scope.runId };
    await assertRejects(
      () => tools.register(owner, scope, eventToken(scope.runId), authToken),
      Error,
      "source configuration failed",
    );
    assertEquals(closed, 1);
    assertThrows(() => runWithHostedPlatformDependencies(owner, () => Promise.resolve("leaked")));
    await tools.revoke(owner);
    assertEquals(closed, 1);
  });
});

it("closes a child sandbox when its source configuration fails and keeps the root active", async () => {
  await fixture(async ({ transport, scope, eventToken, authToken }) => {
    const closed: number[] = [];
    let created = 0;
    const tools = createConnectedLocalPlatformTools("https://api.veryfront.com", transport, {
      async createSandboxTools(input) {
        const sandbox = await createAgentServiceSandboxTools(input);
        const id = created++;
        return {
          ...sandbox,
          tools: id === 1
            ? new Proxy(sandbox.tools, {
              ownKeys() {
                throw new Error("child configuration failed");
              },
            })
            : sandbox.tools,
          async closeSandbox() {
            closed.push(id);
            await sandbox.closeSandbox();
          },
        };
      },
    });
    const root = { runId: scope.runId };
    const child = { childRunId: "failed-child" };
    await tools.register(root, scope, eventToken(scope.runId), authToken);
    await assertRejects(
      () =>
        registerHostedChildPlatformDependencies(
          root,
          child,
          { ...scope, runId: child.childRunId },
          eventToken(child.childRunId),
          authToken,
        ),
      Error,
      "child configuration failed",
    );
    assertEquals(closed, [1]);
    assertEquals(
      await runWithHostedPlatformDependencies(root, () => Promise.resolve("active")),
      "active",
    );
    assertThrows(() => runWithHostedPlatformDependencies(child, () => Promise.resolve("leaked")));
    await tools.revoke(root);
    assertEquals(closed, [1, 0]);
  });
});

it("closes a sandbox that finishes creation after its owner was revoked", async () => {
  await fixture(async ({ transport, scope, eventToken, authToken }) => {
    let created!: () => void;
    const creationStarted = new Promise<void>((resolve) => created = resolve);
    let release!: () => void;
    const creationGate = new Promise<void>((resolve) => release = resolve);
    let closed = 0;
    const tools = createConnectedLocalPlatformTools("https://api.veryfront.com", transport, {
      async createSandboxTools(input) {
        const sandbox = await createAgentServiceSandboxTools(input);
        created();
        await creationGate;
        return {
          ...sandbox,
          async closeSandbox() {
            closed++;
            await sandbox.closeSandbox();
          },
        };
      },
    });
    const owner = { runId: scope.runId };
    const registration = tools.register(owner, scope, eventToken(scope.runId), authToken);
    const rejected = assertRejects(() => registration, Error, "no longer active");
    await creationStarted;
    await tools.revoke(owner);
    release();
    await rejected;
    assertEquals(closed, 1);
    assertThrows(() => runWithHostedPlatformDependencies(owner, () => Promise.resolve("leaked")));
  });
});

it("attempts all descendant closes when one close fails", async () => {
  await fixture(async ({ transport, scope, eventToken, authToken }) => {
    const closed: number[] = [];
    let created = 0;
    const tools = createConnectedLocalPlatformTools("https://api.veryfront.com", transport, {
      async createSandboxTools(input) {
        const sandbox = await createAgentServiceSandboxTools(input);
        const id = created++;
        return {
          ...sandbox,
          closeSandbox() {
            closed.push(id);
            if (id === 0) throw new Error("close failed");
            return sandbox.closeSandbox();
          },
        };
      },
    });
    const root = { runId: scope.runId };
    const child = { childRunId: "cleanup-child" };
    await tools.register(root, scope, eventToken(scope.runId), authToken);
    await registerHostedChildPlatformDependencies(
      root,
      child,
      { ...scope, runId: child.childRunId },
      eventToken(child.childRunId),
      authToken,
    );
    await tools.revoke(root);
    assertEquals(closed.sort(), [0, 1]);
    assertThrows(() => runWithHostedPlatformDependencies(root, () => Promise.resolve("leaked")));
    assertThrows(() => runWithHostedPlatformDependencies(child, () => Promise.resolve("leaked")));
  });
});

it("renews only the root sandbox credential and keeps child credentials isolated", async () => {
  await fixture(async ({ transport, scope, eventToken, authToken }) => {
    const credentials: Array<() => string> = [];
    let currentToken = authToken;
    const tools = createConnectedLocalPlatformTools("https://api.veryfront.com", transport, {
      async createSandboxTools(input) {
        credentials.push(input.getAuthToken ?? (() => input.authToken!));
        return await createAgentServiceSandboxTools(input);
      },
    });
    const root = { runId: scope.runId };
    const child = { childRunId: "credential-child" };
    await tools.register(root, scope, eventToken(scope.runId), authToken, () => ({
      auth_token: currentToken,
      run_event_token: eventToken(scope.runId),
    }));
    await registerHostedChildPlatformDependencies(
      root,
      child,
      { ...scope, runId: child.childRunId },
      eventToken(child.childRunId),
      authToken,
    );
    assertEquals(credentials.length, 2);
    assertEquals(credentials[0]!(), authToken);
    currentToken = "renewed-root-credential";
    assertEquals(credentials[0]!(), currentToken);
    assertEquals(credentials[1]!(), authToken);
    const writer = createHostedRunEventWriterCapability({
      apiUrl: "https://api.veryfront.com",
      runId: scope.runId,
      canonicalRunId: "55555555-5555-4555-8555-555555555555",
      runEventAppendToken: eventToken(scope.runId),
    });
    await tools.run({
      owner: root,
      scope,
      writer,
      canonicalRunId: "55555555-5555-4555-8555-555555555555",
      signal: new AbortController().signal,
      admit: () => {
        throw new Error("No tools execute");
      },
    }, () => {
      assertEquals(
        getVerifiedSkillScriptExecutionCredential()?.authToken,
        "renewed-root-credential",
      );
      return Promise.resolve();
    });
    await tools.revoke(root);
  });
});

it("binds each delegated child script to its own run and role credential", async () => {
  await fixture(async ({ transport, scope, eventToken, authToken }) => {
    const tools = createConnectedLocalPlatformTools("https://api.veryfront.com", transport);
    const root = { runId: scope.runId };
    const child = { childRunId: "credential-child" };
    const childScope = { ...scope, runId: child.childRunId, agentId: "ingestion-agent" };
    const childCredential = "child-run-role-credential";
    await tools.register(root, scope, eventToken(scope.runId), authToken);
    await registerHostedChildPlatformDependencies(
      root,
      child,
      childScope,
      eventToken(child.childRunId, childScope.agentId),
      childCredential,
    );
    const writer = createHostedRunEventWriterCapability({
      apiUrl: "https://api.veryfront.com",
      runId: child.childRunId,
      canonicalRunId: "55555555-5555-4555-8555-555555555555",
      runEventAppendToken: eventToken(child.childRunId, childScope.agentId),
    });
    await tools.run({
      owner: child,
      scope: childScope,
      writer,
      canonicalRunId: "55555555-5555-4555-8555-555555555555",
      signal: new AbortController().signal,
      admit: () => {
        throw new Error("No tools execute");
      },
    }, () => {
      assertEquals(getVerifiedSkillScriptExecutionCredential(), {
        apiUrl: "https://api.veryfront.com",
        authToken: childCredential,
        projectId: scope.projectId,
        runId: child.childRunId,
        agentId: childScope.agentId,
      });
      return Promise.resolve();
    });
    await tools.revoke(root);
  });
});
