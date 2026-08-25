import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { FILE_NOT_FOUND } from "#veryfront/errors";
import {
  makeTempDir,
  mkdir,
  remove,
  symlink,
  writeTextFile,
} from "#veryfront/platform/compat/fs.ts";
import {
  listSkillSubdir,
  listStrictSkillSubdir,
  listStrictSkillTree,
  validateSkillPath,
  validateStrictSkillPath,
} from "./path-safety.ts";
import { createSkillTestAdapter } from "./testing.ts";
import {
  SKILL_ALLOWED_SUBDIR_MAX_ENTRIES,
  SKILL_RELATIVE_PATH_MAX_LENGTH,
  SKILL_SUBDIR_MAX_ENTRIES,
} from "./limits.ts";
import { createSkillOperationBudget } from "./operation-budget.ts";

async function settlesWithin(promise: Promise<unknown>, timeoutMs = 50): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

describe("src/skill/path-safety", () => {
  describe("validateSkillPath", () => {
    it("should reject absolute paths", async () => {
      try {
        await validateSkillPath("/tmp/skill", "/etc/passwd", ["references"]);
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("validation failed"), true);
      }
    });

    it("should reject parent traversal", async () => {
      const error = await assertRejects(
        () => validateSkillPath("/tmp/skill", "references/../../../etc/passwd", ["references"]),
        Error,
        "Skill path validation failed",
      ) as Error;
      assertStringIncludes(
        error.message,
        "Path is outside base directory",
        "traversal must be rejected by base-directory containment, not by an unrelated error",
      );
    });

    it("should reject wrong subdir", async () => {
      const error = await assertRejects(
        () => validateSkillPath("/tmp/skill", "assets/file.txt", ["scripts"]),
        Error,
        "Skill path validation failed",
      ) as Error;
      assertStringIncludes(
        error.message,
        "Access to directory 'assets' not allowed",
        "the rejected directory is named",
      );
      assertStringIncludes(
        error.message,
        "Allowed: scripts",
        "the allowed list is named",
      );

      const adapter = createSkillTestAdapter({
        "/project/skills/test/scripts/run.sh": "#!/bin/sh",
      });
      assertEquals(
        await validateSkillPath("/project/skills/test", "scripts/run.sh", ["scripts"], adapter),
        "/project/skills/test/scripts/run.sh",
        "an allowlisted directory is not turned into a blanket deny",
      );
    });

    it("allows root files while an empty allowlist still rejects subdirectories", async () => {
      const root = "/project/skills/test";
      const adapter = createSkillTestAdapter({
        [`${root}/SKILL.md`]: "# Test skill",
        [`${root}/references/guide.md`]: "Guide",
      });

      assertEquals(
        await validateSkillPath(root, "SKILL.md", [], adapter),
        `${root}/SKILL.md`,
      );
      assertEquals(
        await validateStrictSkillPath(root, "SKILL.md", [], adapter),
        `${root}/SKILL.md`,
      );
      await assertRejects(
        () => validateSkillPath(root, "references/guide.md", [], adapter),
        Error,
        "allowlist is empty",
      );
      await assertRejects(
        () => validateStrictSkillPath(root, "references/guide.md", [], adapter),
        Error,
        "allowlist is empty",
      );
    });

    it("requires local roots to be absolute and preserves adapter-relative namespaces", async () => {
      await assertRejects(
        () => validateSkillPath("relative/skill", "references/guide.md", ["references"]),
        TypeError,
        "absolute",
      );
      const relativeAdapter = createSkillTestAdapter({
        "skills/relative/SKILL.md": "# Relative",
        "skills/relative/references/guide.md": "Guide",
      });
      assertEquals(
        await validateStrictSkillPath(
          "skills/relative",
          "SKILL.md",
          [],
          relativeAdapter,
        ),
        "skills/relative/SKILL.md",
      );
      assertEquals(
        await listStrictSkillSubdir(
          "skills/relative",
          "references",
          relativeAdapter,
        ),
        ["references/guide.md"],
      );
      await assertRejects(
        () =>
          validateStrictSkillPath(
            "../skills/relative",
            "SKILL.md",
            [],
            relativeAdapter,
          ),
        TypeError,
        "canonical relative path",
      );
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/guide.md": "Guide",
      });
      const allowedSubdirs = [
        "references",
        ...Array.from(
          { length: SKILL_ALLOWED_SUBDIR_MAX_ENTRIES },
          (_unused, index) => `dir-${index}`,
        ),
      ];
      assertEquals(
        await validateSkillPath(
          "/project/skills/test",
          "references/guide.md",
          allowedSubdirs,
          adapter,
        ),
        "/project/skills/test/references/guide.md",
      );
      await assertRejects(
        () =>
          validateStrictSkillPath(
            "/project/skills/test",
            "references/guide.md",
            allowedSubdirs,
            adapter,
          ),
        RangeError,
        `${SKILL_ALLOWED_SUBDIR_MAX_ENTRIES}`,
      );

      assertEquals(
        await validateStrictSkillPath(
          "/project/skills/test",
          "references/guide.md",
          allowedSubdirs.slice(0, SKILL_ALLOWED_SUBDIR_MAX_ENTRIES),
          adapter,
        ),
        "/project/skills/test/references/guide.md",
      );
    });

    it("rejects Proxy allowlists before invoking traps or consulting the filesystem", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/guide.md": "Guide",
      });
      let proxyTrapCalls = 0;
      const allowedSubdirs = new Proxy(["references"], {
        get(target, property, receiver) {
          proxyTrapCalls += 1;
          return Reflect.get(target, property, receiver);
        },
        getOwnPropertyDescriptor(target, property) {
          proxyTrapCalls += 1;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      });

      let failure: unknown;
      try {
        await validateStrictSkillPath(
          "/project/skills/test",
          "references/guide.md",
          allowedSubdirs,
          adapter,
        );
      } catch (error) {
        failure = error;
      }

      assertEquals(failure instanceof TypeError, true);
      assertEquals(
        failure instanceof Error ? failure.message.includes("must not be a proxy") : false,
        true,
      );
      assertEquals(proxyTrapCalls, 0);
    });

    it("does not echo rejected allowlist values into diagnostics", async () => {
      const rejectedValue = "bad\nALLOWLIST_SECRET";
      let failure: unknown;
      try {
        await validateStrictSkillPath(
          "/project/skills/test",
          "SKILL.md",
          [rejectedValue],
          createSkillTestAdapter({
            "/project/skills/test/SKILL.md": "# Demo",
          }),
        );
      } catch (error) {
        failure = error;
      }

      assertEquals(failure instanceof Error, true);
      const message = failure instanceof Error ? failure.message : "";
      assertEquals(message.includes("ALLOWLIST_SECRET"), false);
      assertEquals(message.includes("\n"), false);
    });

    it("keeps directory allowlist decisions independent of Array.prototype mutation", async () => {
      const root = "/project/skills/test";
      const adapter = createSkillTestAdapter({
        [`${root}/scripts/run.sh`]: "echo no",
      });
      const original = Object.getOwnPropertyDescriptor(Array.prototype, "includes");
      let hookCalls = 0;
      Object.defineProperty(Array.prototype, "includes", {
        configurable: true,
        value() {
          hookCalls += 1;
          return true;
        },
        writable: true,
      });

      let failure: unknown;
      try {
        await validateStrictSkillPath(
          root,
          "scripts/run.sh",
          ["references"],
          adapter,
        );
      } catch (error) {
        failure = error;
      } finally {
        if (original) Object.defineProperty(Array.prototype, "includes", original);
      }

      assertEquals(failure instanceof Error, true);
      assertEquals(hookCalls, 0);
    });

    it("does not let inherited index setters rewrite the allowed-directory snapshot", async () => {
      const root = "/project/skills/test";
      const adapter = createSkillTestAdapter({
        [`${root}/scripts/run.sh`]: "echo no",
      });
      const original = Object.getOwnPropertyDescriptor(Array.prototype, "0");
      let authorizationSetterCalls = 0;
      let authorized = false;
      let failure: unknown;
      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        set(value: unknown) {
          if (value === "references") authorizationSetterCalls += 1;
          Object.defineProperty(this, "0", {
            configurable: true,
            enumerable: true,
            value: value === "references" ? "scripts" : value,
            writable: true,
          });
        },
      });

      try {
        try {
          await validateStrictSkillPath(
            root,
            "scripts/run.sh",
            ["references"],
            adapter,
          );
          authorized = true;
        } catch (error) {
          failure = error;
        }
      } finally {
        if (original) {
          Object.defineProperty(Array.prototype, "0", original);
        } else {
          Reflect.deleteProperty(Array.prototype, "0");
        }
      }

      assertEquals(authorized, false);
      assertEquals(failure instanceof Error, true);
      assertEquals(authorizationSetterCalls, 0);
    });

    it("should validate existing files with fsAdapter", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/guide.md": "Guide",
      });
      const validated = await validateSkillPath(
        "/project/skills/test",
        "references/guide.md",
        ["references"],
        adapter,
      );
      assertEquals(validated, "/project/skills/test/references/guide.md");
    });

    it("should reject directories requested as files and files requested as directories", async () => {
      const fileAdapter = createSkillTestAdapter({
        "/project/skills/test/references/guide.md": "Guide",
      });
      await assertRejects(
        () => validateSkillPath("/project/skills/test", "references", ["references"], fileAdapter),
        Error,
        "must point to a file",
        "a directory must not be returned as a validated skill file",
      );

      const directoryAdapter = createSkillTestAdapter({
        "/project/skills/test/SKILL.md": "# Test skill",
        "/project/skills/test/references": "not a directory",
      });
      await assertRejects(
        () => listSkillSubdir("/project/skills/test", "references", directoryAdapter),
        Error,
        "must point to a directory",
        "a file must not be listed as a skill subdirectory",
      );
    });

    it("uses adapter lstat and realPath capabilities to reject escapes", async () => {
      const root = "/project/skills/test";
      const file = `${root}/references/guide.md`;
      const adapter = createSkillTestAdapter({ [file]: "Guide" });

      await assertRejects(
        () =>
          validateStrictSkillPath(root, "references/guide.md", ["references"], {
            ...adapter,
            async lstat(path) {
              const info = await adapter.stat(path);
              return {
                ...info,
                isSymlink: path === `${root}/references`,
              };
            },
          }),
        Error,
        "symlink",
      );

      await assertRejects(
        () =>
          validateSkillPath(root, "references/guide.md", ["references"], {
            ...adapter,
            async lstat(path) {
              return await adapter.stat(path);
            },
            async realPath(path) {
              return path === root ? root : `/outside/${path.split("/").at(-1)}`;
            },
          }),
        Error,
        "escapes root",
      );
    });

    it("keeps the tighter relative-path ceiling on strict validation only", async () => {
      const root = "/project/skills/test";
      const requestedPath = `references/${
        Array.from(
          { length: 6 },
          (_unused, index) => `${index}${"x".repeat(199)}`,
        ).join("/")
      }/guide.md`;
      assertEquals(requestedPath.length > SKILL_RELATIVE_PATH_MAX_LENGTH, true);
      const adapter = createSkillTestAdapter({
        [`${root}/${requestedPath}`]: "Guide",
      });

      assertEquals(
        await validateSkillPath(root, requestedPath, ["references"], adapter),
        `${root}/${requestedPath}`,
      );
      await assertRejects(
        () => validateStrictSkillPath(root, requestedPath, ["references"], adapter),
        TypeError,
        "bounded path",
      );
    });

    it("fails closed when an adapter cannot prove symlink semantics", async () => {
      const safeAdapter = createSkillTestAdapter({
        "/project/skills/test/references/guide.md": "Guide",
      });
      const { symlinkSemantics: _authority, ...unprovenAdapter } = safeAdapter;

      await assertRejects(
        () =>
          validateStrictSkillPath(
            "/project/skills/test",
            "references/guide.md",
            ["references"],
            unprovenAdapter,
          ),
        TypeError,
        "requires own symlinkSemantics:'none' authority or lstat and realPath",
      );
    });

    it("caps fallback adapter enumeration used for symlink detection", async () => {
      const root = "/project/skills/test";
      const file = `${root}/references/guide.md`;
      const adapter = createSkillTestAdapter({ [file]: "Guide" });

      await assertRejects(
        () =>
          validateStrictSkillPath(root, "references/guide.md", ["references"], {
            ...adapter,
            async *readDir() {
              for (let index = 0; index <= SKILL_SUBDIR_MAX_ENTRIES; index += 1) {
                yield {
                  name: `entry-${index}`,
                  isFile: true,
                  isDirectory: false,
                  isSymlink: false,
                };
              }
            },
          }),
        RangeError,
        `${SKILL_SUBDIR_MAX_ENTRIES}`,
      );
    });

    it("honors a shared cancellation budget during strict validation", async () => {
      const adapter = {
        ...createSkillTestAdapter({}),
        exists: () => new Promise<boolean>(() => {}),
      };
      const controller = new AbortController();
      const budget = createSkillOperationBudget({ abortSignal: controller.signal });
      const validateWithBudget = validateStrictSkillPath as unknown as (
        root: string,
        requestedPath: string,
        allowedSubdirs: readonly string[],
        fsAdapter: typeof adapter,
        options: { budget: typeof budget },
      ) => Promise<string>;

      const validation = validateWithBudget(
        "/project/skills/test",
        "references/guide.md",
        ["references"],
        adapter,
        { budget },
      );
      controller.abort(new Error("cancel strict validation"));

      assertEquals(await settlesWithin(validation), true);
    });

    it("should reject symlinked files in local skills", async () => {
      const tempDir = await makeTempDir({ prefix: "vf-skill-path-" });
      const skillRoot = join(tempDir, "skill");
      const referencesDir = join(skillRoot, "references");
      const outsideFile = join(tempDir, "outside.md");
      const symlinkPath = join(referencesDir, "linked.md");

      try {
        await mkdir(referencesDir, { recursive: true });
        await writeTextFile(outsideFile, "outside");

        try {
          await symlink(outsideFile, symlinkPath);
        } catch {
          // Environments without symlink permissions (e.g. CI containers) can't
          // exercise this test. Log a warning so silent skips are visible in output.
          console.warn("[SKIP] symlink test: OS denied symlink creation — skipping");
          return;
        }

        await assertRejects(
          () => validateSkillPath(skillRoot, "references/linked.md", ["references"]),
          Error,
          "symlink",
        );
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });
  });

  describe("listSkillSubdir", () => {
    it("should return empty array for non-existent directory", async () => {
      const result = await listSkillSubdir("/nonexistent/path", "references");
      assertEquals(result, []);
    });

    it("should return empty array when fsAdapter reports optional directory as file-not-found", async () => {
      const adapter = createSkillTestAdapter({});
      const result = await listSkillSubdir("/project/skills/test", "assets", {
        ...adapter,
        async exists(path: string) {
          throw FILE_NOT_FOUND.create({ detail: `File not found: ${path}` });
        },
      });

      assertEquals(result, []);
    });

    it("should propagate non-not-found fsAdapter errors", async () => {
      const adapter = createSkillTestAdapter({});

      await assertRejects(
        () =>
          listSkillSubdir("/project/skills/test", "assets", {
            ...adapter,
            async exists() {
              throw new Error("adapter unavailable");
            },
          }),
        Error,
        "adapter unavailable",
      );
    });

    it("propagates adapter error proxies without invoking prototype traps", async () => {
      const adapter = createSkillTestAdapter({});
      let prototypeReads = 0;
      const hostile = new Proxy(
        FILE_NOT_FOUND.create({ detail: "File not found: optional directory" }),
        {
          getPrototypeOf(): never {
            prototypeReads += 1;
            throw new Error("getPrototypeOf trap must not run");
          },
        },
      );

      let failure: unknown;
      try {
        await listSkillSubdir("/project/skills/test", "assets", {
          ...adapter,
          async exists() {
            throw hostile;
          },
        });
      } catch (error) {
        failure = error;
      }

      assertEquals(prototypeReads, 0);
      assertEquals(failure === hostile, true);
    });

    it("should list files via fsAdapter", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/a.md": "A",
        "/project/skills/test/references/b.md": "B",
        "/project/skills/test/references/release notes.md": "Notes",
        "/project/skills/test/references/översikt.md": "Overview",
      });
      const result = await listSkillSubdir("/project/skills/test", "references", adapter);
      assertEquals(result, [
        "references/a.md",
        "references/b.md",
        "references/översikt.md",
        "references/release notes.md",
      ]);
    });

    it("rejects non-canonical subdirectory paths before adapter access", async () => {
      let adapterCalls = 0;
      const adapter = createSkillTestAdapter({});

      for (const subdir of ["", ".", "..", "../secrets", "references/nested", "bad\\path"]) {
        await assertRejects(
          () =>
            listSkillSubdir("/project/skills/test", subdir, {
              ...adapter,
              exists() {
                adapterCalls += 1;
                return Promise.resolve(true);
              },
            }),
          Error,
          "subdirectory",
        );
      }
      assertEquals(adapterCalls, 0);
    });

    it("rejects unsafe adapter entry names", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/ok.md": "ok",
      });

      await assertRejects(
        () =>
          listSkillSubdir("/project/skills/test", "references", {
            ...adapter,
            async *readDir() {
              yield {
                name: "../secret.md",
                isFile: true,
                isDirectory: false,
                isSymlink: false,
              };
            },
          }),
        Error,
        "entry name",
      );
    });

    it("does not echo rejected adapter entry names into diagnostics", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/ok.md": "ok",
      });
      let failure: unknown;
      try {
        await listStrictSkillSubdir(
          "/project/skills/test",
          "references",
          {
            ...adapter,
            async *readDir() {
              yield {
                name: "bad\nENTRY_SECRET",
                isFile: true,
                isDirectory: false,
                isSymlink: false,
              };
            },
          },
        );
      } catch (error) {
        failure = error;
      }

      assertEquals(failure instanceof Error, true);
      const message = failure instanceof Error ? failure.message : "";
      assertEquals(message.includes("ENTRY_SECRET"), false);
      assertEquals(message.includes("\n"), false);
    });

    it("rejects accessor-backed adapter entries without reading them twice", async () => {
      const root = "/project/skills/test";
      const adapter = createSkillTestAdapter({
        [`${root}/references/ok.md`]: "ok",
      });
      let nameReads = 0;
      const entry = Object.defineProperties({}, {
        name: {
          enumerable: true,
          get() {
            nameReads += 1;
            return nameReads === 1 ? "ok.md" : "../secret.md";
          },
        },
        isFile: { enumerable: true, value: true },
        isDirectory: { enumerable: true, value: false },
        isSymlink: { enumerable: true, value: false },
      });

      let failure: unknown;
      try {
        await listStrictSkillSubdir(root, "references", {
          ...adapter,
          async *readDir(path) {
            if (path === `${root}/references`) {
              yield entry as never;
              return;
            }
            yield* adapter.readDir(path);
          },
        });
      } catch (error) {
        failure = error;
      }

      assertEquals(failure instanceof TypeError, true);
      assertEquals(nameReads, 0);
    });

    it("preserves public adapter order while strict listings sort deterministically", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/a.md": "A",
      });
      const unorderedAdapter = {
        ...adapter,
        async *readDir() {
          yield { name: "z.md", isFile: true, isDirectory: false, isSymlink: false };
          yield { name: "a.md", isFile: true, isDirectory: false, isSymlink: false };
        },
      };

      assertEquals(
        await listSkillSubdir(
          "/project/skills/test",
          "references",
          unorderedAdapter,
        ),
        ["references/z.md", "references/a.md"],
      );
      assertEquals(
        await listStrictSkillSubdir(
          "/project/skills/test",
          "references",
          unorderedAdapter,
        ),
        ["references/a.md", "references/z.md"],
      );
    });

    it("recursively lists a bounded strict tree in deterministic path order", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/scripts/z.ts": "export {};",
        "/project/skills/test/scripts/lib/b.ts": "export {};",
        "/project/skills/test/scripts/lib/a.ts": "export {};",
        "/project/skills/test/scripts/jobs/run.ts": "export {};",
      });

      assertEquals(
        await listStrictSkillTree(
          "/project/skills/test",
          "scripts",
          adapter,
        ),
        [
          "scripts/jobs/run.ts",
          "scripts/lib/a.ts",
          "scripts/lib/b.ts",
          "scripts/z.ts",
        ],
      );
    });

    it("rejects a nested directory that becomes a symlink during traversal", async () => {
      const root = "/project/skills/test";
      const adapter = createSkillTestAdapter({
        [`${root}/scripts/lib/helper.ts`]: "export {};",
      });
      const racingAdapter = {
        ...adapter,
        async lstat(path: string) {
          return {
            ...await adapter.stat(path),
            isSymlink: path === `${root}/scripts/lib`,
          };
        },
        realPath: (path: string) => Promise.resolve(path),
      };

      await assertRejects(
        () => listStrictSkillTree(root, "scripts", racingAdapter),
        Error,
        "symlink",
      );
    });

    it("caps entries across the whole strict tree", async () => {
      const files: Record<string, string> = {};
      for (let index = 0; index < 500; index += 1) {
        files[`/project/skills/test/scripts/a/file-${index}.ts`] = "export {};";
      }
      for (let index = 0; index < 499; index += 1) {
        files[`/project/skills/test/scripts/b/file-${index}.ts`] = "export {};";
      }
      const adapter = createSkillTestAdapter(files);
      const identityAwareAdapter = {
        ...adapter,
        lstat: (path: string) => adapter.stat(path),
        realPath: (path: string) => Promise.resolve(path),
      };

      await assertRejects(
        () =>
          listStrictSkillTree(
            "/project/skills/test",
            "scripts",
            identityAwareAdapter,
          ),
        RangeError,
        `at most ${SKILL_SUBDIR_MAX_ENTRIES}`,
      );
    });

    it("keeps the entry cap on strict listings only", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/a.md": "A",
      });
      const largeAdapter = {
        ...adapter,
        async *readDir() {
          for (let index = 0; index < 1_001; index++) {
            yield {
              name: `file-${index}.md`,
              isFile: true,
              isDirectory: false,
              isSymlink: false,
            };
          }
        },
      };

      assertEquals(
        (
          await listSkillSubdir(
            "/project/skills/test",
            "references",
            largeAdapter,
          )
        ).length,
        1_001,
      );
      await assertRejects(
        () =>
          listStrictSkillSubdir(
            "/project/skills/test",
            "references",
            largeAdapter,
          ),
        RangeError,
        "at most 1000",
      );
    });

    it("honors a shared cancellation budget during strict listing", async () => {
      const adapter = {
        ...createSkillTestAdapter({}),
        exists: () => new Promise<boolean>(() => {}),
      };
      const controller = new AbortController();
      const budget = createSkillOperationBudget({ abortSignal: controller.signal });
      const listWithBudget = listStrictSkillSubdir as unknown as (
        root: string,
        subdir: string,
        fsAdapter: typeof adapter,
        options: { budget: typeof budget },
      ) => Promise<string[]>;

      const listing = listWithBudget(
        "/project/skills/test",
        "references",
        adapter,
        { budget },
      );
      controller.abort(new Error("cancel strict listing"));

      assertEquals(await settlesWithin(listing), true);
    });

    it("rejects symlinked local subdirectories instead of listing their targets", async () => {
      const tempDir = await makeTempDir({ prefix: "vf-skill-list-" });
      const skillRoot = join(tempDir, "skill");
      const outsideDir = join(tempDir, "outside");
      const linkedDir = join(skillRoot, "references");

      try {
        await mkdir(skillRoot, { recursive: true });
        await mkdir(outsideDir, { recursive: true });
        await writeTextFile(join(outsideDir, "secret.md"), "secret");

        try {
          await symlink(outsideDir, linkedDir);
        } catch {
          console.warn("[SKIP] symlink directory test: OS denied symlink creation — skipping");
          return;
        }

        await assertRejects(
          () => listSkillSubdir(skillRoot, "references"),
          Error,
          "symlink",
        );
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });

    it("rejects unsafe adapter entry names and symlinks", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/ok.md": "ok",
      });
      for (const name of ["", ".", "..", "../secret.md", "bad\\name.md", "bad\nname.md"]) {
        await assertRejects(
          () =>
            listSkillSubdir("/project/skills/test", "references", {
              ...adapter,
              exists: () => Promise.resolve(true),
              async *readDir() {
                yield {
                  name,
                  isFile: true,
                  isDirectory: false,
                  isSymlink: false,
                };
              },
            }),
          Error,
          "entry name",
        );
      }

      await assertRejects(
        () =>
          listSkillSubdir("/project/skills/test", "references", {
            ...adapter,
            exists: () => Promise.resolve(true),
            async *readDir() {
              yield {
                name: "linked.md",
                isFile: true,
                isDirectory: false,
                isSymlink: true,
              };
            },
          }),
        Error,
        "symlink",
      );

      await assertRejects(
        () =>
          listSkillSubdir("/project/skills/test", "references", {
            ...adapter,
            exists: () => Promise.resolve(true),
            async *readDir() {
              for (let index = 0; index < 2; index++) {
                yield {
                  name: "duplicate.md",
                  isFile: true,
                  isDirectory: false,
                  isSymlink: false,
                };
              }
            },
          }),
        TypeError,
        "duplicate entry name",
      );
    });
  });
});
