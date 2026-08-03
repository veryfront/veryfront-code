import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/skill/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import {
  createSkillDocumentParserProvider,
  type SkillDocumentParserProvider,
} from "#veryfront/extensions/parser/skill-document-parser.ts";
import {
  SKILL_DOCUMENT_MAX_CHARACTERS,
  SKILL_LOADABLE_REFERENCE_LISTING_MAX_ENTRIES,
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_SUBDIR_MAX_ENTRIES,
  SKILL_TEXT_FILE_MAX_BYTES,
} from "#veryfront/skill/limits.ts";
import { createSkillOperationBudget } from "#veryfront/skill/operation-budget.ts";
import { createRuntimeProjectSkillLoader } from "./project-skill-loader.ts";
import type {
  RuntimeGetProjectFileOptions,
  RuntimeProjectFile,
  RuntimeProjectFileListItem,
  RuntimeProjectFilesApiOptions,
} from "./project-files-client.ts";

class AccessDeniedError extends Error {}

const PROJECT_CONTEXT = {
  projectId: "project-1",
  authToken: "auth-token",
  branchId: "branch-1",
};

function directorySkill(name: string, body: string): string {
  return `---
name: ${name}
description: ${name} project skill
---
${body}`;
}

type FileCall = RuntimeGetProjectFileOptions;
type FilesCall = RuntimeProjectFilesApiOptions;

async function withPollutedDescriptorPrototypeValue<T>(
  value: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  Object.defineProperty(Object.prototype, "value", {
    configurable: true,
    value,
  });
  try {
    return await fn();
  } finally {
    if (original) {
      Object.defineProperty(Object.prototype, "value", original);
    } else {
      delete (Object.prototype as Record<string, unknown>).value;
    }
  }
}

function createLoader(input: {
  getProjectFile?: (options: RuntimeGetProjectFileOptions) => Promise<RuntimeProjectFile | null>;
  getProjectFiles?: (
    options: RuntimeProjectFilesApiOptions,
  ) => Promise<RuntimeProjectFileListItem[]>;
  warnings?: Array<{ message: string; metadata?: Record<string, unknown> }>;
  skillDocumentParserProvider?: SkillDocumentParserProvider;
  steeringPaths?: { skills: string[] };
} = {}) {
  const fileCalls: FileCall[] = [];
  const filesCalls: FilesCall[] = [];
  const warnings = input.warnings ?? [];

  return {
    loader: createRuntimeProjectSkillLoader({
      getProjectFile: async (options) => {
        fileCalls.push(options);
        return input.getProjectFile ? await input.getProjectFile(options) : null;
      },
      getProjectFiles: async (options) => {
        filesCalls.push(options);
        return input.getProjectFiles ? await input.getProjectFiles(options) : [];
      },
      isAccessDeniedError: (error) => error instanceof AccessDeniedError,
      logger: {
        warn: (message, metadata) => warnings.push({ message, metadata }),
      },
      skillDocumentParserProvider: input.skillDocumentParserProvider,
      steeringPaths: input.steeringPaths,
    }),
    fileCalls,
    filesCalls,
    warnings,
  };
}

Deno.test("runtime project loader decodes a directory Skill document exactly once", async () => {
  let decodeCalls = 0;
  const content = "---\nprovider-specific: true\n---\n# Research";
  const provider = createSkillDocumentParserProvider(() => {
    decodeCalls += 1;
    if (decodeCalls > 1) {
      throw new Error("directory Skill document was decoded more than once");
    }
    return {
      name: "research",
      description: "One detached provider snapshot",
    };
  });
  const { loader } = createLoader({
    skillDocumentParserProvider: provider,
    getProjectFile: async ({ path }) =>
      path === "skills/research/SKILL.md" ? { path, content } : null,
  });

  assertEquals(await loader.loadProjectSkill(PROJECT_CONTEXT, "research"), {
    instructions: content,
    references: [],
  });
  assertEquals(decodeCalls, 1);
});

