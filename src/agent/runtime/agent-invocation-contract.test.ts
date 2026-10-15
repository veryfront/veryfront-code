import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildRuntimeAgentControlPlaneStreamRequestFromInvocation,
  parseRuntimeAgentRunInvocation,
  parseRuntimeAgentRunInvocationOrError,
  type RuntimeAgentControlPlaneStreamRequest,
  RuntimeAgentRunInvocationSchema,
} from "../index.ts";
import {
  parseRuntimeAgentRunInvocationValue,
  safeParseRuntimeAgentRunInvocationValue,
} from "./agent-invocation-contract.ts";
import { DEFAULT_LIMITS } from "#veryfront/security/input-validation/types.ts";

const conversationId = "10000000-1000-4000-8000-100000000001";
const messageId = "10000000-1000-4000-8000-100000000002";
const inputAnchorMessageId = "10000000-1000-4000-8000-100000000003";
const userId = "10000000-1000-4000-8000-100000000004";
const projectId = "10000000-1000-4000-8000-100000000005";
const branchId = "10000000-1000-4000-8000-100000000006";
const environmentId = "10000000-1000-4000-8000-100000000007";

function createInvocation(overrides: Record<string, unknown> = {}) {
  return {
    run: {
      agentServiceId: "1-runtime-provider",
      agentId: "builder",
      conversationId,
      runId: "run_root_1",
      messageId,
      inputAnchorMessageId,
      requestedByUserId: userId,
      project: {
        projectId,
        projectSlug: "demo-project",
        runtimeTargetKind: "preview_branch",
        runtimeTargetBranchId: branchId,
      },
      validatedClaims: {
        subject: userId,
        projectId,
        projectSlug: "demo-project",
        scopes: ["agent:run"],
      },
    },
    messages: [
      { id: "user-message-1", role: "user", parts: [{ type: "text", text: "Hello" }] },
      {
        id: "tool-message-1",
        role: "tool",
        parts: [{ type: "tool_result", output: { ok: true } }],
      },
    ],
    tools: [{
      name: "studio_focus_component",
      description: "Focus the selected component",
      inputSchema: {
        type: "object",
        properties: {
          componentId: { type: "string" },
        },
      },
    }],
    context: [{ type: "text", text: "Current file: app.tsx" }],
    credentials: { authToken: "request-scoped-user-token" },
    agentSource: { type: "branch", branch: "main" },
    forwardedProps: { activeChatId: "chat_123" },
    ...overrides,
  };
}

