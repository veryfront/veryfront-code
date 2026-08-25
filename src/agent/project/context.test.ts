import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  applyAgentProjectContextChange,
  createUnconfirmedProjectContextSwitchResult,
  getConfirmedProjectContextSwitch,
  getConfirmedProjectContextSwitchId,
  isClaimedSuccessfulProjectContextSwitchResult,
  type MutableAgentProjectContext,
  normalizeAgentProjectIdentity,
  PROJECT_CONTEXT_SWITCH_UNCONFIRMED_ERROR_CODE,
  PROJECT_CONTEXT_SWITCH_UNCONFIRMED_MESSAGE,
} from "./context.ts";
import {
  MAX_OPAQUE_ID_CODE_UNITS,
  MAX_PROJECT_SLUG_CODE_UNITS,
} from "#veryfront/utils/constants/project-identity.ts";

Deno.test("applyAgentProjectContextChange updates project and resets branch and skill context", () => {
  const context: MutableAgentProjectContext & { steeringRevision: number } = {
    projectId: "project-1",
    projectSlug: "project-one",
    branchId: "branch-1",
    availableSkillIds: ["skill-a"],
    skillSelectorPolicy: { kind: "allowlist", entries: ["skill-a"] },
    skillSourcePaths: { "skill-a": "skills/skill-a/SKILL.md" },
    steeringRevision: 3,
  };

  const changed = applyAgentProjectContextChange(context, "project-2", " project-two ");

  assertEquals(changed, true);
  assertEquals(context, {
    projectId: "project-2",
    projectSlug: "project-two",
    branchId: null,
    runtimeTargetKind: "main_branch",
    runtimeTargetEnvironmentId: null,
    availableSkillIds: undefined,
    skillSelectorPolicy: { kind: "allowlist", entries: ["skill-a"] },
    skillSourcePaths: undefined,
    steeringRevision: 3,
  });
});

Deno.test("applyAgentProjectContextChange clears a stale slug when the new slug is unproved", () => {
  const context: MutableAgentProjectContext = {
    projectId: "project-1",
    projectSlug: "project-one",
    branchId: "branch-1",
  };

  const changed = applyAgentProjectContextChange(context, "project-2");

  assertEquals(changed, true);
  assertEquals(context, {
    projectId: "project-2",
    branchId: null,
    runtimeTargetKind: "main_branch",
    runtimeTargetEnvironmentId: null,
    availableSkillIds: undefined,
    skillSourcePaths: undefined,
  });
});

Deno.test("applyAgentProjectContextChange leaves context unchanged when project is already active", () => {
  const context: MutableAgentProjectContext = {
    projectId: "project-1",
    branchId: "branch-1",
    availableSkillIds: ["skill-a"],
  };

  const changed = applyAgentProjectContextChange(context, "project-1");

  assertEquals(changed, false);
  assertEquals(context, {
    projectId: "project-1",
    branchId: "branch-1",
    availableSkillIds: ["skill-a"],
  });
});

Deno.test("applyAgentProjectContextChange fails closed on unsafe project identities", () => {
  for (const unsafeProjectId of [" project-2", "project-\n2"]) {
    const context: MutableAgentProjectContext = {
      projectId: "project-1",
      projectSlug: "project-one",
      branchId: "branch-1",
    };

    const changed = applyAgentProjectContextChange(context, unsafeProjectId);

    assertEquals(changed, false, "an unsafe project reference must not switch the active project");
    assertEquals(
      context,
      {
        projectId: "project-1",
        projectSlug: "project-one",
        branchId: "branch-1",
      },
      "a rejected switch must leave the context object untouched",
    );
  }
});

Deno.test("applyAgentProjectContextChange refreshes a newly proved slug for the active project", () => {
  const context: MutableAgentProjectContext = {
    projectId: "project-1",
    projectSlug: "old-slug",
    branchId: "branch-1",
    availableSkillIds: ["skill-a"],
  };

  const changed = applyAgentProjectContextChange(context, "project-1", " new-slug ");

  assertEquals(changed, true, "a newly proved slug for the active project is a change");
  assertEquals(
    context,
    {
      projectId: "project-1",
      projectSlug: "new-slug",
      branchId: "branch-1",
      availableSkillIds: ["skill-a"],
    },
    "a slug refresh normalizes the slug without resetting branch or skill state",
  );
});

Deno.test("getConfirmedProjectContextSwitchId reads matching successful structured content", () => {
  assertEquals(
    getConfirmedProjectContextSwitchId(
      {
        structuredContent: {
          success: true,
          project_id: "project-2",
        },
      },
      "project-2",
    ),
    "project-2",
  );
});

Deno.test("getConfirmedProjectContextSwitchId confirms slug requests from returned slug and UUID", () => {
  assertEquals(
    getConfirmedProjectContextSwitchId(
      {
        structuredContent: {
          success: true,
          project_id: "11111111-1111-4111-8111-111111111111",
          slug: "demo-project",
        },
      },
      "demo-project",
    ),
    "11111111-1111-4111-8111-111111111111",
  );
});