Deno.test("runtime project skill loader returns empty results without project context", async () => {
  const { loader, fileCalls, filesCalls } = createLoader();
  const context = { authToken: "auth-token", projectId: null, branchId: null };

  assertEquals(await loader.listProjectSkillReferences(context, "research"), []);
  assertEquals(await loader.loadProjectSkill(context, "research"), null);
  assertEquals(
    await loader.loadProjectSkillReference(context, "research", "references/guide.md"),
    null,
  );
  assertEquals(fileCalls, []);
  assertEquals(filesCalls, []);
});

Deno.test("runtime project skill loader loads directory skills with normalized sorted references", async () => {
  const { loader, filesCalls } = createLoader({
    getProjectFile: async ({ path }) =>
      path === "skills/research/SKILL.md"
        ? { path, content: directorySkill("research", "# Research") }
        : null,
    getProjectFiles: async () => [
      { path: "skills/research/references/zeta.md" },
      { path: "skills/research/references/checklists/checklist.md" },
      { path: "skills/research/resources/schema.json" },
      { path: "skills/research/assets/template.txt" },
      { path: "skills/research/scripts/ignored.ts" },
      { path: "skills/other/references/skip.md" },
    ],
  });

  assertEquals(await loader.loadProjectSkill(PROJECT_CONTEXT, "research"), {
    instructions: directorySkill("research", "# Research"),
    references: [
      "assets/template.txt",
      "references/checklists/checklist.md",
      "references/zeta.md",
      "resources/schema.json",
    ],
  });
  assertEquals(filesCalls[0]?.pathPrefix, "skills/research");
  assertEquals(
    filesCalls[0]?.maximumEntries,
    SKILL_LOADABLE_REFERENCE_LISTING_MAX_ENTRIES,
  );
});

Deno.test("runtime project skill loader forwards one cancellation signal through body and listing reads", async () => {
  let fileSignal: AbortSignal | undefined;
  let listSignal: AbortSignal | undefined;
  const loader = createRuntimeProjectSkillLoader({
    getProjectFile: (options) => {
      fileSignal = options.abortSignal;
      return Promise.resolve({
        path: options.path,
        content: directorySkill("research", "# Research"),
      });
    },
    getProjectFiles: (options) => {
      listSignal = options.abortSignal;
      return Promise.resolve([
        { path: "skills/research/references/guide.md" },
      ]);
    },
  });
  const controller = new AbortController();
  const budget = createSkillOperationBudget({
    abortSignal: controller.signal,
    timeoutMs: 5_000,
  });

  await loader.loadProjectSkill(
    PROJECT_CONTEXT,
    "research",
    { budget },
  );

  assertStrictEquals(fileSignal, controller.signal);
  assertStrictEquals(listSignal, controller.signal);
});

Deno.test("runtime project skill loader never converts caller cancellation into denied fallback", async () => {
  const controller = new AbortController();
  const cancellation = new DOMException("request cancelled", "AbortError");
  const loader = createRuntimeProjectSkillLoader({
    getProjectFile: () => {
      controller.abort(cancellation);
      return Promise.reject(new AccessDeniedError("late access denial"));
    },
    getProjectFiles: () => Promise.resolve([]),
    isAccessDeniedError: (error) => error instanceof AccessDeniedError,
  });
  const budget = createSkillOperationBudget({
    abortSignal: controller.signal,
    timeoutMs: 5_000,
  });

  const error = await assertRejects(() =>
    loader.loadProjectSkill(
      PROJECT_CONTEXT,
      "research",
      { budget },
    )
  );

  assertStrictEquals(error, cancellation);
});

Deno.test("runtime project skill loader rejects malformed custom project file listings", async () => {
  for (
    const invalidPath of [
      "skills/research/references/foo\\bar.md",
      "skills/research/references//bar.md",
      `skills/research/references/${String.fromCharCode(0xd800)}.md`,
    ]
  ) {
    const { loader } = createLoader({
      getProjectFile: async ({ path }) =>
        path === "skills/research/SKILL.md"
          ? { path, content: directorySkill("research", "# Research") }
          : null,
      getProjectFiles: async () => [{ path: invalidPath }],
    });

    await assertRejects(
      () => loader.loadProjectSkill(PROJECT_CONTEXT, "research"),
      TypeError,
      "invalid path",
    );
  }
});

