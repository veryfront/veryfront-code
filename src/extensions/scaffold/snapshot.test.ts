import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ScaffoldPlan, ScaffoldRequest } from "./scaffold-provider.ts";
import {
  captureScaffoldProvider,
  SCAFFOLD_MAX_CATALOG_ENTRIES,
  SCAFFOLD_MAX_ENVIRONMENT_VARIABLES,
  SCAFFOLD_MAX_FILE_BYTES,
  SCAFFOLD_MAX_FILES,
  SCAFFOLD_MAX_ID_LENGTH,
  SCAFFOLD_MAX_NOTICES,
  SCAFFOLD_MAX_PACKAGE_RECORDS,
  SCAFFOLD_MAX_SELECTION_IDS,
  SCAFFOLD_MAX_TEXT_BYTES,
  ScaffoldSnapshotError,
  type ScaffoldSnapshotErrorCode,
  snapshotScaffoldCatalog,
  snapshotScaffoldPlan,
  snapshotScaffoldRequest,
} from "./snapshot.ts";

function validRequest(): ScaffoldRequest {
  return {
    frameworkVersion: "1.2.3",
    projectName: "example-project",
    runtime: "deno",
    templateId: "starter",
    featureIds: ["search", "auth"],
    integrationIds: ["storage", "mail"],
  };
}

function validCatalog(): unknown {
  return {
    templates: [
      { id: "starter", label: "Starter" },
      { id: "minimal", label: "Minimal", description: "Small project" },
    ],
    features: [{ id: "search", label: "Search" }],
    integrations: [{ id: "storage", label: "Storage" }],
  };
}

interface MutableScaffoldPlan {
  files: Array<{ path: string; content: string }>;
  package: {
    dependencies: Array<{ name: string; range: string }>;
    devDependencies: Array<{ name: string; range: string }>;
    firstPartyExtensions: string[];
    trustedBuildPackages: string[];
  };
  environment: Array<{ name: string; required: boolean; description?: string }>;
  notices: string[];
}

function validPlan(): MutableScaffoldPlan {
  return {
    files: [
      { path: "src/z.ts", content: "export const z = true;" },
      { path: "src/a.ts", content: "export const a = true;" },
    ],
    package: {
      dependencies: [
        { name: "z-package", range: "^2.0.0" },
        { name: "a-package", range: ">=1 <2" },
      ],
      devDependencies: [{ name: "dev-package", range: "1.0.0" }],
      firstPartyExtensions: ["@framework/z-extension", "@framework/a-extension"],
      trustedBuildPackages: ["z-package"],
    },
    environment: [
      { name: "Z_TOKEN", required: false },
      { name: "A_TOKEN", required: true, description: "Service token" },
    ],
    notices: ["Run the setup command", "Configure the environment"],
  } satisfies ScaffoldPlan;
}

function assertSnapshotError(
  operation: () => unknown,
  code: ScaffoldSnapshotErrorCode,
  path?: string,
): ScaffoldSnapshotError {
  const error = assertThrows(operation, ScaffoldSnapshotError) as ScaffoldSnapshotError;
  assertEquals(error.code, code);
  if (path !== undefined) assertEquals(error.path, path);
  return error;
}

async function assertSnapshotRejection(
  operation: () => unknown,
  code: ScaffoldSnapshotErrorCode,
  path?: string,
): Promise<ScaffoldSnapshotError> {
  const error = await assertRejects(
    async () => await operation(),
    ScaffoldSnapshotError,
  ) as ScaffoldSnapshotError;
  assertEquals(error.code, code);
  if (path !== undefined) assertEquals(error.path, path);
  return error;
}

