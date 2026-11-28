import type { RuntimeConfigurationReference } from "#veryfront/agent/runtime/runtime-configuration-reference.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  BrokerIngressError,
  parseBrokerRuntimeAgentIngress,
} from "#veryfront/agent/service/broker-ingress.ts";
import {
  invocation,
  options,
  projectId,
  signedRequest,
} from "#veryfront/agent/service/broker-ingress.test-helpers.ts";
import {
  createInstalledProjectAgentSessionResolver,
  type InstalledProjectAgentSessionOptions,
} from "./installed-agent-session.ts";

const sourceId = "00000000-0000-4000-8000-000000000099";
const environmentId = "00000000-0000-4000-8000-000000000098";
const image = `ghcr.io/veryfront/tenant-source@sha256:${"a".repeat(64)}`;
function installed(releaseId = "release-1", selectedImage = image) {
  return {
    image: selectedImage,
    configuration: {
      projectId: sourceId,
      projectSlug: "private-source",
      environmentId,
      environmentName: "production",
      releaseId,
      configurationId: "config-1",
      variables: { SOURCE_SECRET: "must-not-reach-agent-session" },
    },
  };
}
function host(installations = [installed()]): InstalledProjectAgentSessionOptions {
  return {
    installations,
    expectedBrokerInstanceId: "broker-a",
    allocator: {
      allocate() {
        throw new Error("Selector must not allocate");
      },
    } as unknown as InstalledProjectAgentSessionOptions["allocator"],
    connectTransport() {
      throw new Error("Selector must not connect");
    },
    clock: {
      now: () => 1000,
      schedule() {
        throw new Error("Selector must not schedule work");
      },
      cancel() {},
    },
  };
}
async function executor(deadline?: number, runtimeConfiguration?: RuntimeConfigurationReference) {
  const base = invocation();
  const signed = await signedRequest(
    invocation({
      run: {
        ...base.run,
        project: { ...base.run.project, runtimeTargetBranchName: "main" },
        ...(deadline === undefined
          ? {}
          : { effectiveDeadlineAt: new Date(deadline).toISOString() }),
      },
      sourceProject: {
        projectId: sourceId,
        projectSlug: "private-source",
        runtimeTargetKind: "environment",
        runtimeTargetEnvironmentId: environmentId,
        runtimeTargetEnvironmentName: "Production",
      },
      agentEntrypoint: { path: "agents/selected.ts" },
      ...(runtimeConfiguration
        ? {
          runtimeConfiguration,
          agentSource: { type: "release" as const, releaseId: runtimeConfiguration.releaseId },
        }
        : {}),
    }),
    { projectId: sourceId, audience: "private-source" },
  );
  return (await parseBrokerRuntimeAgentIngress(signed.request, {
    ...options(signed.publicKeyPem),
    projectId: sourceId,
    audience: "private-source",
    expectedOwner: { scopeKind: "project", projectId: sourceId },
    ...(runtimeConfiguration
      ? { boundSource: { type: "release" as const, releaseId: runtimeConfiguration.releaseId } }
      : {}),
  })).executor;
}