Deno.test("runtime project skill loader snapshots file listings without invoking accessors", async () => {
  let pathReads = 0;
  const item = Object.defineProperty({}, "path", {
    configurable: true,
    enumerable: true,
    get() {
      pathReads += 1;
      return "skills/research/references/guide.md";
    },
  }) as RuntimeProjectFileListItem;
  const { loader } = createLoader({
    getProjectFile: async ({ path }) =>
      path === "skills/research/SKILL.md"
        ? { path, content: directorySkill("research", "# Research") }
        : null,
    getProjectFiles: async () => [item],
  });
  await withPollutedDescriptorPrototypeValue(
    "skills/research/references/guide.md",
    () =>
      assertRejects(
        () => loader.loadProjectSkill(PROJECT_CONTEXT, "research"),
        TypeError,
        "path must be a data property",
      ),
  );
  assertEquals(pathReads, 0);
});

Deno.test("runtime project skill loader rejects accessor-backed file list entries", async () => {
  let entryReads = 0;
  const files: RuntimeProjectFileListItem[] = [];
  Object.defineProperty(files, 0, {
    configurable: true,
    get() {
      entryReads += 1;
      return { path: "skills/research/references/guide.md" };
    },
  });
  const { loader } = createLoader({
    getProjectFile: async ({ path }) =>
      path === "skills/research/SKILL.md"
        ? { path, content: directorySkill("research", "# Research") }
        : null,
    getProjectFiles: async () => files,
  });

  await withPollutedDescriptorPrototypeValue(
    { path: "skills/research/references/guide.md" },
    () =>
      assertRejects(
        () => loader.loadProjectSkill(PROJECT_CONTEXT, "research"),
        TypeError,
        "entry 0 must be a data property",
      ),
  );
  assertEquals(entryReads, 0);
});

Deno.test("runtime project skill loader rejects accessor-backed steering paths", async () => {
  let pathReads = 0;
  const skills: string[] = [];
  Object.defineProperty(skills, 0, {
    configurable: true,
    get() {
      pathReads += 1;
      return "skills";
    },
  });
  const { loader } = createLoader({ steeringPaths: { skills } });

  await withPollutedDescriptorPrototypeValue(
    "skills",
    () =>
      assertRejects(
        () => loader.loadProjectSkill(PROJECT_CONTEXT, "research"),
        TypeError,
        "entry 0 must be a data property",
      ),
  );
  assertEquals(pathReads, 0);
});