describe("scaffold request snapshots", () => {
  it("copies, sorts, and freezes a request", () => {
    const input = validRequest();
    const snapshot = snapshotScaffoldRequest(input);

    assertEquals(snapshot.featureIds, ["auth", "search"]);
    assertEquals(snapshot.integrationIds, ["mail", "storage"]);
    assert(Object.isFrozen(snapshot));
    assert(Object.isFrozen(snapshot.featureIds));
    assert(Object.isFrozen(snapshot.integrationIds));
    assertStrictEquals(Object.getPrototypeOf(snapshot), null);

    (input.featureIds as string[])[0] = "changed";
    assertEquals(snapshot.featureIds, ["auth", "search"]);
  });

  it("rejects invalid runtimes, identifiers, duplicates, and oversized selections", () => {
    assertSnapshotError(
      () => snapshotScaffoldRequest({ ...validRequest(), runtime: "other" }),
      "invalid-runtime",
      "$request.runtime",
    );
    assertSnapshotError(
      () => snapshotScaffoldRequest({ ...validRequest(), templateId: "../starter" }),
      "invalid-id",
      "$request.templateId",
    );
    assertSnapshotError(
      () => snapshotScaffoldRequest({ ...validRequest(), featureIds: ["auth", "auth"] }),
      "duplicate-value",
      "$request.featureIds[1]",
    );
    assertSnapshotError(
      () =>
        snapshotScaffoldRequest({
          ...validRequest(),
          integrationIds: new Array(SCAFFOLD_MAX_SELECTION_IDS + 1).fill("integration"),
        }),
      "max-entries-exceeded",
      "$request.integrationIds",
    );
    assertSnapshotError(
      () =>
        snapshotScaffoldRequest({
          ...validRequest(),
          projectName: "x".repeat(SCAFFOLD_MAX_ID_LENGTH + 1),
        }),
      "max-id-length-exceeded",
      "$request.projectName",
    );
  });
});

describe("scaffold catalog snapshots", () => {
  it("canonicalizes each category and isolates later mutation", () => {
    const input = validCatalog() as {
      templates: Array<{ id: string; label: string; description?: string }>;
      features: Array<{ id: string; label: string }>;
      integrations: Array<{ id: string; label: string }>;
    };
    const snapshot = snapshotScaffoldCatalog(input);

    assertEquals(snapshot.templates.map(({ id }) => id), ["minimal", "starter"]);
    assert(Object.isFrozen(snapshot));
    assert(Object.isFrozen(snapshot.templates));
    assert(Object.isFrozen(snapshot.templates[0]));
    assertStrictEquals(Object.getPrototypeOf(snapshot.templates[0]!), null);

    input.templates[0]!.label = "Changed";
    assertEquals(snapshot.templates[1]!.label, "Starter");
  });

  it("rejects duplicate IDs within a category but permits reuse across categories", () => {
    assertSnapshotError(
      () =>
        snapshotScaffoldCatalog({
          ...validCatalog() as Record<string, unknown>,
          templates: [
            { id: "same", label: "First" },
            { id: "same", label: "Second" },
          ],
        }),
      "duplicate-value",
      "$catalog.templates[1]",
    );

    const snapshot = snapshotScaffoldCatalog({
      templates: [{ id: "same", label: "Template" }],
      features: [{ id: "same", label: "Feature" }],
      integrations: [{ id: "same", label: "Integration" }],
    });
    assertEquals(snapshot.templates[0]!.id, "same");
    assertEquals(snapshot.features[0]!.id, "same");
  });

  it("rejects oversized categories and text", () => {
    const entries = Array.from(
      { length: SCAFFOLD_MAX_CATALOG_ENTRIES + 1 },
      (_, index) => ({ id: `entry-${index}`, label: "Entry" }),
    );
    assertSnapshotError(
      () =>
        snapshotScaffoldCatalog({
          templates: entries,
          features: [],
          integrations: [],
        }),
      "max-entries-exceeded",
      "$catalog.templates",
    );
    assertSnapshotError(
      () =>
        snapshotScaffoldCatalog({
          templates: [{ id: "entry", label: "x".repeat(SCAFFOLD_MAX_TEXT_BYTES + 1) }],
          features: [],
          integrations: [],
        }),
      "max-text-bytes-exceeded",
      "$catalog.templates[0].label",
    );
  });
});

