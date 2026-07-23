import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { createMockAdapter } from "#veryfront/platform";
import { discoverSourceTriggers } from "./discovery.ts";

interface TestTrigger {
  id: string;
}

function isTestTrigger(value: unknown): value is TestTrigger {
  if (!value || typeof value !== "object") return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, "id");
  return !!descriptor && "value" in descriptor && typeof descriptor.value === "string";
}

// Discovery initializes the shared esbuild transform service, whose process is
// intentionally reused across module imports.
describe("source trigger discovery", { sanitizeOps: false, sanitizeResources: false }, () => {
  it("reports project-relative source paths and duplicate origins", async () => {
    const adapter = createMockAdapter();
    await adapter.fs.mkdir("/project/schedules", { recursive: true });
    await adapter.fs.writeFile(
      "/project/schedules/first.ts",
      'export default { id: "daily-triage" };',
    );
    await adapter.fs.writeFile(
      "/project/schedules/second.ts",
      'export default { id: "daily-triage" };',
    );
    await adapter.fs.writeFile(
      "/project/schedules/invalid.ts",
      "export default { invalid: true };",
    );

    const result = await discoverSourceTriggers({
      projectDir: "/project",
      adapter,
      triggerDir: "schedules",
      sourceKind: "schedule",
      validate: isTestTrigger,
    });

    assertEquals(result.items.map((item) => item.id), ["daily-triage"]);
    assertEquals(result.errors.map((error) => error.sourcePath).sort(), [
      "schedules/invalid.ts",
      "schedules/second.ts",
    ]);
    assertEquals(result.errors[1]?.details, {
      firstSourcePath: "schedules/first.ts",
    });
  });

  it("contains module failures without exposing their raw messages", async () => {
    const adapter = createMockAdapter();
    await adapter.fs.mkdir("/project/schedules", { recursive: true });
    await adapter.fs.writeFile(
      "/project/schedules/broken.ts",
      'export default { id: "daily-triage" };',
    );
    const readFile = adapter.fs.readFile;
    adapter.fs.readFile = (path) =>
      path.endsWith("broken.ts")
        ? Promise.reject(new Error("sensitive-canary"))
        : readFile.call(adapter.fs, path);

    const result = await discoverSourceTriggers({
      projectDir: "/project",
      adapter,
      triggerDir: "schedules",
      sourceKind: "schedule",
      validate: isTestTrigger,
    });

    assertEquals(result.errors, [{
      kind: "source_trigger_discovery_error",
      sourceKind: "schedule",
      sourcePath: "schedules/broken.ts",
      code: "parse_error",
      message: "Unable to load schedule definition.",
    }]);
  });

  it("discovers named exports and returns an empty result for a missing directory", async () => {
    const adapter = createMockAdapter();

    const missing = await discoverSourceTriggers({
      projectDir: "/project",
      adapter,
      triggerDir: "schedules",
      sourceKind: "schedule",
      validate: isTestTrigger,
    });
    assertEquals(missing, { items: [], errors: [] });

    await adapter.fs.mkdir("/project/schedules", { recursive: true });
    await adapter.fs.writeFile(
      "/project/schedules/named.ts",
      'export const nightly = { id: "nightly-sync" };',
    );

    const result = await discoverSourceTriggers({
      projectDir: "/project",
      adapter,
      triggerDir: "schedules",
      sourceKind: "schedule",
      validate: isTestTrigger,
    });
    assertEquals(result, { items: [{ id: "nightly-sync" }], errors: [] });
  });

  it("supports mjs, ignores declarations, and collects every valid export deterministically", async () => {
    const adapter = createMockAdapter();
    await adapter.fs.mkdir("/project/schedules", { recursive: true });
    await adapter.fs.writeFile(
      "/project/schedules/multiple.mjs",
      [
        'export const zulu = { id: "zulu" };',
        'export default { id: "primary" };',
        'export const alpha = { id: "alpha" };',
      ].join("\n"),
    );
    await adapter.fs.writeFile(
      "/project/schedules/types.d.ts",
      "export declare const ignored: { id: string };",
    );

    const result = await discoverSourceTriggers({
      projectDir: "/project",
      adapter,
      triggerDir: "schedules",
      sourceKind: "schedule",
      validate: isTestTrigger,
    });

    assertEquals(result.items.map((item) => item.id), ["primary", "alpha", "zulu"]);
    assertEquals(result.errors, []);
  });

  it("rejects unsafe and overlong derived source paths before importing them", async () => {
    const adapter = createMockAdapter();
    await adapter.fs.mkdir("/project/schedules", { recursive: true });
    await adapter.fs.writeFile(
      "/project/schedules/unsafe\nname.ts",
      'export default { id: "unsafe-name" };',
    );
    const longSegment = "a".repeat(900);
    const overlongPath = `/project/schedules/${Array(5).fill(longSegment).join("/")}/item.ts`;
    await adapter.fs.writeFile(overlongPath, 'export default { id: "overlong" };');
    const readFile = adapter.fs.readFile;
    let moduleReads = 0;
    adapter.fs.readFile = (path) => {
      moduleReads += 1;
      return readFile.call(adapter.fs, path);
    };

    const result = await discoverSourceTriggers({
      projectDir: "/project",
      adapter,
      triggerDir: "schedules",
      sourceKind: "schedule",
      validate: isTestTrigger,
    });

    assertEquals(result.items, []);
    assertEquals(result.errors.map((error) => [error.sourcePath, error.code]), [
      ["schedules", "parse_error"],
      ["schedules", "parse_error"],
    ]);
    assertEquals(moduleReads, 0);
  });

  it("contains filesystem failures without exposing their raw messages", async () => {
    const adapter = createMockAdapter();
    adapter.fs.exists = () => Promise.reject(new Error("sensitive-canary"));

    const result = await discoverSourceTriggers({
      projectDir: "/project",
      adapter,
      triggerDir: "schedules",
      sourceKind: "schedule",
      validate: isTestTrigger,
    });

    assertEquals(result, {
      items: [],
      errors: [{
        kind: "source_trigger_discovery_error",
        sourceKind: "schedule",
        sourcePath: "schedules",
        code: "parse_error",
        message: "Unable to discover schedule definitions.",
      }],
    });
  });

  it("rejects accessor-backed options without invoking them", async () => {
    const adapter = createMockAdapter();
    let reads = 0;
    const options = {
      adapter,
      triggerDir: "schedules",
      sourceKind: "schedule",
      validate: isTestTrigger,
    };
    Object.defineProperty(options, "projectDir", {
      enumerable: true,
      get() {
        reads += 1;
        return "/project";
      },
    });

    await assertRejects(
      () => discoverSourceTriggers(options as never),
      VeryfrontError,
      "Trigger discovery options",
    );
    assertEquals(reads, 0);
  });

  it("rejects discovery directories that escape the project root", async () => {
    const adapter = createMockAdapter();
    await assertRejects(
      () =>
        discoverSourceTriggers({
          projectDir: "/project",
          adapter,
          triggerDir: "../outside",
          sourceKind: "schedule",
          validate: isTestTrigger,
        }),
      VeryfrontError,
      "triggerDir",
    );
  });

  it("rejects malformed public options before filesystem access", async () => {
    const adapter = createMockAdapter();
    let filesystemReads = 0;
    adapter.fs.exists = () => {
      filesystemReads += 1;
      return Promise.resolve(false);
    };

    for (
      const options of [
        {
          projectDir: "",
          adapter,
          triggerDir: "schedules",
          sourceKind: "schedule",
          validate: isTestTrigger,
        },
        {
          projectDir: "/project\nspoof",
          adapter,
          triggerDir: "schedules",
          sourceKind: "schedule",
          validate: isTestTrigger,
        },
        {
          projectDir: "/project",
          adapter,
          triggerDir: "/schedules",
          sourceKind: "schedule",
          validate: isTestTrigger,
        },
        {
          projectDir: "/project",
          adapter,
          triggerDir: "schedules\u202E",
          sourceKind: "schedule",
          validate: isTestTrigger,
        },
        {
          projectDir: "/project\u061Cspoof",
          adapter,
          triggerDir: "schedules",
          sourceKind: "schedule",
          validate: isTestTrigger,
        },
        {
          projectDir: "/project",
          adapter,
          triggerDir: "schedules",
          sourceKind: "timer",
          validate: isTestTrigger,
        },
        {
          projectDir: "/project",
          adapter,
          config: { fs: { type: "unsupported" } },
          triggerDir: "schedules",
          sourceKind: "schedule",
          validate: isTestTrigger,
        },
        {
          projectDir: "/project",
          adapter,
          triggerDir: "schedules",
          sourceKind: "schedule",
          signal: {},
          validate: isTestTrigger,
        },
      ]
    ) {
      const error = await assertRejects(
        () => discoverSourceTriggers(options as never),
        VeryfrontError,
      );
      assertEquals(error.slug, "trigger-config-invalid");
    }
    assertEquals(filesystemReads, 0);
  });
});