describe("installed project agent sessions", () => {
  it("selects the source image independently of the consuming project and excludes app variables", async () => {
    const input = await executor(1500);
    const resolve = createInstalledProjectAgentSessionResolver(host());
    const session = resolve(input, new AbortController().signal);
    assertEquals(input.run.project.projectId, projectId);
    assertEquals(session.request.owner, { scopeKind: "project", projectId: sourceId });
    assertEquals(session.request.source, { type: "release", releaseId: "release-1" });
    assertEquals(session.request.executionProfile, "project-tools");
    assertEquals(session.expectedImage, image);
    assertEquals(session.request.prepareDeadlineAt, 1500);
    assertEquals(session.request.hardDeadlineAt, 1500);
    assertEquals("configuration" in session, false);
    assertEquals(JSON.stringify(session.request).includes("must-not-reach-agent-session"), false);
  });
  it("retains captured releases, tolerates renamed display labels and snapshots the registry", async () => {
    const old = installed(),
      newer = installed("release-2", image.replace("a".repeat(64), "b".repeat(64)));
    const renamed = installed();
    renamed.configuration.projectSlug = "renamed";
    renamed.configuration.environmentName = "Renamed production";
    const resolve = createInstalledProjectAgentSessionResolver(host([newer, old, renamed]));
    old.image = newer.image;
    const result = resolve(await executor(), new AbortController().signal);
    assertEquals(result.expectedImage, image);
  });
  it("clamps preparation to the host budget even when the signed deadline is later", async () => {
    const resolve = createInstalledProjectAgentSessionResolver({
      ...host(),
      lifetimeMs: 300,
      preparationMs: 500,
    });
    const session = resolve(await executor(1500), new AbortController().signal);
    assertEquals(session.request.requestedAt, 1000);
    assertEquals(session.request.hardDeadlineAt, 1300);
    assertEquals(session.request.prepareDeadlineAt, 1300);
  });
  for (const mismatch of ["owner", "project", "environment", "release", "branch"] as const) {
    it(`refuses an uninstalled ${mismatch} before allocation`, async () => {
      const input = await executor();
      const changed = {
        ...input,
        ...(mismatch === "owner" ? { owner: { scopeKind: "project" as const, projectId } } : {}),
        ...(mismatch === "project"
          ? { sourceProject: { ...input.sourceProject!, projectId } }
          : {}),
        ...(mismatch === "environment"
          ? { sourceProject: { ...input.sourceProject!, runtimeTargetEnvironmentId: projectId } }
          : {}),
        ...(mismatch === "release"
          ? { agentSource: { type: "release" as const, releaseId: "unknown-release" } }
          : {}),
        ...(mismatch === "branch"
          ? { agentSource: { type: "branch" as const, branch: "main" } }
          : {}),
      };
      const resolve = createInstalledProjectAgentSessionResolver(host());
      const error = assertThrows(
        () => resolve(changed, new AbortController().signal),
        BrokerIngressError,
      );
      assert(error instanceof BrokerIngressError);
      assertEquals(error.status, mismatch === "owner" || mismatch === "project" ? 403 : 503);
    });
  }
  it("refuses expired runs and cancelled preparation or process ownership", async () => {
    const resolve = createInstalledProjectAgentSessionResolver(host());
    const expired = await executor(1000), input = await executor();
    const expiredError = assertThrows(
      () => resolve(expired, new AbortController().signal),
      BrokerIngressError,
    );
    assert(expiredError instanceof BrokerIngressError);
    assertEquals(expiredError.status, 409);
    const cancelled = new AbortController();
    cancelled.abort();
    assertThrows(() => resolve(input, cancelled.signal));
    const owned = createInstalledProjectAgentSessionResolver({
      ...host(),
      ownerSignal: cancelled.signal,
    });
    assertThrows(() => owned(input, new AbortController().signal));
  });
  it("rejects ambiguous images, mutable image tags and invalid budgets at startup", () => {
    assertThrows(() =>
      createInstalledProjectAgentSessionResolver(
        host([installed(), installed("release-1", image.replace("a".repeat(64), "b".repeat(64)))]),
      )
    );
    assertThrows(() =>
      createInstalledProjectAgentSessionResolver(
        host([installed("release-1", "ghcr.io/veryfront/tenant-source:latest")]),
      )
    );
    assertThrows(() => createInstalledProjectAgentSessionResolver({ ...host(), lifetimeMs: 0 }));
  });
});

Deno.test("installed registry binds only exact source project environment and release tuples", async () => {
  const resolve = createInstalledProjectAgentSessionResolver(
    host([installed(), installed("release-2", image.replace("a".repeat(64), "b".repeat(64)))]),
  );
  const value = await executor();
  const project = value.sourceProject!;
  assertEquals(
    resolve.resolveBoundSource({
      sourceProject: project,
      requestedSource: { type: "release", releaseId: "release-1" },
    }),
    { type: "release", releaseId: "release-1" },
  );
  assertEquals(
    resolve.resolveBoundSource({
      sourceProject: project,
      requestedSource: { type: "release", releaseId: "release-2" },
    }),
    { type: "release", releaseId: "release-2" },
  );
  for (
    const sourceProject of [{ ...project, projectId }, {
      ...project,
      runtimeTargetEnvironmentId: projectId,
    }, { ...project, sourceTargetEnvironmentId: projectId }]
  ) {
    assertEquals(
      resolve.resolveBoundSource({ sourceProject, requestedSource: value.agentSource }),
      undefined,
    );
  }
  assertEquals(
    resolve.resolveBoundSource({
      sourceProject: project,
      requestedSource: { type: "release", releaseId: "not-installed" },
    }),
    undefined,
  );
  assertEquals(Object.isFrozen(resolve), true);
});