describe("scaffold plan snapshots", () => {
  it("sorts every unordered collection and freezes a detached graph", () => {
    const input = validPlan();
    const snapshot = snapshotScaffoldPlan(input);

    assertEquals(snapshot.files.map(({ path }) => path), ["src/a.ts", "src/z.ts"]);
    assertEquals(snapshot.package.dependencies.map(({ name }) => name), [
      "a-package",
      "z-package",
    ]);
    assertEquals(snapshot.package.firstPartyExtensions, [
      "@framework/a-extension",
      "@framework/z-extension",
    ]);
    assertEquals(snapshot.environment.map(({ name }) => name), ["A_TOKEN", "Z_TOKEN"]);
    assertEquals(snapshot.notices, ["Configure the environment", "Run the setup command"]);
    assert(Object.isFrozen(snapshot));
    assert(Object.isFrozen(snapshot.files));
    assert(Object.isFrozen(snapshot.files[0]));
    assert(Object.isFrozen(snapshot.package));
    assert(Object.isFrozen(snapshot.package.dependencies[0]));
    assert(Object.isFrozen(snapshot.environment[0]));

    (input.files as Array<{ path: string; content: string }>)[0]!.content = "changed";
    assertEquals(snapshot.files[1]!.content, "export const z = true;");
  });

  it("rejects absolute, traversal, backslash, empty-segment, and URL-like paths", () => {
    for (
      const path of [
        "/src/app.ts",
        "C:/src/app.ts",
        String.raw`src\app.ts`,
        "src/../app.ts",
        "src/./app.ts",
        "src//app.ts",
        "file:///src/app.ts",
        "src/e\u0301.ts",
      ]
    ) {
      const plan = validPlan();
      (plan.files as Array<{ path: string; content: string }>)[0]!.path = path;
      assertSnapshotError(
        () => snapshotScaffoldPlan(plan),
        "invalid-path",
        "$plan.files[0].path",
      );
    }

    const oversizedPath = validPlan();
    oversizedPath.files[0]!.path = `src/${"x".repeat(SCAFFOLD_MAX_ID_LENGTH)}.ts`;
    assertSnapshotError(
      () => snapshotScaffoldPlan(oversizedPath),
      "max-id-length-exceeded",
      "$plan.files[0].path",
    );
  });

  it("rejects core-owned paths without case-sensitive filesystem gaps", () => {
    for (
      const path of [
        "package.json",
        "PACKAGE.JSON",
        "deno.json",
        ".gitignore",
        ".env",
        ".env.local",
        ".env.production/example",
        ".veryfront/project.json",
      ]
    ) {
      const plan = validPlan();
      (plan.files as Array<{ path: string; content: string }>)[0]!.path = path;
      assertSnapshotError(
        () => snapshotScaffoldPlan(plan),
        "reserved-path",
        "$plan.files[0].path",
      );
    }
  });

  it("rejects exact and case-folded duplicate file paths", () => {
    for (const secondPath of ["src/a.ts", "SRC/A.TS"]) {
      const plan = validPlan();
      plan.files = [
        { path: "src/a.ts", content: "a" },
        { path: secondPath, content: "b" },
      ];
      assertSnapshotError(
        () => snapshotScaffoldPlan(plan),
        "duplicate-value",
        "$plan.files[1].path",
      );
    }
  });

  it("enforces file count, per-file UTF-8 size, and aggregate UTF-8 size", () => {
    const tooManyFiles = validPlan();
    tooManyFiles.files = Array.from(
      { length: SCAFFOLD_MAX_FILES + 1 },
      (_, index) => ({ path: `src/file-${index}.ts`, content: "" }),
    );
    assertSnapshotError(
      () => snapshotScaffoldPlan(tooManyFiles),
      "max-files-exceeded",
      "$plan.files",
    );

    const oversizedFile = validPlan();
    oversizedFile.files = [{
      path: "src/large.txt",
      content: "é".repeat(Math.floor(SCAFFOLD_MAX_FILE_BYTES / 2) + 1),
    }];
    assertSnapshotError(
      () => snapshotScaffoldPlan(oversizedFile),
      "max-file-bytes-exceeded",
      "$plan.files[0].content",
    );

    const aggregate = validPlan();
    const fullFile = "x".repeat(SCAFFOLD_MAX_FILE_BYTES);
    aggregate.files = Array.from({ length: 17 }, (_, index) => ({
      path: `src/large-${index}.txt`,
      content: fullFile,
    }));
    assertSnapshotError(
      () => snapshotScaffoldPlan(aggregate),
      "max-total-file-bytes-exceeded",
      "$plan.files",
    );
  });

  it("rejects malformed, duplicate, overlapping, and excessive dependency records", () => {
    for (const name of ["Uppercase", "@missing-package", "scope/package", ".hidden"]) {
      const plan = validPlan();
      plan.package.dependencies = [{ name, range: "1.0.0" }];
      plan.package.trustedBuildPackages = [];
      assertSnapshotError(
        () => snapshotScaffoldPlan(plan),
        "invalid-package-name",
        "$plan.package.dependencies[0].name",
      );
    }

    const invalidRange = validPlan();
    invalidRange.package.dependencies = [{ name: "package", range: " 1.0.0" }];
    invalidRange.package.trustedBuildPackages = [];
    assertSnapshotError(
      () => snapshotScaffoldPlan(invalidRange),
      "unsupported-type",
      "$plan.package.dependencies[0].range",
    );

    const oversizedRange = validPlan();
    oversizedRange.package.dependencies = [{
      name: "package",
      range: "x".repeat(SCAFFOLD_MAX_ID_LENGTH + 1),
    }];
    oversizedRange.package.trustedBuildPackages = [];
    assertSnapshotError(
      () => snapshotScaffoldPlan(oversizedRange),
      "invalid-package-range",
      "$plan.package.dependencies[0].range",
    );

    const duplicate = validPlan();
    duplicate.package.dependencies = [
      { name: "same", range: "1" },
      { name: "same", range: "2" },
    ];
    duplicate.package.trustedBuildPackages = [];
    assertSnapshotError(
      () => snapshotScaffoldPlan(duplicate),
      "duplicate-value",
      "$plan.package.dependencies[1].name",
    );

    const overlap = validPlan();
    overlap.package.dependencies = [{ name: "same", range: "1" }];
    overlap.package.devDependencies = [{ name: "same", range: "1" }];
    overlap.package.trustedBuildPackages = [];
    assertSnapshotError(
      () => snapshotScaffoldPlan(overlap),
      "duplicate-value",
      "$plan.package.devDependencies[0].name",
    );

    const excessive = validPlan();
    excessive.package.dependencies = Array.from(
      { length: Math.floor(SCAFFOLD_MAX_PACKAGE_RECORDS / 2) + 1 },
      (_, index) => ({ name: `dependency-${index}`, range: "1" }),
    );
    excessive.package.devDependencies = Array.from(
      { length: Math.ceil(SCAFFOLD_MAX_PACKAGE_RECORDS / 2) },
      (_, index) => ({ name: `development-${index}`, range: "1" }),
    );
    excessive.package.trustedBuildPackages = [];
    assertSnapshotError(
      () => snapshotScaffoldPlan(excessive),
      "max-entries-exceeded",
      "$plan.package",
    );
  });

  it("requires trusted build packages to be declared", () => {
    const plan = validPlan();
    plan.package.trustedBuildPackages = ["not-declared"];
    assertSnapshotError(
      () => snapshotScaffoldPlan(plan),
      "undeclared-trusted-build-package",
      "$plan.package.trustedBuildPackages[0]",
    );
  });

  it("validates first-party package IDs and rejects duplicate entries", () => {
    for (const names of [["Invalid"], ["@scope/ext", "@scope/ext"]]) {
      const plan = validPlan();
      plan.package.firstPartyExtensions = names;
      assertSnapshotError(
        () => snapshotScaffoldPlan(plan),
        names.length === 1 ? "invalid-package-name" : "duplicate-value",
        "$plan.package.firstPartyExtensions[0]".replace("[0]", names.length === 1 ? "[0]" : "[1]"),
      );
    }
  });

  it("validates environment records and bounds environment and notices", () => {
    for (const name of ["1TOKEN", "TOKEN-NAME", "TOKEN NAME"]) {
      const plan = validPlan();
      plan.environment = [{ name, required: true }];
      assertSnapshotError(
        () => snapshotScaffoldPlan(plan),
        "invalid-environment-name",
        "$plan.environment[0].name",
      );
    }

    const duplicateEnvironment = validPlan();
    duplicateEnvironment.environment = [
      { name: "TOKEN", required: true },
      { name: "token", required: false },
    ];
    assertSnapshotError(
      () => snapshotScaffoldPlan(duplicateEnvironment),
      "duplicate-value",
      "$plan.environment[1].name",
    );

    const tooMuchEnvironment = validPlan();
    tooMuchEnvironment.environment = new Array(SCAFFOLD_MAX_ENVIRONMENT_VARIABLES + 1).fill({
      name: "TOKEN",
      required: true,
    });
    assertSnapshotError(
      () => snapshotScaffoldPlan(tooMuchEnvironment),
      "max-entries-exceeded",
      "$plan.environment",
    );

    const tooManyNotices = validPlan();
    tooManyNotices.notices = new Array(SCAFFOLD_MAX_NOTICES + 1).fill("Notice");
    assertSnapshotError(
      () => snapshotScaffoldPlan(tooManyNotices),
      "max-entries-exceeded",
      "$plan.notices",
    );

    const oversizedNotice = validPlan();
    oversizedNotice.notices = ["x".repeat(SCAFFOLD_MAX_TEXT_BYTES + 1)];
    assertSnapshotError(
      () => snapshotScaffoldPlan(oversizedNotice),
      "max-text-bytes-exceeded",
      "$plan.notices[0]",
    );
  });
});