Deno.test("runtime project skill loader rejects Array proxies without invoking get traps", async () => {
  let lengthReads = 0;
  const files = new Proxy(
    [{ path: "skills/research/references/guide.md" }],
    {
      get(target, key, receiver) {
        if (key === "length") {
          lengthReads += 1;
          throw new Error("length getter must not run");
        }
        return Reflect.get(target, key, receiver);
      },
    },
  );
  const { loader } = createLoader({
    getProjectFile: async ({ path }) =>
      path === "skills/research/SKILL.md"
        ? { path, content: directorySkill("research", "# Research") }
        : null,
    getProjectFiles: async () => files,
  });

  await assertRejects(
    () => loader.loadProjectSkill(PROJECT_CONTEXT, "research"),
    TypeError,
    "must not be a Proxy",
  );

  let descriptorReads = 0;
  const fakeLength = new Proxy(
    [{ path: "skills/research/references/hidden.md" }],
    {
      getOwnPropertyDescriptor(target, key) {
        descriptorReads += 1;
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        return key === "length" && descriptor ? { ...descriptor, value: 0 } : descriptor;
      },
    },
  );
  const fakeLengthLoader = createLoader({ getProjectFiles: async () => fakeLength }).loader;
  await assertRejects(
    () =>
      fakeLengthLoader.listProjectSkillReferences(
        COLOCATED_CONTEXT,
        "researcher--cite",
      ),
    TypeError,
    "must not be a Proxy",
  );

  const skills = new Proxy(["skills"], {
    get(target, key, receiver) {
      if (key === "length") {
        lengthReads += 1;
        throw new Error("length getter must not run");
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const steeringLoader = createLoader({ steeringPaths: { skills } }).loader;
  await assertRejects(
    () => steeringLoader.loadProjectSkill(PROJECT_CONTEXT, "research"),
    TypeError,
    "must not be a Proxy",
  );
  assertEquals(lengthReads, 0);
  assertEquals(descriptorReads, 0);
});

Deno.test("runtime project skill loader fails closed on throwing descriptors and revoked arrays", async () => {
  const throwing = new Proxy<RuntimeProjectFileListItem[]>([], {
    getOwnPropertyDescriptor() {
      throw new Error("descriptor denied");
    },
  });
  const throwingLoader = createLoader({ getProjectFiles: async () => throwing }).loader;
  await assertRejects(
    () =>
      throwingLoader.listProjectSkillReferences(
        COLOCATED_CONTEXT,
        "researcher--cite",
      ),
    TypeError,
    "must not be a Proxy",
  );

  const revocable = Proxy.revocable<RuntimeProjectFileListItem[]>([], {});
  revocable.revoke();
  const revokedLoader = createLoader({ getProjectFiles: async () => revocable.proxy }).loader;
  await assertRejects(
    () =>
      revokedLoader.listProjectSkillReferences(
        COLOCATED_CONTEXT,
        "researcher--cite",
      ),
    TypeError,
  );
});

Deno.test("runtime project skill loader bounds every remote document read", async () => {
  const { loader, fileCalls } = createLoader({
    getProjectFile: async ({ path }) =>
      path === "skills/research/SKILL.md"
        ? { path, content: directorySkill("research", "# Research") }
        : path === "skills/research/references/guide.md"
        ? { path, content: "# Guide" }
        : null,
  });
  const controller = new AbortController();
  const budget = createSkillOperationBudget({
    abortSignal: controller.signal,
    timeoutMs: 5_000,
  });

  await loader.loadProjectSkill(PROJECT_CONTEXT, "research", { budget });
  await loader.loadProjectSkillReference(
    PROJECT_CONTEXT,
    "research",
    "references/guide.md",
    { budget },
  );

  assertEquals(fileCalls.length, 3);
  for (const call of fileCalls) {
    assertEquals(call.maximumContentCharacters, SKILL_DOCUMENT_MAX_CHARACTERS);
    assertEquals(call.abortSignal, controller.signal);
    assertEquals(typeof call.timeoutMs, "number");
  }
});

Deno.test("runtime project skill loader isolates references to the selected skill source path", async () => {
  const { loader } = createLoader({
    getProjectFile: async ({ path }) =>
      path === "skills/research/SKILL.md"
        ? { path, content: directorySkill("research", "# Research") }
        : path === ".veryfront/skills/research/SKILL.md"
        ? { path, content: directorySkill("research", "# Legacy research") }
        : null,
    getProjectFiles: async () => [
      { path: "skills/research/SKILL.md" },
      { path: "skills/research/references/current.md" },
      { path: ".veryfront/skills/research/SKILL.md" },
      { path: ".veryfront/skills/research/references/stale.md" },
    ],
  });

  assertEquals(await loader.loadProjectSkill(PROJECT_CONTEXT, "research"), {
    instructions: directorySkill("research", "# Research"),
    references: ["references/current.md"],
  });
  assertEquals(
    await loader.listProjectSkillReferences(PROJECT_CONTEXT, "research"),
    ["references/current.md"],
  );
});

Deno.test("runtime project skill loader falls back to flat project skills without references", async () => {
  const { loader, fileCalls } = createLoader({
    getProjectFile: async ({ path }) =>
      path === "skills/custom.md" ? { path, content: "# Custom" } : null,
  });

  assertEquals(await loader.loadProjectSkill(PROJECT_CONTEXT, "custom"), {
    instructions: "# Custom",
    references: [],
  });
  assertEquals(fileCalls.map((call) => call.path), [
    "skills/custom/SKILL.md",
    "skills/custom.md",
  ]);
});

Deno.test("runtime project skill loader binds cataloged flat skills to their advertised source", async () => {
  const { loader, fileCalls } = createLoader({
    getProjectFile: async ({ path }) =>
      path === "skills/custom.md"
        ? { path, content: "# Cataloged flat skill" }
        : path === "skills/custom/SKILL.md"
        ? { path, content: directorySkill("custom", "# Later directory skill") }
        : null,
  });

  assertEquals(
    await loader.loadProjectSkill(
      {
        ...PROJECT_CONTEXT,
        skillSourcePaths: { custom: "skills/custom.md" },
      },
      "custom",
    ),
    {
      instructions: "# Cataloged flat skill",
      references: [],
    },
  );
  assertEquals(fileCalls.map((call) => call.path), ["skills/custom.md"]);
});

Deno.test("an authored name mismatch remains display metadata and shadows a flat skill", async () => {
  const { loader, fileCalls } = createLoader({
    getProjectFile: async ({ path }) =>
      path === "skills/shared/SKILL.md"
        ? {
          path,
          content: directorySkill("different", "# Canonical directory override"),
        }
        : path === "skills/shared.md"
        ? { path, content: "# Flat fallback" }
        : null,
  });

  assertEquals(await loader.loadProjectSkill(PROJECT_CONTEXT, "shared"), {
    instructions: directorySkill("different", "# Canonical directory override"),
    references: [],
  });
  assertEquals(fileCalls.map((call) => call.path), ["skills/shared/SKILL.md"]);
});

Deno.test("a malformed directory skill does not fall through to a flat skill", async () => {
  const { loader, fileCalls } = createLoader({
    getProjectFile: async ({ path }) =>
      path === "skills/shared/SKILL.md"
        ? {
          path,
          content: "---\nname: shared\n---\n# Missing required description",
        }
        : path === "skills/shared.md"
        ? { path, content: "# Flat fallback" }
        : null,
  });

  assertEquals(await loader.loadProjectSkill(PROJECT_CONTEXT, "shared"), null);
  assertEquals(fileCalls.map((call) => call.path), ["skills/shared/SKILL.md"]);
});

Deno.test("runtime project skill loader rejects unsafe ids before project lookup", async () => {
  const { loader, fileCalls } = createLoader();

  assertEquals(await loader.loadProjectSkill(PROJECT_CONTEXT, "../secret"), null);
  assertEquals(
    await loader.loadProjectSkill(PROJECT_CONTEXT, String.fromCharCode(0xd800)),
    null,
  );
  assertEquals(
    await loader.loadProjectSkillReference(
      PROJECT_CONTEXT,
      "../secret",
      "references/guide.md",
    ),
    null,
  );
  assertEquals(fileCalls, []);
});

Deno.test("runtime project skill loader rejects mismatched project response paths", async () => {
  const { loader } = createLoader({
    getProjectFile: async () => ({
      path: "skills/other/SKILL.md",
      content: directorySkill("research", "# Research"),
    }),
  });

  await assertRejects(
    () => loader.loadProjectSkill(PROJECT_CONTEXT, "research"),
    TypeError,
    "did not match requested path",
  );
});

Deno.test("runtime project skill loader loads project skill reference content", async () => {
  const { loader } = createLoader({
    getProjectFile: async ({ path }) =>
      path === "skills/research/SKILL.md"
        ? { path, content: "# Research" }
        : path === "skills/research/references/guide.md"
        ? { path, content: "# Guide" }
        : null,
  });

  assertEquals(
    await loader.loadProjectSkillReference(PROJECT_CONTEXT, "research", "references/guide.md"),
    "# Guide",
  );
});

Deno.test("runtime project skill loader reads only canonical readable skill directories", async () => {
  const requestedPaths: string[] = [];
  const { loader } = createLoader({
    getProjectFile: async ({ path }) => {
      requestedPaths.push(path);
      if (path === "skills/research/SKILL.md") {
        return { path, content: "# Research" };
      }
      if (
        path === "skills/research/resources/schema.json" ||
        path === "skills/research/assets/template.txt" ||
        path === "skills/research/assets/empty.txt"
      ) {
        return {
          path,
          content: path.endsWith("/empty.txt") ? "" : path,
        };
      }
      return null;
    },
  });

  assertEquals(
    await loader.loadProjectSkillReference(PROJECT_CONTEXT, "research", "resources/schema.json"),
    "skills/research/resources/schema.json",
  );
  assertEquals(
    await loader.loadProjectSkillReference(PROJECT_CONTEXT, "research", "assets/template.txt"),
    "skills/research/assets/template.txt",
  );
  assertEquals(
    await loader.loadProjectSkillReference(PROJECT_CONTEXT, "research", "assets/empty.txt"),
    "",
  );
  assertEquals(
    await loader.loadProjectSkillReference(PROJECT_CONTEXT, "research", "scripts/run.ts"),
    null,
  );
  assertEquals(
    await loader.loadProjectSkillReference(PROJECT_CONTEXT, "research", "resources"),
    null,
  );
  assertEquals(requestedPaths.includes("skills/research/scripts/run.ts"), false);
});

Deno.test("runtime project skill loader rejects oversized custom reference content", async () => {
  const { loader } = createLoader({
    getProjectFile: async ({ path }) =>
      path === "skills/research/SKILL.md"
        ? { path, content: "# Research" }
        : path === "skills/research/references/guide.md"
        ? { path, content: "x".repeat(SKILL_TEXT_FILE_MAX_BYTES + 1) }
        : null,
  });

  await assertRejects(
    () =>
      loader.loadProjectSkillReference(
        PROJECT_CONTEXT,
        "research",
        "references/guide.md",
      ),
    RangeError,
    "content budget",
  );
});

Deno.test("runtime project skill loader does not load stale legacy references for a source skill", async () => {
  const { loader } = createLoader({
    getProjectFile: async ({ path }) =>
      path === "skills/research/SKILL.md"
        ? { path, content: "# Research" }
        : path === ".veryfront/skills/research/references/stale.md"
        ? { path, content: "# Stale" }
        : null,
  });

  assertEquals(
    await loader.loadProjectSkillReference(PROJECT_CONTEXT, "research", "references/stale.md"),
    null,
  );
});

Deno.test("runtime project skill loader still loads legacy hidden skills", async () => {
  const { loader, fileCalls } = createLoader({
    getProjectFile: async ({ path }) =>
      path === ".veryfront/skills/legacy/SKILL.md"
        ? { path, content: directorySkill("legacy", "# Legacy") }
        : null,
  });

  assertEquals(await loader.loadProjectSkill(PROJECT_CONTEXT, "legacy"), {
    instructions: directorySkill("legacy", "# Legacy"),
    references: [],
  });
  assertEquals(fileCalls.map((call) => call.path), [
    "skills/legacy/SKILL.md",
    "skills/legacy.md",
    ".veryfront/skills/legacy/SKILL.md",
  ]);
});

Deno.test("runtime project skill loader returns null and logs when lookup is denied", async () => {
  const { loader, warnings } = createLoader({
    getProjectFile: async () => {
      throw new AccessDeniedError("Access denied");
    },
  });

  assertEquals(await loader.loadProjectSkill(PROJECT_CONTEXT, "research"), null);
  assertEquals(
    await loader.loadProjectSkillReference(PROJECT_CONTEXT, "research", "references/guide.md"),
    null,
  );
  assertEquals(warnings, [
    {
      message: "Falling back to builtin skill after project skill lookup was denied",
      metadata: {
        projectId: "project-1",
        branchId: "branch-1",
        skillId: "research",
      },
    },
    {
      message: "Falling back to builtin skill reference after project skill lookup was denied",
      metadata: {
        projectId: "project-1",
        branchId: "branch-1",
        skillId: "research",
        file: "references/guide.md",
      },
    },
  ]);
});

Deno.test("runtime project skill loader fails closed on denied claimed sources", async () => {
  const { loader, warnings } = createLoader({
    getProjectFile: async () => {
      throw new AccessDeniedError("Access denied");
    },
  });
  const context = {
    ...PROJECT_CONTEXT,
    skillSourcePaths: {
      research: "skills/research/SKILL.md",
    },
  };

  await assertRejects(
    () => loader.loadProjectSkill(context, "research"),
    AccessDeniedError,
    "Access denied",
  );
  await assertRejects(
    () => loader.loadProjectSkillReference(context, "research", "references/guide.md"),
    AccessDeniedError,
    "Access denied",
  );
  assertEquals(warnings, []);
});

// ── Catalog sourcePath resolution (colocated/owned skills) ────────────────

const COLOCATED_CONTEXT = {
  ...PROJECT_CONTEXT,
  skillSourcePaths: {
    "researcher--cite": "agents/researcher/skills/cite/SKILL.md",
  },
};

Deno.test("loadProjectSkill resolves a colocated skill at its catalog sourcePath", async () => {
  const { loader, fileCalls } = createLoader({
    getProjectFile: (options) =>
      Promise.resolve(
        options.path === "agents/researcher/skills/cite/SKILL.md"
          ? {
            path: options.path,
            content: directorySkill("cite", "Cite primary sources."),
          }
          : null,
      ),
  });

  const skill = await loader.loadProjectSkill(COLOCATED_CONTEXT, "researcher--cite");

  assertEquals(skill?.instructions, directorySkill("cite", "Cite primary sources."));
  // The namespaced id must never be probed as skills/{id}/SKILL.md.
  assertEquals(
    fileCalls.some((call) => call.path.includes("skills/researcher--cite")),
    false,
  );
});

Deno.test("loadProjectSkill preserves provider-safe catalog identity at load time", async () => {
  const context = {
    ...PROJECT_CONTEXT,
    skillSourcePaths: {
      "a_b--x_y": "agents/a.b/skills/x_y/SKILL.md",
    },
  };
  const { loader } = createLoader({
    getProjectFile: (options) =>
      Promise.resolve(
        options.path === "agents/a.b/skills/x_y/SKILL.md"
          ? {
            path: options.path,
            content: directorySkill("x_y", "Use the provider-safe skill."),
          }
          : null,
      ),
  });

  const skill = await loader.loadProjectSkill(context, "a_b--x_y");

  assertEquals(
    skill?.instructions,
    directorySkill("x_y", "Use the provider-safe skill."),
  );
});

Deno.test("loadProjectSkill preserves provider-safe root-owned catalog identities", async () => {
  for (const name of ["foo_bar", "ReleaseNotes"] as const) {
    const sourcePath = `agents/${name}/SKILL.md`;
    const context = {
      ...PROJECT_CONTEXT,
      skillSourcePaths: { [name]: sourcePath },
    };
    const { loader } = createLoader({
      getProjectFile: (options) =>
        Promise.resolve(
          options.path === sourcePath
            ? {
              path: options.path,
              content: directorySkill(name, `Use the ${name} root-owned skill.`),
            }
            : null,
        ),
    });

    const skill = await loader.loadProjectSkill(context, name);

    assertEquals(
      skill?.instructions,
      directorySkill(name, `Use the ${name} root-owned skill.`),
    );
  }
});

Deno.test("catalog source paths ignore inherited entries and reject accessors", async () => {
  const { loader, fileCalls } = createLoader();
  const inheritedContext = {
    ...PROJECT_CONTEXT,
    skillSourcePaths: { research: "skills/research/SKILL.md" },
  };

  assertEquals(await loader.loadProjectSkill(inheritedContext, "constructor"), null);
  assertEquals(
    fileCalls.some((call) => call.path === "skills/constructor/SKILL.md"),
    true,
  );

  let accessorReads = 0;
  const skillSourcePaths = Object.defineProperty({}, "research", {
    configurable: true,
    enumerable: true,
    get() {
      accessorReads += 1;
      return "skills/research/SKILL.md";
    },
  }) as Readonly<Record<string, string>>;
  await withPollutedDescriptorPrototypeValue(
    "skills/research/SKILL.md",
    () =>
      assertRejects(
        () =>
          loader.loadProjectSkill(
            { ...PROJECT_CONTEXT, skillSourcePaths },
            "research",
          ),
        TypeError,
        "string data property",
      ),
  );
  assertEquals(accessorReads, 0);
});

Deno.test("loadProjectSkillReference reads reference files from the catalog skill dir", async () => {
  const { loader } = createLoader({
    getProjectFile: (options) =>
      Promise.resolve(
        options.path === "agents/researcher/skills/cite/references/styles.md"
          ? { path: options.path, content: "APA or MLA." }
          : null,
      ),
  });

  const content = await loader.loadProjectSkillReference(
    COLOCATED_CONTEXT,
    "researcher--cite",
    "references/styles.md",
  );

  assertEquals(content, "APA or MLA.");
});

Deno.test("listProjectSkillReferences lists references under the catalog skill dir", async () => {
  const { loader, filesCalls } = createLoader({
    getProjectFiles: () =>
      Promise.resolve([
        { path: "agents/researcher/skills/cite/references/styles.md" },
        { path: "agents/researcher/skills/cite/references/journals.md" },
        { path: "agents/researcher/skills/cite/resources/schema.json" },
        { path: "agents/researcher/skills/cite/assets/template.txt" },
        { path: "agents/researcher/skills/cite/scripts/ignored.ts" },
        { path: "skills/other/references/nope.md" },
      ] as RuntimeProjectFileListItem[]),
  });

  const references = await loader.listProjectSkillReferences(
    COLOCATED_CONTEXT,
    "researcher--cite",
  );

  assertEquals(references, [
    "assets/template.txt",
    "references/journals.md",
    "references/styles.md",
    "resources/schema.json",
  ]);
  assertEquals(
    filesCalls[0]?.pathPrefix,
    "agents/researcher/skills/cite",
  );
  assertEquals(
    filesCalls[0]?.maximumEntries,
    SKILL_LOADABLE_REFERENCE_LISTING_MAX_ENTRIES,
  );
});

Deno.test("project loader preserves per-directory and aggregate readable-file budgets", async () => {
  const readablePaths = ["references", "resources", "assets"].flatMap((directory) =>
    Array.from(
      { length: SKILL_SUBDIR_MAX_ENTRIES },
      (_unused, index) => ({
        path: `agents/researcher/skills/cite/${directory}/${index}.txt`,
      }),
    )
  );
  const aggregate = createLoader({
    getProjectFiles: async () => readablePaths,
  });

  assertEquals(
    (await aggregate.loader.listProjectSkillReferences(
      COLOCATED_CONTEXT,
      "researcher--cite",
    )).length,
    SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  );

  const overflow = createLoader({
    getProjectFiles: async () => [
      ...readablePaths,
      { path: `agents/researcher/skills/cite/assets/${SKILL_SUBDIR_MAX_ENTRIES}.txt` },
    ],
  });
  await assertRejects(
    () =>
      overflow.loader.listProjectSkillReferences(
        COLOCATED_CONTEXT,
        "researcher--cite",
      ),
    RangeError,
    `at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
  );
});

Deno.test("loader falls back to steering-path probing without a catalog entry", async () => {
  const { loader, fileCalls } = createLoader();

  await loader.loadProjectSkill(PROJECT_CONTEXT, "plain-skill");

  assertEquals(
    fileCalls.some((call) => call.path.endsWith("/plain-skill/SKILL.md")),
    true,
  );
});