Deno.test("getConfirmedProjectContextSwitch returns the canonical project id and normalized slug", () => {
  assertEquals(
    getConfirmedProjectContextSwitch(
      {
        structuredContent: {
          success: true,
          project_id: "11111111-1111-4111-8111-111111111111",
          slug: " demo-project ",
        },
      },
      "demo-project",
    ),
    {
      projectId: "11111111-1111-4111-8111-111111111111",
      projectSlug: "demo-project",
    },
  );
});

Deno.test("getConfirmedProjectContextSwitchId reads matching successful direct content", () => {
  assertEquals(
    getConfirmedProjectContextSwitchId(
      {
        success: true,
        project_id: "project-2",
      },
      "project-2",
    ),
    "project-2",
  );
});

Deno.test("getConfirmedProjectContextSwitchId ignores failed, missing, or mismatched content", () => {
  assertEquals(
    getConfirmedProjectContextSwitchId({ success: false, project_id: "project-2" }, "project-2"),
    null,
  );
  assertEquals(getConfirmedProjectContextSwitchId({ success: true }, "project-2"), null);
  assertEquals(
    getConfirmedProjectContextSwitchId({ success: true, project_id: "project-3" }, "project-2"),
    null,
  );
  assertEquals(
    getConfirmedProjectContextSwitchId(
      { success: true, project_id: "project-3", slug: "other-project" },
      "demo-project",
    ),
    null,
  );
  assertEquals(getConfirmedProjectContextSwitchId(null, "project-2"), null);
});

Deno.test("normalizeAgentProjectIdentity preserves exact ids and normalizes canonical slugs", () => {
  assertEquals(
    normalizeAgentProjectIdentity(
      "11111111-1111-4111-8111-111111111111",
      " Demo-Project ",
    ),
    {
      projectId: "11111111-1111-4111-8111-111111111111",
      projectSlug: "Demo-Project",
    },
  );
  assertEquals(normalizeAgentProjectIdentity("project-2", "   "), {
    projectId: "project-2",
  });
  assertEquals(normalizeAgentProjectIdentity(" project-2", "project-two"), null);
});

Deno.test("getConfirmedProjectContextSwitch rejects contradictory tool-error envelopes", () => {
  const successfulContent = {
    success: true,
    project_id: "project-2",
    slug: "project-two",
  };
  const erroredResults = [
    { isError: true, structuredContent: successfulContent },
    { error: "tool_error", structuredContent: successfulContent },
    { success: false, structuredContent: successfulContent },
    { output: { isError: true }, structuredContent: successfulContent },
    {
      structuredContent: {
        ...successfulContent,
        error: "tool_error",
      },
    },
  ];

  for (const result of erroredResults) {
    assertEquals(getConfirmedProjectContextSwitch(result, "project-two"), null);
    assertEquals(isClaimedSuccessfulProjectContextSwitchResult(result), false);
  }
});

Deno.test("getConfirmedProjectContextSwitch rejects malformed or unbounded identities", () => {
  const invalidIdentities = [
    { project_id: "" },
    { project_id: "   " },
    { project_id: " project-2" },
    { project_id: "project-\n2" },
    { project_id: "p".repeat(MAX_OPAQUE_ID_CODE_UNITS + 1) },
    { project_id: "project-2", slug: "project/\ntwo" },
    { project_id: "project-2", slug: "project/two" },
    { project_id: "project-2", slug: "two projects" },
    { project_id: "project-2", slug: "s".repeat(MAX_PROJECT_SLUG_CODE_UNITS + 1) },
    { project_id: "project-2", slug: 42 },
  ];

  for (const identity of invalidIdentities) {
    const result = { structuredContent: { success: true, ...identity } };
    assertEquals(getConfirmedProjectContextSwitch(result), null);
    assertEquals(isClaimedSuccessfulProjectContextSwitchResult(result), true);
  }
});

Deno.test("getConfirmedProjectContextSwitch compares the exact id or normalized slug", () => {
  const result = {
    structuredContent: {
      success: true,
      project_id: "11111111-1111-4111-8111-111111111111",
      slug: " demo-project ",
    },
  };

  assertEquals(
    getConfirmedProjectContextSwitch(result, "11111111-1111-4111-8111-111111111111"),
    {
      projectId: "11111111-1111-4111-8111-111111111111",
      projectSlug: "demo-project",
    },
  );
  assertEquals(getConfirmedProjectContextSwitch(result, "demo-project"), {
    projectId: "11111111-1111-4111-8111-111111111111",
    projectSlug: "demo-project",
  });
  assertEquals(
    getConfirmedProjectContextSwitch(result, " 11111111-1111-4111-8111-111111111111 "),
    null,
  );
  assertEquals(getConfirmedProjectContextSwitch(result, ""), null);
});