describe("hostile scaffold values", () => {
  it("rejects accessors without invoking them", () => {
    let calls = 0;
    const file = { path: "src/app.ts" } as { path: string; content?: string };
    Object.defineProperty(file, "content", {
      enumerable: true,
      get() {
        calls += 1;
        return "content";
      },
    });
    const plan = validPlan();
    plan.files = [file as { path: string; content: string }];

    assertSnapshotError(
      () => snapshotScaffoldPlan(plan),
      "accessor-property",
      "$plan.files[0].content",
    );
    assertEquals(calls, 0);
  });

  it("rejects symbols, unexpected fields, non-enumerable fields, and exotic prototypes", () => {
    const withSymbol = validPlan() as MutableScaffoldPlan & Record<PropertyKey, unknown>;
    withSymbol[Symbol("hidden")] = true;
    assertSnapshotError(() => snapshotScaffoldPlan(withSymbol), "symbol-key", "$plan");

    assertSnapshotError(
      () => snapshotScaffoldPlan({ ...validPlan(), fallback: true }),
      "unexpected-property",
      "$plan.fallback",
    );

    const nonEnumerable = validPlan();
    Object.defineProperty(nonEnumerable, "notices", {
      value: [],
      enumerable: false,
    });
    assertSnapshotError(
      () => snapshotScaffoldPlan(nonEnumerable),
      "non-enumerable-property",
      "$plan.notices",
    );

    const exotic = Object.assign(Object.create({ inherited: true }), validPlan());
    assertSnapshotError(() => snapshotScaffoldPlan(exotic), "invalid-prototype", "$plan");
  });

  it("rejects sparse and decorated arrays", () => {
    const sparse = validPlan();
    sparse.files = new Array(1);
    assertSnapshotError(
      () => snapshotScaffoldPlan(sparse),
      "invalid-array-shape",
      "$plan.files",
    );

    const decorated = validPlan();
    const files = [{ path: "src/app.ts", content: "content" }] as
      & Array<{
        path: string;
        content: string;
      }>
      & { extra?: boolean };
    files.extra = true;
    decorated.files = files;
    assertSnapshotError(
      () => snapshotScaffoldPlan(decorated),
      "invalid-array-shape",
      "$plan.files",
    );
  });

  it("contains proxy inspection failures", () => {
    const trapped = new Proxy(validPlan(), {
      ownKeys() {
        throw new Error("trap escaped");
      },
    });
    assertSnapshotError(() => snapshotScaffoldPlan(trapped), "inspection-failed", "$plan");

    const { proxy, revoke } = Proxy.revocable<Array<{ path: string; content: string }>>([], {});
    revoke();
    const plan = validPlan();
    plan.files = proxy;
    assertSnapshotError(
      () => snapshotScaffoldPlan(plan),
      "inspection-failed",
      "$plan.files",
    );
  });
});