describe("agent/runtime-agent-invocation-contract", () => {
  it("keeps an exact pending tool invocation in the trusted envelope", () => {
    const parsed = RuntimeAgentRunInvocationSchema.parse(createInvocation({
      resumeToolCall: {
        id: `${"x".repeat(128)}:resume-1`,
        name: "outlook__list_messages",
        input: { folder: "inbox", limit: 20 },
      },
    }));

    assertEquals(parsed.resumeToolCall, {
      id: `${"x".repeat(128)}:resume-1`,
      name: "outlook__list_messages",
      input: { folder: "inbox", limit: 20 },
    });
  });

  it("rejects unsupported resume JSON in signed runtime envelopes", () => {
    let deepInput: Record<string, unknown> = { value: null };
    for (let depth = 0; depth < 127; depth++) deepInput = { value: deepInput };
    for (const input of [deepInput, { values: Array.from({ length: 99_995 }, () => null) }]) {
      const parsed = RuntimeAgentRunInvocationSchema.safeParse(createInvocation({
        resumeToolCall: { id: "call-1:resume-1", name: "outlook__list_messages", input },
      }));
      assertEquals(parsed.success, false);
      if (parsed.success) throw new Error("Expected structural validation failure");
      assertInstanceOf(parsed.error, Error);
      assertStringIncludes(parsed.error.message, "resumeToolCall");
    }
  });

  it("preserves separate execution and immutable source projects", () => {
    const sourceProject = {
      projectId: "20000000-1000-4000-8000-100000000005",
      projectSlug: "source-project",
      runtimeTargetKind: "environment",
      runtimeTargetEnvironmentId: environmentId,
    } as const;
    const parsed = RuntimeAgentRunInvocationSchema.parse(createInvocation({
      sourceProject,
      run: {
        ...createInvocation().run,
        project: { ...createInvocation().run.project, runtimeTargetBranchName: "feature-a" },
      },
      agentSource: { type: "environment", environmentName: "production", releaseId: "release-1" },
      credentials: { authToken: "execution-token", sourceAuthToken: "source-read-token" },
    }));
    const request = buildRuntimeAgentControlPlaneStreamRequestFromInvocation(parsed);
    assertEquals(parsed.run.project.projectId, projectId);
    assertEquals(request.sourceProject, sourceProject);
    assertEquals(request.executionProject?.projectId, projectId);
    assertEquals(request.runtimeTargetEnvironmentId, environmentId);
    assertEquals(request.credentials?.sourceAuthToken, "source-read-token");
  });

  it("rejects shared mutable branch source and missing source credentials", () => {
    const sourceProject = {
      projectId: "20000000-1000-4000-8000-100000000005",
      projectSlug: "source-project",
      runtimeTargetKind: "main_branch",
    };
    assertThrows(() => RuntimeAgentRunInvocationSchema.parse(createInvocation({ sourceProject })));
    assertThrows(() =>
      RuntimeAgentRunInvocationSchema.parse(createInvocation({
        sourceProject,
        agentSource: { type: "release", releaseId: "release-1" },
      }))
    );
  });

  it("rejects shared execution with unresolved consuming target names", () => {
    for (
      const target of [
        {},
        { runtimeTargetKind: "main_branch" },
        { runtimeTargetKind: "preview_branch", runtimeTargetBranchId: branchId },
        { runtimeTargetKind: "environment", runtimeTargetEnvironmentId: environmentId },
      ]
    ) {
      const invocation = createInvocation();
      assertThrows(() =>
        RuntimeAgentRunInvocationSchema.parse({
          ...invocation,
          run: {
            ...invocation.run,
            project: { projectId, projectSlug: "demo-project", ...target },
          },
          sourceProject: {
            projectId: "20000000-1000-4000-8000-100000000005",
            projectSlug: "source",
            runtimeTargetKind: "main_branch",
          },
          agentSource: { type: "release", releaseId: "release-1" },
          credentials: { authToken: "execution-token", sourceAuthToken: "source-read-token" },
        })
      );
    }
  });

  it("preserves a consuming project's nonstandard default branch for shared execution", () => {
    const invocation = createInvocation();
    const parsed = RuntimeAgentRunInvocationSchema.parse({
      ...invocation,
      run: {
        ...invocation.run,
        project: {
          projectId,
          projectSlug: "demo-project",
          runtimeTargetKind: "main_branch",
          runtimeTargetBranchName: "trunk",
        },
      },
      sourceProject: {
        projectId: "20000000-1000-4000-8000-100000000005",
        projectSlug: "source",
        runtimeTargetKind: "main_branch",
      },
      agentSource: { type: "release", releaseId: "release-1" },
      credentials: { authToken: "execution-token", sourceAuthToken: "source-read-token" },
    });
    assertEquals(
      buildRuntimeAgentControlPlaneStreamRequestFromInvocation(parsed).executionProject
        ?.runtimeTargetBranchName,
      "trunk",
    );
  });

  it("keeps the legacy control-plane request shape source-compatible", () => {
    const request: RuntimeAgentControlPlaneStreamRequest = {
      agentId: "builder",
      threadId: conversationId,
      runId: "run_legacy_1",
      messages: [],
      tools: [],
      context: [],
      runtimeTargetKind: "main_branch",
      agentSource: { type: "branch", branch: "main" },
    };

    assertEquals(request.messageId, undefined);
  });

  it("exports the control-plane runtime agent invocation schema from veryfront/agent", () => {
    const parsed = RuntimeAgentRunInvocationSchema.parse(createInvocation());

    assertEquals(parsed.run.agentServiceId, "1-runtime-provider");
    assertEquals(parsed.run.project.runtimeTargetKind, "preview_branch");
    assertEquals(parsed.run.validatedClaims?.scopes, ["agent:run"]);
    assertEquals(parsed.messages.length, 2);
    assertEquals(parsed.tools[0]?.name, "studio_focus_component");
    assertEquals(parsed.credentials?.authToken, "request-scoped-user-token");
    assertEquals(parsed.credentials?.inferenceAuthToken, undefined);
  });

  it("accepts a separate bounded inference credential without changing legacy calls", () => {
    const parsed = RuntimeAgentRunInvocationSchema.parse(createInvocation({
      credentials: {
        authToken: "request-scoped-user-token",
        inferenceAuthToken: "run-scoped-inference-token",
      },
    }));
    const request = buildRuntimeAgentControlPlaneStreamRequestFromInvocation(parsed);

    assertEquals(parsed.credentials?.inferenceAuthToken, "run-scoped-inference-token");
    assertEquals(request.credentials?.authToken, "request-scoped-user-token");
    assertEquals(request.credentials?.inferenceAuthToken, "run-scoped-inference-token");
  });

  it("bounds runtime credentials by UTF-8 bytes", () => {
    const exactByteLimit = "x".repeat(16_384);
    const overByteLimit = "x".repeat(16_385);
    const legacyOverByteLimit = "é".repeat(8_193);

    const parsed = RuntimeAgentRunInvocationSchema.parse(createInvocation({
      credentials: {
        authToken: exactByteLimit,
        inferenceAuthToken: exactByteLimit,
      },
    }));
    assertEquals(parsed.credentials?.authToken, exactByteLimit);
    assertEquals(parsed.credentials?.inferenceAuthToken, exactByteLimit);

    const legacyParsed = RuntimeAgentRunInvocationSchema.parse(createInvocation({
      credentials: { authToken: legacyOverByteLimit },
    }));
    assertEquals(legacyParsed.credentials?.authToken, legacyOverByteLimit);

    assertThrows(
      () =>
        RuntimeAgentRunInvocationSchema.parse(createInvocation({
          credentials: {
            authToken: "request-scoped-user-token",
            inferenceAuthToken: "é",
          },
        })),
      Error,
      "visible ASCII",
    );

    assertThrows(() =>
      RuntimeAgentRunInvocationSchema.parse(createInvocation({
        credentials: {
          authToken: "request-scoped-user-token",
          inferenceAuthToken: overByteLimit,
        },
      }))
    );
  });

  it("preserves explicit delegation denial across the control-plane transform", () => {
    const parsed = RuntimeAgentRunInvocationSchema.parse(createInvocation({
      allowDelegation: false,
    }));
    const request = buildRuntimeAgentControlPlaneStreamRequestFromInvocation(parsed);

    assertEquals(parsed.allowDelegation, false);
    assertEquals(request.allowDelegation, false);
  });

  it("preserves durable task identity across the control-plane transform", () => {
    const parsed = RuntimeAgentRunInvocationSchema.parse(createInvocation({
      taskId: "issue-27-veryfront-studio-agent-implementation",
    }));
    const request = buildRuntimeAgentControlPlaneStreamRequestFromInvocation(parsed);

    assertEquals(parsed.taskId, "issue-27-veryfront-studio-agent-implementation");
    assertEquals(request.taskId, "issue-27-veryfront-studio-agent-implementation");
  });

  it("rejects malformed durable task identity at the runtime boundary", () => {
    assertThrows(
      () => RuntimeAgentRunInvocationSchema.parse(createInvocation({ taskId: "issue 27" })),
      Error,
      "taskId",
    );
  });

  it("accepts main branch runtime targets without branch or environment selectors", () => {
    const parsed = RuntimeAgentRunInvocationSchema.parse(createInvocation({
      run: {
        agentServiceId: "1-runtime-provider",
        agentId: "builder",
        conversationId,
        runId: "run_root_1",
        messageId,
        inputAnchorMessageId,
        requestedByUserId: userId,
        project: {
          projectId,
          projectSlug: "demo-project",
          runtimeTargetKind: "main_branch",
        },
        validatedClaims: {
          subject: userId,
          projectId,
          projectSlug: "demo-project",
          scopes: ["agent:run"],
        },
      },
    }));

    assertEquals(parsed.run.project.runtimeTargetKind, "main_branch");
    const nonMainDefault = RuntimeAgentRunInvocationSchema.parse(createInvocation({
      agentSource: { type: "branch", branch: "trunk" },
    }));
    assertEquals(nonMainDefault.agentSource, { type: "branch", branch: "trunk" });
    assertThrows(() =>
      RuntimeAgentRunInvocationSchema.parse(createInvocation({
        run: {
          agentServiceId: "1-runtime-provider",
          agentId: "builder",
          conversationId,
          runId: "run_root_1",
          messageId,
          inputAnchorMessageId,
          requestedByUserId: userId,
          project: {
            projectId,
            projectSlug: "demo-project",
            runtimeTargetKind: "main_branch",
            runtimeTargetBranchId: branchId,
          },
        },
      }))
    );
  });

  it("requires an immutable release for environment agent sources", () => {
    const unpinned = createInvocation({
      run: {
        ...createInvocation().run,
        project: {
          projectId,
          projectSlug: "demo-project",
          runtimeTargetKind: "environment",
          runtimeTargetEnvironmentId: environmentId,
        },
      },
      agentSource: {
        type: "environment",
        environmentName: "Production",
      },
    });
    assertThrows(
      () => RuntimeAgentRunInvocationSchema.parse(unpinned),
      Error,
      "releaseId",
      "environment agent sources must be pinned to an immutable release",
    );
    const unpinnedResult = RuntimeAgentRunInvocationSchema.safeParse(unpinned);
    assertEquals(
      unpinnedResult.success ? [] : unpinnedResult.issues.map((issue) => issue.path),
      [["agentSource", "releaseId"]],
      "the only rejection must be the missing releaseId, not the target binding rule",
    );

    const parsed = RuntimeAgentRunInvocationSchema.parse(createInvocation({
      run: {
        ...createInvocation().run,
        project: {
          projectId,
          projectSlug: "demo-project",
          runtimeTargetKind: "environment",
          runtimeTargetEnvironmentId: environmentId,
        },
      },
      agentSource: {
        type: "environment",
        environmentName: "Production",
        releaseId: "release-1",
      },
    }));

    assertEquals(parsed.agentSource, {
      type: "environment",
      environmentName: "Production",
      releaseId: "release-1",
    });
  });

  it("rejects agent sources that do not match the selected runtime target", () => {
    assertThrows(
      () =>
        RuntimeAgentRunInvocationSchema.parse(createInvocation({
          run: {
            ...createInvocation().run,
            project: {
              projectId,
              projectSlug: "demo-project",
              runtimeTargetKind: "environment",
              runtimeTargetEnvironmentId: environmentId,
            },
          },
          agentSource: { type: "branch", branch: "main" },
        })),
      Error,
      "environment runtime target requires an environment agent source",
    );
  });

  it("rejects a release agent source outside a main-branch runtime target", () => {
    assertThrows(
      () =>
        RuntimeAgentRunInvocationSchema.parse(createInvocation({
          agentSource: { type: "release", releaseId: "release-1" },
        })),
      Error,
      "release agent source requires a main-branch runtime target",
      "a release source must not bind to a preview branch target",
    );

    assertThrows(
      () =>
        RuntimeAgentRunInvocationSchema.parse(createInvocation({
          run: {
            ...createInvocation().run,
            project: {
              projectId,
              projectSlug: "demo-project",
              runtimeTargetKind: "environment",
              runtimeTargetEnvironmentId: environmentId,
            },
          },
          agentSource: { type: "release", releaseId: "release-1" },
        })),
      Error,
      "release agent source requires a main-branch runtime target",
      "a release source must not bind to an environment target",
    );
  });

  it("accepts a release agent source on a main-branch runtime target", () => {
    const parsed = RuntimeAgentRunInvocationSchema.parse(createInvocation({
      run: {
        ...createInvocation().run,
        project: { projectId, projectSlug: "demo-project" },
      },
      agentSource: { type: "release", releaseId: "release-1" },
    }));

    assertEquals(
      parsed.agentSource,
      { type: "release", releaseId: "release-1" },
      "a release source must bind to a main-branch target",
    );
    const request = buildRuntimeAgentControlPlaneStreamRequestFromInvocation(parsed);
    assertEquals(
      request.agentSource,
      { type: "release", releaseId: "release-1" },
      "the release source must reach the control-plane request unchanged",
    );
  });

  it("requires an exact source for every runtime invocation", () => {
    const result = RuntimeAgentRunInvocationSchema.safeParse(
      createInvocation({ agentSource: undefined }),
    );
    assertEquals(
      result.success,
      false,
      "an invocation without an agentSource must be rejected by validation",
    );
    assertEquals(
      result.success
        ? false
        : result.issues.some((issue) =>
          issue.path.join(".") === "agentSource" && issue.code === "invalid_type"
        ),
      true,
      "a missing agentSource must surface as an invalid_type issue on agentSource, not a refinement crash",
    );
  });

  it("enforces child-run lineage before invoking a runtime agent service", () => {
    const parsed = RuntimeAgentRunInvocationSchema.parse(createInvocation({
      run: {
        agentServiceId: "veryfront-platform-agent",
        agentId: "builder",
        conversationId,
        runId: "run_child_1",
        messageId,
        inputAnchorMessageId,
        requestedByUserId: userId,
        project: {
          projectId,
          projectSlug: "demo-project",
        },
        parentRunId: "run_root_1",
        spawnedFromToolCallId: "tool_1",
      },
    }));

    assertEquals(parsed.run.parentRunId, "run_root_1");

    assertThrows(() =>
      RuntimeAgentRunInvocationSchema.parse(createInvocation({
        run: {
          agentServiceId: "veryfront-platform-agent",
          agentId: "builder",
          conversationId,
          runId: "run_root_1",
          messageId,
          inputAnchorMessageId,
          requestedByUserId: userId,
          project: {
            projectId,
            projectSlug: "demo-project",
          },
          parentRunId: "run_root_1",
        },
      }))
    );

    assertThrows(() =>
      RuntimeAgentRunInvocationSchema.parse(createInvocation({
        run: {
          agentServiceId: "veryfront-platform-agent",
          agentId: "builder",
          conversationId,
          runId: "run_child_1",
          messageId,
          inputAnchorMessageId,
          requestedByUserId: userId,
          project: {
            projectId,
            projectSlug: "demo-project",
          },
          spawnedFromToolCallId: "tool_1",
        },
      }))
    );
  });

  it("rejects project claims that do not match the selected project context", () => {
    assertThrows(() =>
      RuntimeAgentRunInvocationSchema.parse(createInvocation({
        run: {
          agentServiceId: "veryfront-platform-agent",
          agentId: "builder",
          conversationId,
          runId: "run_root_1",
          messageId,
          inputAnchorMessageId,
          requestedByUserId: userId,
          project: {
            projectId,
            projectSlug: "demo-project",
          },
          validatedClaims: {
            subject: userId,
            projectId: "10000000-1000-4000-8000-100000000007",
          },
        },
      }))
    );
  });

  it("builds the control-plane stream request from a runtime invocation", () => {
    const parsed = RuntimeAgentRunInvocationSchema.parse(createInvocation({
      run: {
        agentServiceId: "veryfront-platform-agent",
        agentId: "builder",
        conversationId,
        runId: "run_child_1",
        messageId,
        inputAnchorMessageId,
        requestedByUserId: userId,
        project: {
          projectId,
          projectSlug: "demo-project",
          runtimeTargetKind: "preview_branch",
          runtimeTargetBranchId: branchId,
        },
        parentRunId: "run_root_1",
      },
    }));

    const request = buildRuntimeAgentControlPlaneStreamRequestFromInvocation(parsed);

    assertEquals(request, {
      agentId: "builder",
      threadId: conversationId,
      runId: "run_child_1",
      messageId,
      parentRunId: "run_root_1",
      messages: parsed.messages,
      tools: parsed.tools,
      context: parsed.context,
      runtimeTargetKind: "preview_branch",
      runtimeTargetEnvironmentId: null,
      runtimeTargetBranchId: branchId,
      credentials: parsed.credentials,
      agentSource: parsed.agentSource,
      forwardedProps: parsed.forwardedProps,
    });
  });

  it("preserves the verified target environment on control-plane stream requests", () => {
    const parsed = RuntimeAgentRunInvocationSchema.parse(createInvocation({
      run: {
        agentServiceId: "veryfront-platform-agent",
        agentId: "builder",
        conversationId,
        runId: "run_root_1",
        messageId,
        inputAnchorMessageId,
        requestedByUserId: userId,
        project: {
          projectId,
          projectSlug: "demo-project",
          runtimeTargetKind: "environment",
          runtimeTargetEnvironmentId: environmentId,
        },
      },
      agentSource: {
        type: "environment",
        environmentName: "Production",
        releaseId: "release-1",
      },
    }));

    const request = buildRuntimeAgentControlPlaneStreamRequestFromInvocation(parsed);

    assertEquals(request.runtimeTargetEnvironmentId, environmentId);
    assertEquals(request.runtimeTargetBranchId, null);
  });

  it("preserves the selected project agent config on control-plane stream requests", () => {
    const parsed = RuntimeAgentRunInvocationSchema.parse(createInvocation({
      agentConfig: {
        id: "builder",
        name: "Builder",
        description: "Builds with project skills.",
        instructions: "Use project skills.",
        skills: ["support-triage"],
        tools: ["search_knowledge", "get_file"],
      },
    }));

    const request = buildRuntimeAgentControlPlaneStreamRequestFromInvocation(parsed);

    assertEquals(request.agentConfig, {
      id: "builder",
      name: "Builder",
      description: "Builds with project skills.",
      instructions: "Use project skills.",
      skills: ["support-triage"],
      tools: ["search_knowledge", "get_file"],
    });
  });

  it("maps an authored deny-all agent config to an empty selector with a provider-only allowlist", () => {
    const parsed = parseRuntimeAgentRunInvocationValue(createInvocation({
      agentConfig: {
        id: "builder",
        name: "Builder",
        description: "Runs without host tools.",
        instructions: "Answer directly.",
        skills: ["support-triage"],
        tools: false,
        providerTools: ["web_search", "code_execution"],
        bootstrapTools: ["load_skill"],
        bootstrapSkill: "support-triage",
      },
      forwardedProps: {
        activeChatId: "chat_123",
        runtimeOverrides: { allowedTools: ["studio_focus_component", "web_search"] },
      },
    }));

    assertEquals(parsed.agentConfig?.tools, []);
    assertEquals(parsed.agentConfig?.providerTools, ["web_search", "code_execution"]);
    assertEquals(parsed.agentConfig?.skills, []);
    assertEquals(parsed.agentConfig?.bootstrapTools, undefined);
    assertEquals(parsed.agentConfig?.bootstrapSkill, undefined);
    assertEquals(parsed.forwardedProps, {
      activeChatId: "chat_123",
      runtimeOverrides: { allowedTools: ["web_search"], toolAllowlist: ["web_search"] },
    });
  });

  it("gives a deny-all agent without provider tools an explicit empty allowlist", () => {
    const parsed = safeParseRuntimeAgentRunInvocationValue(createInvocation({
      agentConfig: {
        id: "builder",
        name: "Builder",
        description: "Runs without host tools.",
        instructions: "Answer directly.",
        tools: false,
      },
      forwardedProps: undefined,
    }));

    assertEquals(parsed.success, true);
    if (!parsed.success) return;
    assertEquals(parsed.data.agentConfig?.tools, []);
    assertEquals(parsed.data.forwardedProps, {
      runtimeOverrides: { allowedTools: [], toolAllowlist: [] },
    });
  });

  function denyAllConfig(extra: Record<string, unknown> = {}) {
    return {
      id: "builder",
      name: "Builder",
      description: "Runs without host tools.",
      instructions: "Answer directly.",
      tools: false,
      ...extra,
    };
  }

  it("fails closed when a deny-all allowlist would exceed the override limit", () => {
    const providerTools = Array.from({ length: 101 }, (_, index) => `provider_tool_${index}`);
    const invocation = createInvocation({
      agentConfig: denyAllConfig({ providerTools }),
      forwardedProps: undefined,
    });

    const parsed = safeParseRuntimeAgentRunInvocationValue(invocation);
    assertEquals(parsed.success, false);
    const error = assertThrows(() => parseRuntimeAgentRunInvocationValue(invocation));
    assertStringIncludes(String(error), "tools: false requires valid");
  });

  it("deduplicates deny-all provider tools before applying the override limit", () => {
    const providerTools = Array.from({ length: 150 }, () => "web_search");
    const parsed = parseRuntimeAgentRunInvocationValue(createInvocation({
      agentConfig: denyAllConfig({ providerTools }),
      forwardedProps: undefined,
    }));

    assertEquals(parsed.forwardedProps, {
      runtimeOverrides: { allowedTools: ["web_search"], toolAllowlist: ["web_search"] },
    });
  });

  it("fails closed when a deny-all invocation carries an invalid sibling override", () => {
    const invalidOverrides: unknown[] = [
      { maxSteps: 0 },
      { thinking: -1 },
      { maxOutputTokens: 1.5 },
      "all-tools",
      [],
    ];
    for (const runtimeOverrides of invalidOverrides) {
      const parsed = safeParseRuntimeAgentRunInvocationValue(createInvocation({
        agentConfig: denyAllConfig({ providerTools: ["web_search"] }),
        forwardedProps: { runtimeOverrides },
      }));
      assertEquals(parsed.success, false, `accepted ${JSON.stringify(runtimeOverrides)}`);
    }
  });

  it("rejects malformed deny-all forwardedProps instead of replacing them", () => {
    for (const forwardedProps of [null, [], "props"]) {
      const parsed = safeParseRuntimeAgentRunInvocationValue(createInvocation({
        agentConfig: denyAllConfig({ providerTools: ["web_search"] }),
        forwardedProps,
      }));
      assertEquals(parsed.success, false, `accepted ${JSON.stringify(forwardedProps)}`);
    }
  });

  it("drops deny-all provider tools that collide with host tool names", () => {
    const parsed = parseRuntimeAgentRunInvocationValue(createInvocation({
      agentConfig: denyAllConfig({
        skills: ["support-triage"],
        knowledge: true,
        providerTools: [
          "invoke_agent",
          "veryfront__invoke_agent",
          "search_knowledge",
          "load_skill",
          "tool_search",
          "form_input",
          "agent_researcher",
          "web_fetch",
          "web_search",
        ],
      }),
      forwardedProps: undefined,
    }));

    assertEquals(parsed.agentConfig?.tools, []);
    assertEquals(parsed.forwardedProps, {
      runtimeOverrides: { allowedTools: ["web_search"], toolAllowlist: ["web_search"] },
    });
  });

  it("rejects malformed caller allowlists on a deny-all invocation", () => {
    const malformed: Array<Record<string, unknown>> = [
      { allowedTools: "none" },
      { allowedTools: ["web_search", 1] },
      { toolAllowlist: "none" },
      { toolAllowlist: [null] },
    ];
    for (const runtimeOverrides of malformed) {
      const parsed = safeParseRuntimeAgentRunInvocationValue(createInvocation({
        agentConfig: denyAllConfig({ providerTools: ["web_search"] }),
        forwardedProps: { runtimeOverrides },
      }));
      assertEquals(parsed.success, false, `accepted ${JSON.stringify(runtimeOverrides)}`);
    }
  });

  it("restricts agent-stream runs through toolAllowlist and narrows by a caller toolAllowlist", () => {
    const parsed = parseRuntimeAgentRunInvocationValue(createInvocation({
      agentConfig: denyAllConfig({ providerTools: ["web_search", "code_execution"] }),
      forwardedProps: { runtimeOverrides: { toolAllowlist: ["code_execution", "get_file"] } },
    }));
    assertEquals(parsed.forwardedProps, {
      runtimeOverrides: { allowedTools: ["code_execution"], toolAllowlist: ["code_execution"] },
    });
  });

  it("removes caller-injected tools from a deny-all invocation", () => {
    const parsed = parseRuntimeAgentRunInvocationValue(createInvocation({
      agentConfig: denyAllConfig({ providerTools: ["web_search"] }),
      tools: [
        { name: "web_search", description: "Injected caller tool", parameters: {} },
        { name: "studio_focus_component", description: "Injected UI tool", parameters: {} },
      ],
      forwardedProps: undefined,
    }));

    assertEquals(parsed.tools, []);
    assertEquals(parsed.forwardedProps, {
      runtimeOverrides: { allowedTools: ["web_search"], toolAllowlist: ["web_search"] },
    });
  });

  it("clears remote tool sources from a deny-all invocation", () => {
    const parsed = parseRuntimeAgentRunInvocationValue(createInvocation({
      agentConfig: denyAllConfig({
        providerTools: ["get_file"],
        mcpServers: [{ kind: "veryfront-api", toolPolicy: { allow: ["get_file"] } }],
      }),
      forwardedProps: {
        runtimeOverrides: {
          integrationToolDefinitions: [{ name: "get_file", description: "Integration tool" }],
          serverResolvedIntegrationTools: [{ name: "get_file" }],
        },
      },
    }));

    assertEquals(parsed.agentConfig?.mcpServers, []);
    assertEquals(parsed.forwardedProps, {
      runtimeOverrides: { allowedTools: ["get_file"], toolAllowlist: ["get_file"] },
    });
  });

  it("rejects a deny-all config that is oversized only through an unknown field", () => {
    const parsed = safeParseRuntimeAgentRunInvocationValue(createInvocation({
      agentConfig: denyAllConfig({
        providerTools: ["web_search"],
        unknownPadding: "x".repeat(70_000),
      }),
      tools: [{ name: "web_search", description: "Injected caller tool", parameters: {} }],
      forwardedProps: {
        runtimeOverrides: { allowedTools: ["web_search"], toolAllowlist: ["web_search"] },
      },
    }));
    assertEquals(parsed.success, false);
  });

  it("disables the tool-result reader for a deny-all agent", () => {
    const parsed = parseRuntimeAgentRunInvocationValue(createInvocation({
      agentConfig: denyAllConfig({
        providerTools: ["web_search"],
        toolResultContext: { maxInlineBytes: 1_024 },
      }),
      forwardedProps: undefined,
    }));
    assertEquals(parsed.agentConfig?.toolResultContext, false);

    const invalid = safeParseRuntimeAgentRunInvocationValue(createInvocation({
      agentConfig: denyAllConfig({ toolResultContext: { maxInlineBytes: 0 } }),
      forwardedProps: undefined,
    }));
    assertEquals(invalid.success, false);
  });

  it("enforces the forwardedProps size cap before discarding deny-all remote sources", () => {
    const padding = "x".repeat(200_000);
    for (
      const key of ["integrationToolDefinitions", "serverResolvedIntegrationTools", "toolAllowlist"]
    ) {
      const parsed = safeParseRuntimeAgentRunInvocationValue(createInvocation({
        agentConfig: denyAllConfig({ providerTools: ["web_search"] }),
        forwardedProps: {
          runtimeOverrides: { [key]: [{ name: "web_search", description: padding }] },
        },
      }));
      assertEquals(parsed.success, false, `accepted oversized ${key}`);
    }
  });

  it("rejects malformed caller-injected tools on a deny-all invocation instead of clearing them", () => {
    for (const tools of ["web_search", [{ description: "missing name" }]]) {
      const parsed = safeParseRuntimeAgentRunInvocationValue(createInvocation({
        agentConfig: denyAllConfig({ providerTools: ["web_search"] }),
        tools,
      }));
      assertEquals(parsed.success, false, `accepted ${JSON.stringify(tools)}`);
    }
  });

  it("validates deny-all agent config fields before discarding them", () => {
    const invalidFields: Array<Record<string, unknown>> = [
      { bootstrapTools: Array.from({ length: 17 }, (_, index) => `tool_${index}`) },
      { bootstrapSkill: "s".repeat(257) },
      { bootstrapSkill: "" },
      { skills: 5 },
      { skills: [""] },
      { skills: Array.from({ length: 70 }, () => "s".repeat(1_024)) },
    ];
    for (const fields of invalidFields) {
      const parsed = safeParseRuntimeAgentRunInvocationValue(createInvocation({
        agentConfig: denyAllConfig({ providerTools: ["web_search"], ...fields }),
        forwardedProps: undefined,
      }));
      assertEquals(parsed.success, false, `accepted ${Object.keys(fields).join(",")}`);
    }
  });

  it("validates the caller allowlist against the override contract before intersecting it", () => {
    const invalidOverrides: Array<Record<string, unknown>> = [
      { allowedTools: Array.from({ length: 101 }, () => "web_search") },
      { allowedTools: [""] },
      { allowedTools: ["web_search", ""] },
    ];
    for (const runtimeOverrides of invalidOverrides) {
      const parsed = safeParseRuntimeAgentRunInvocationValue(createInvocation({
        agentConfig: denyAllConfig({ providerTools: ["web_search"] }),
        forwardedProps: { runtimeOverrides },
      }));
      assertEquals(parsed.success, false, `accepted ${JSON.stringify(runtimeOverrides)}`);
    }
  });

  it("intersects large disjoint deny-all allowlists to an empty allowlist", () => {
    const providerTools = Array.from({ length: 3_000 }, (_, index) => `p${index}`);
    const toolAllowlist = Array.from({ length: 5_000 }, (_, index) => `caller_${index}`);
    const parsed = parseRuntimeAgentRunInvocationValue(createInvocation({
      agentConfig: denyAllConfig({ providerTools }),
      forwardedProps: { runtimeOverrides: { toolAllowlist } },
    }));
    assertEquals(parsed.forwardedProps, {
      runtimeOverrides: { allowedTools: [], toolAllowlist: [] },
    });
  });

  it("leaves non-deny agent tool selections unchanged", () => {
    const selections: Array<true | string[]> = [[], ["get_file"], true];
    for (const tools of selections) {
      const parsed = parseRuntimeAgentRunInvocationValue(createInvocation({
        agentConfig: {
          id: "builder",
          name: "Builder",
          description: "Builds with project skills.",
          instructions: "Use project skills.",
          tools,
          bootstrapSkill: "support-triage",
        },
      }));

      assertEquals(parsed.agentConfig?.tools, tools);
      assertEquals(parsed.agentConfig?.bootstrapSkill, "support-triage");
      assertEquals(parsed.forwardedProps, { activeChatId: "chat_123" });
    }
  });

  it("rejects request-scoped agent config for a different agent", () => {
    assertThrows(
      () =>
        RuntimeAgentRunInvocationSchema.parse(createInvocation({
          agentConfig: {
            id: "other-agent",
            name: "Other Agent",
            description: "Does not match the requested agent.",
            instructions: "Use other instructions.",
          },
        })),
      Error,
      "agentConfig.id must match run.agentId",
    );
  });

  it("rejects oversized request-scoped agent config", () => {
    assertThrows(
      () =>
        RuntimeAgentRunInvocationSchema.parse(createInvocation({
          agentConfig: {
            id: "builder",
            name: "Builder",
            description: "Builds with project skills.",
            instructions: "x".repeat(70_000),
          },
        })),
      Error,
      "agentConfig must be less than 64 KB",
    );
  });

  it("parses runtime agent invocation request bodies through the public helper", async () => {
    const parsed = await parseRuntimeAgentRunInvocation(
      new Request("http://localhost/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createInvocation()),
      }),
    );

    assertEquals(parsed.run.runId, "run_root_1");
    assertEquals(parsed.context.length, 1);
  });

  it("keeps the default body limit on runtime agent invocation requests", async () => {
    const result = await parseRuntimeAgentRunInvocationOrError(
      new Request("http://localhost/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createInvocation({
          serverResolvedProviderReplayCheckpoints: [{
            version: 1,
            messageId: "assistant-message-1",
            provider: "anthropic",
            providerBlocks: [{
              type: "provider-block",
              provider: "anthropic",
              block: {
                type: "thinking",
                thinking: "x".repeat(DEFAULT_LIMITS.maxBodySize),
                signature: "sig-private-large",
              },
            }],
            providerBlockPositions: [0],
            totalPartCount: 1,
          }],
        })),
      }),
    );

    assertInstanceOf(result, Response);
    assertEquals(result.status, 413);
  });

  it("returns a 400 response for malformed runtime agent invocation payloads", async () => {
    const result = await parseRuntimeAgentRunInvocationOrError(
      new Request("http://localhost/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run: { runId: "run_1" } }),
      }),
    );

    assertInstanceOf(result, Response);
    assertEquals(result.status, 400);
    const body = await result.json();
    assertEquals(body.error, "Invalid runtime agent invocation");
    assertEquals(Array.isArray(body.details), true);
  });
});