Deno.test("getConfirmedProjectContextSwitch permits an absent slug only for an exact id request", () => {
  const result = {
    structuredContent: {
      success: true,
      project_id: "project-2",
      slug: "   ",
    },
  };

  assertEquals(getConfirmedProjectContextSwitch(result, "project-2"), {
    projectId: "project-2",
  });
  assertEquals(getConfirmedProjectContextSwitch(result, "project-two"), null);
});

Deno.test("createUnconfirmedProjectContextSwitchResult returns a stable explicit tool error", () => {
  assertEquals(createUnconfirmedProjectContextSwitchResult(), {
    success: false,
    isError: true,
    error: "tool_error",
    code: PROJECT_CONTEXT_SWITCH_UNCONFIRMED_ERROR_CODE,
    message: PROJECT_CONTEXT_SWITCH_UNCONFIRMED_MESSAGE,
    structuredContent: {
      success: false,
      error: "tool_error",
      code: PROJECT_CONTEXT_SWITCH_UNCONFIRMED_ERROR_CODE,
      message: PROJECT_CONTEXT_SWITCH_UNCONFIRMED_MESSAGE,
    },
  });
});

Deno.test("claimed project success remains visible when structured content is malformed", () => {
  assertEquals(
    isClaimedSuccessfulProjectContextSwitchResult({
      success: true,
      project_id: "project-2",
      structuredContent: {},
    }),
    true,
  );
  assertEquals(
    isClaimedSuccessfulProjectContextSwitchResult({
      success: true,
      project_id: "project-2",
      structuredContent: null,
    }),
    true,
  );
});

Deno.test("project confirmation never invokes accessor-backed identity fields", () => {
  let accessorCalls = 0;
  const result: Record<string, unknown> = {
    success: true,
    project_id: "project-2",
  };
  Object.defineProperty(result, "structuredContent", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return {
        success: true,
        project_id: "project-2",
      };
    },
  });

  assertEquals(getConfirmedProjectContextSwitch(result, "project-2"), null);
  assertEquals(isClaimedSuccessfulProjectContextSwitchResult(result), true);
  assertEquals(accessorCalls, 0);
});

Deno.test("project confirmation fails closed when proxy descriptors throw", () => {
  let ordinaryGetCalls = 0;
  const result = new Proxy(
    {
      success: true,
      project_id: "project-2",
    },
    {
      get() {
        ordinaryGetCalls += 1;
        throw new Error("ordinary property access must not run");
      },
      getOwnPropertyDescriptor() {
        throw new Error("uninspectable proxy");
      },
    },
  );

  assertEquals(getConfirmedProjectContextSwitch(result, "project-2"), null);
  assertEquals(isClaimedSuccessfulProjectContextSwitchResult(result), false);
  assertEquals(ordinaryGetCalls, 0);
});

Deno.test("project confirmation ignores inherited descriptor value accessors", () => {
  const priorDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  let inheritedGetterCalls = 0;
  let confirmed: ReturnType<typeof getConfirmedProjectContextSwitch>;
  let claimed: boolean;
  try {
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      get() {
        inheritedGetterCalls += 1;
        throw new Error("inherited descriptor accessors must not run");
      },
    });

    confirmed = getConfirmedProjectContextSwitch(
      {
        success: true,
        structuredContent: {
          success: true,
          project_id: "project-2",
        },
      },
      "project-2",
    );
    claimed = isClaimedSuccessfulProjectContextSwitchResult({
      success: true,
      structuredContent: {},
    });
  } finally {
    if (priorDescriptor) {
      Object.defineProperty(Object.prototype, "value", priorDescriptor);
    } else {
      Reflect.deleteProperty(Object.prototype, "value");
    }
  }

  assertEquals(confirmed, { projectId: "project-2" });
  assertEquals(claimed, true);
  assertEquals(inheritedGetterCalls, 0);
});

Deno.test("project identity normalization uses captured string intrinsics", () => {
  const originalTrim = String.prototype.trim;
  const originalCharCodeAt = String.prototype.charCodeAt;
  const originalReflectApply = Reflect.apply;
  let identity: ReturnType<typeof normalizeAgentProjectIdentity>;
  try {
    Object.defineProperty(String.prototype, "trim", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("poisoned String.prototype.trim");
      },
    });
    Object.defineProperty(String.prototype, "charCodeAt", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("poisoned String.prototype.charCodeAt");
      },
    });
    Object.defineProperty(Reflect, "apply", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("poisoned Reflect.apply");
      },
    });

    identity = normalizeAgentProjectIdentity("project-2", " project-two ");
  } finally {
    Object.defineProperty(String.prototype, "trim", {
      configurable: true,
      writable: true,
      value: originalTrim,
    });
    Object.defineProperty(String.prototype, "charCodeAt", {
      configurable: true,
      writable: true,
      value: originalCharCodeAt,
    });
    Object.defineProperty(Reflect, "apply", {
      configurable: true,
      writable: true,
      value: originalReflectApply,
    });
  }

  assertEquals(identity, {
    projectId: "project-2",
    projectSlug: "project-two",
  });
});
