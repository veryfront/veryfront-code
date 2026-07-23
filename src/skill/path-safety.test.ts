import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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
import { listSkillSubdir, validateSkillPath } from "./path-safety.ts";
import { createSkillTestAdapter } from "./testing.ts";

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
      await assertRejects(
        () => validateSkillPath("/tmp/skill", "references/../../../etc/passwd", ["references"]),
        Error,
        "validation failed",
      );
    });

    it("should reject wrong subdir", async () => {
      await assertRejects(
        () => validateSkillPath("/tmp/skill", "assets/file.txt", ["scripts"]),
        Error,
        "validation failed",
      );
    });

    it("should reject an empty directory allowlist instead of allowing the entire root", async () => {
      await assertRejects(
        () => validateSkillPath("/tmp/skill", "secret.txt", []),
        Error,
        "non-empty directory allowlist",
      );
    });

    it("should reject unbounded requested paths before filesystem access", async () => {
      await assertRejects(
        () => validateSkillPath("/tmp/skill", `references/${"a".repeat(4_096)}`, ["references"]),
        Error,
        "bounded path string",
      );
    });

    it("should reject invalid allowlists and excessive path depth", async () => {
      const sparse = Array<string>(1);
      await assertRejects(
        () => validateSkillPath("/tmp/skill", "references/guide.md", sparse),
        Error,
        "allowlist must be dense",
      );
      await assertRejects(
        () => validateSkillPath("/tmp/skill", "references/guide.md", ["../references"]),
        Error,
        "invalid entry",
      );

      let accessorInvoked = false;
      const accessorBacked = Object.defineProperty([], "0", {
        configurable: true,
        enumerable: true,
        get() {
          accessorInvoked = true;
          return "references";
        },
      }) as string[];
      await assertRejects(
        () => validateSkillPath("/tmp/skill", "references/guide.md", accessorBacked),
        Error,
        "data entries",
      );
      assertEquals(accessorInvoked, false);

      const revoked = Proxy.revocable(["references"], {});
      revoked.revoke();
      await assertRejects(
        () => validateSkillPath("/tmp/skill", "references/guide.md", revoked.proxy),
        Error,
        "allowlist must be readable",
      );

      const segments = Array.from({ length: 64 }, (_, index) => `level-${index}`);
      const requested = `references/${segments.join("/")}/guide.md`;
      const absolute = `/project/skills/test/${requested}`;
      await assertRejects(
        () =>
          validateSkillPath(
            "/project/skills/test",
            requested,
            ["references"],
            createSkillTestAdapter({ [absolute]: "Guide" }),
          ),
        Error,
        "too many segments",
      );
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

    it("should reject adapter paths that are not files or contain symlinks", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/guide.md": "Guide",
      });
      await assertRejects(
        () =>
          validateSkillPath(
            "/project/skills/test",
            "references/guide.md",
            ["references"],
            {
              ...adapter,
              async stat(path: string) {
                const info = await adapter.stat(path);
                return path.endsWith("guide.md")
                  ? { ...info, isFile: false, isDirectory: true }
                  : info;
              },
            },
          ),
        Error,
        "must point to a file",
      );

      await assertRejects(
        () =>
          validateSkillPath(
            "/project/skills/test",
            "references/guide.md",
            ["references"],
            {
              ...adapter,
              async lstat(path: string) {
                const info = await adapter.stat(path);
                return { ...info, isSymlink: path.endsWith("guide.md") };
              },
            },
          ),
        Error,
        "contains a symlink",
      );
    });

    it("should enforce adapter canonical containment when realPath is available", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/guide.md": "Guide",
      });

      await assertRejects(
        () =>
          validateSkillPath(
            "/project/skills/test",
            "references/guide.md",
            ["references"],
            {
              ...adapter,
              async realPath(path: string) {
                return path.endsWith("guide.md")
                  ? "/outside/private/guide.md"
                  : "/project/skills/test";
              },
            },
          ),
        Error,
        "escapes its root directory",
      );
    });

    it("should reject duplicate adapter entries while checking symlink policy", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/guide.md": "Guide",
      });

      await assertRejects(
        () =>
          validateSkillPath(
            "/project/skills/test",
            "references/guide.md",
            ["references"],
            {
              ...adapter,
              async *readDir(path: string) {
                if (path.endsWith("/references")) {
                  yield {
                    name: "guide.md",
                    isFile: true,
                    isDirectory: false,
                    isSymlink: false,
                  };
                  yield {
                    name: "guide.md",
                    isFile: false,
                    isDirectory: false,
                    isSymlink: true,
                  };
                  return;
                }
                yield* adapter.readDir(path);
              },
            },
          ),
        Error,
        "duplicate entry",
      );
    });

    it("should sanitize adapter inspection failures", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/guide.md": "Guide",
      });
      await assertRejects(
        () =>
          validateSkillPath(
            "/project/skills/test",
            "references/guide.md",
            ["references"],
            {
              ...adapter,
              async stat() {
                throw new Error("private adapter path");
              },
            },
          ),
        Error,
        "Unable to inspect the requested skill path",
      );
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
          // Environments without symlink permissions (e.g. CI containers) cannot
          // exercise this test. Log a warning so silent skips are visible in output.
          console.warn("[SKIP] symlink test: OS denied symlink creation, skipping");
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

    it("should reject traversal in the requested subdirectory", async () => {
      await assertRejects(
        () => listSkillSubdir("/project/skills/test", "../private"),
        Error,
        "safe directory name",
      );
    });

    it("should reject a symlinked local subdirectory before enumerating its target", async () => {
      const tempDir = await makeTempDir({ prefix: "vf-skill-list-path-" });
      const skillRoot = join(tempDir, "skill");
      const outsideDir = join(tempDir, "outside");
      try {
        await mkdir(skillRoot, { recursive: true });
        await mkdir(outsideDir, { recursive: true });
        await writeTextFile(join(outsideDir, "secret.md"), "secret");
        try {
          await symlink(outsideDir, join(skillRoot, "references"));
        } catch {
          console.warn("[SKIP] symlink test: OS denied symlink creation");
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

    it("should sanitize non-not-found fsAdapter errors", async () => {
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
        "Unable to inspect the requested skill directory",
      );
    });

    it("should list files via fsAdapter", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/b.md": "B",
        "/project/skills/test/references/a.md": "A",
      });
      const result = await listSkillSubdir("/project/skills/test", "references", adapter);
      assertEquals(result, ["references/a.md", "references/b.md"]);
    });

    it("should list nested files deterministically via fsAdapter", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/guides/z.md": "Z",
        "/project/skills/test/references/guides/a.md": "A",
        "/project/skills/test/references/root.md": "Root",
      });

      assertEquals(
        await listSkillSubdir("/project/skills/test", "references", adapter),
        [
          "references/guides/a.md",
          "references/guides/z.md",
          "references/root.md",
        ],
      );
    });

    it("should reject invalid adapter entry names", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/guide.md": "Guide",
      });

      await assertRejects(
        () =>
          listSkillSubdir("/project/skills/test", "references", {
            ...adapter,
            async *readDir(path: string) {
              if (path.endsWith("/references")) {
                yield {
                  name: "../secret.md",
                  isFile: true,
                  isDirectory: false,
                  isSymlink: false,
                };
                return;
              }
              yield* adapter.readDir(path);
            },
          }),
        Error,
        "invalid entry name",
      );
    });

    it("should reject symlink entries and non-directory subpaths", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/guide.md": "Guide",
      });
      await assertRejects(
        () =>
          listSkillSubdir("/project/skills/test", "references", {
            ...adapter,
            async stat(path: string) {
              const info = await adapter.stat(path);
              return { ...info, isFile: true, isDirectory: false };
            },
          }),
        Error,
        "must point to a directory",
      );

      await assertRejects(
        () =>
          listSkillSubdir("/project/skills/test", "references", {
            ...adapter,
            async *readDir(path: string) {
              if (path.endsWith("/references")) {
                yield {
                  name: "linked.md",
                  isFile: false,
                  isDirectory: false,
                  isSymlink: true,
                };
                return;
              }
              yield* adapter.readDir(path);
            },
          }),
        Error,
        "contains a symlink",
      );
    });

    it("should enforce the per-directory file limit", async () => {
      const adapter = createSkillTestAdapter({
        "/project/skills/test/references/seed.md": "seed",
      });
      await assertRejects(
        () =>
          listSkillSubdir("/project/skills/test", "references", {
            ...adapter,
            async *readDir(path: string) {
              if (!path.endsWith("/references")) {
                yield* adapter.readDir(path);
                return;
              }
              for (let index = 0; index <= 1_000; index += 1) {
                yield {
                  name: `file-${index}.md`,
                  isFile: true,
                  isDirectory: false,
                  isSymlink: false,
                };
              }
            },
          }),
        Error,
        "file limit exceeded",
      );
    });

    it("should stop listing when the caller is already aborted", async () => {
      const controller = new AbortController();
      controller.abort(new Error("listing canceled"));

      await assertRejects(
        () => listSkillSubdir("/project/skills/test", "references", undefined, controller.signal),
        Error,
        "listing canceled",
      );
    });
  });
});