describe("captured native configuration references", () => {
  const a: RuntimeConfigurationReference = {
    version: 1,
    projectId: sourceId,
    environmentId,
    releaseId: "30000000-3000-4000-8000-300000000003",
    deploymentId: "40000000-4000-4000-8000-400000000004",
    configurationId:
      "configuration-fcb43e37d012b8d6a7f37bf148db776b993344309f13da3bf3997b29c09927fc",
  };
  const b = {
    ...a,
    deploymentId: "50000000-5000-4000-8000-500000000005",
    configurationId:
      "configuration-25db5ea8bcecc6cdcf74310474717005e7532158e6bf595a52e93ccebd11069b",
  };
  const entries = [a, b].map((ref, index) => {
    const entry = installed(ref.releaseId);
    entry.configuration.configurationId = ref.configurationId;
    if (index) entry.configuration.variables.SOURCE_SECRET += "-B";
    return entry;
  });
  const configured = () => ({
    ...host(entries),
    configurationReferences: { version: 1 as const, references: [a, b] },
    projectExecutionConfigurationVersion: 1 as const,
  });
  it("retains signed A across serialized redispatch/restart while new signed work selects B without HTTP variables", async () => {
    const input = await executor(undefined, a);
    assertEquals(input.runtimeConfiguration, a);
    assert(Object.isFrozen(input.runtimeConfiguration));
    const resolve = createInstalledProjectAgentSessionResolver(configured());
    const first = resolve(input, new AbortController().signal);
    assertEquals(first.runtimeConfiguration, a);
    assertEquals(
      resolve(await executor(undefined, b), new AbortController().signal).runtimeConfiguration,
      b,
    );
    const restarted = createInstalledProjectAgentSessionResolver(configured());
    const captured = JSON.parse(JSON.stringify(input));
    assertEquals(restarted(captured, new AbortController().signal).runtimeConfiguration, a);
    assert(Object.isFrozen(first.runtimeConfiguration));
    assert(Object.isFrozen(first));
    assertEquals(JSON.stringify(first).includes("must-not-reach-agent-session"), false);
    assertEquals("configuration" in first, false);
  });
  it("rejects mixed or unsupported authored-configuration cohorts at construction", () => {
    assertThrows(() =>
      createInstalledProjectAgentSessionResolver({
        ...host(entries),
        configurationReferences: { version: 1, references: [a, b] },
      })
    );
    assertThrows(() =>
      createInstalledProjectAgentSessionResolver({
        ...host(entries),
        projectExecutionConfigurationVersion: 1,
      })
    );
    assertThrows(() =>
      createInstalledProjectAgentSessionResolver({
        ...configured(),
        projectExecutionConfigurationVersion: 2 as never,
      })
    );
  });
  it("rejects a signed reference outside its source scope during ingress parsing", async () => {
    await assertRejects(() => executor(undefined, { ...a, projectId }));
  });
  it("refuses missing, foreign, unknown and legacy references instead of selecting latest", async () => {
    const input = await executor(undefined, a);
    const resolve = createInstalledProjectAgentSessionResolver(configured());
    const { runtimeConfiguration: _reference, ...missing } = input;
    assertThrows(() => resolve(missing, new AbortController().signal), BrokerIngressError);
    for (
      const field of [
        "projectId",
        "environmentId",
        "releaseId",
        "deploymentId",
        "configurationId",
      ] as const
    ) {
      const changed = {
        ...a,
        [field]: field === "configurationId"
          ? `configuration-${"f".repeat(64)}`
          : "90000000-9000-4000-8000-900000000009",
      };
      assertThrows(
        () => resolve({ ...input, runtimeConfiguration: changed }, new AbortController().signal),
        BrokerIngressError,
      );
    }
    const legacy = createInstalledProjectAgentSessionResolver(host(entries));
    assertThrows(() => legacy(input, new AbortController().signal), BrokerIngressError);
    assertThrows(
      () =>
        resolve({
          ...missing,
          input: { ...missing.input, forwardedProps: { runtimeConfiguration: a } },
        }, new AbortController().signal),
      BrokerIngressError,
    );
  });
});