describe("captured scaffold providers", () => {
  it("captures identity and methods and validates both sides of every call", async () => {
    let receivedRequest: ScaffoldRequest | undefined;
    const provider = {
      id: "engine",
      apiVersion: 1 as const,
      getCatalog() {
        return validCatalog();
      },
      createPlan(request: ScaffoldRequest) {
        receivedRequest = request;
        return validPlan();
      },
    };

    const captured = captureScaffoldProvider(provider);
    const catalog = await captured.getCatalog();
    const plan = await captured.createPlan(validRequest());

    assert(Object.isFrozen(captured));
    assertStrictEquals(Object.getPrototypeOf(captured), null);
    assertEquals(catalog.templates.map(({ id }) => id), ["minimal", "starter"]);
    assertEquals(plan.files.map(({ path }) => path), ["src/a.ts", "src/z.ts"]);
    assertEquals(receivedRequest?.featureIds, ["auth", "search"]);
    assert(Object.isFrozen(receivedRequest));
  });

  it("rejects hostile provider properties and invalid provider output", async () => {
    let accessorCalls = 0;
    const provider = {
      id: "engine",
      apiVersion: 1,
      createPlan() {
        return validPlan();
      },
    } as Record<string, unknown>;
    Object.defineProperty(provider, "getCatalog", {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return () => validCatalog();
      },
    });
    assertSnapshotError(
      () => captureScaffoldProvider(provider),
      "accessor-property",
      "$provider.getCatalog",
    );
    assertEquals(accessorCalls, 0);

    const invalidOutput = captureScaffoldProvider({
      id: "engine",
      apiVersion: 1,
      getCatalog() {
        return { templates: [], features: [], integrations: [] };
      },
      createPlan() {
        return { ...validPlan(), fallback: true };
      },
    });
    await assertSnapshotRejection(
      () => invalidOutput.createPlan(validRequest()),
      "unexpected-property",
      "$plan.fallback",
    );
  });

  it("rejects invalid identities, API versions, methods, and proxy failures", () => {
    const base = {
      id: "engine",
      apiVersion: 1,
      getCatalog() {
        return validCatalog();
      },
      createPlan() {
        return validPlan();
      },
    };
    assertSnapshotError(
      () => captureScaffoldProvider({ ...base, id: "not/portable" }),
      "invalid-id",
      "$provider.id",
    );
    assertSnapshotError(
      () => captureScaffoldProvider({ ...base, apiVersion: 2 }),
      "unsupported-type",
      "$provider.apiVersion",
    );
    assertSnapshotError(
      () => captureScaffoldProvider({ ...base, createPlan: true }),
      "unsupported-type",
      "$provider.createPlan",
    );
    assertSnapshotError(
      () =>
        captureScaffoldProvider(
          new Proxy(base, {
            getOwnPropertyDescriptor() {
              throw new Error("descriptor trap escaped");
            },
          }),
        ),
      "inspection-failed",
    );
  });
});
