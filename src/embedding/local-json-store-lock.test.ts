import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { exists, withTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import { LocalJsonStoreLockError, withLocalJsonStoreLock } from "./local-json-store-lock.ts";

interface SeededLock {
  readonly lockDirectory: string;
  readonly ownerToken: string;
  readonly ownerLeasePath: string;
}

async function seedExpiredLock(storagePath: string): Promise<SeededLock> {
  const lockDirectory = `${storagePath}.veryfront-rag.lock`;
  const ownerToken = crypto.randomUUID();
  const ownerLeasePath = join(lockDirectory, `${ownerToken}.lease`);
  await Deno.mkdir(lockDirectory, { recursive: true });
  await Deno.writeTextFile(
    join(lockDirectory, "owner.json"),
    `${JSON.stringify({ token: ownerToken, createdAtMs: 1 })}\n`,
  );
  await Deno.writeTextFile(ownerLeasePath, "expired\n");
  await Deno.utime(ownerLeasePath, new Date(0), new Date(0));
  return { lockDirectory, ownerToken, ownerLeasePath };
}

describe("local JSON RAG store lock generations", () => {
  it("fails closed without overwriting an empty lock directory created during recovery restoration", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const seeded = await seedExpiredLock(storagePath);
      const recoveryDirectory = `${seeded.lockDirectory}.recovering`;
      const renameDescriptor = Object.getOwnPropertyDescriptor(Deno, "rename");
      assert(renameDescriptor !== undefined);
      const originalRename = Deno.rename.bind(Deno);
      let createdReplacement = false;
      let restorationAttempted = false;
      Object.defineProperty(Deno, "rename", {
        ...renameDescriptor,
        value: async (from: string | URL, to: string | URL) => {
          const fromPath = String(from);
          const toPath = String(to);
          if (fromPath === seeded.lockDirectory && toPath === recoveryDirectory) {
            await Deno.remove(seeded.ownerLeasePath);
          }
          if (fromPath === recoveryDirectory && toPath === seeded.lockDirectory) {
            restorationAttempted = true;
            createdReplacement = true;
            await Deno.mkdir(seeded.lockDirectory);
          }
          await originalRename(from, to);
        },
      });

      try {
        await assertRejects(
          () => withLocalJsonStoreLock(storagePath, async () => undefined),
          LocalJsonStoreLockError,
          "ownership changed during stale-lock recovery",
        );
        assertEquals(createdReplacement, false);
        assertEquals(restorationAttempted, false);
        assertEquals(await exists(seeded.lockDirectory), false);
        assertEquals(await exists(recoveryDirectory), true);
      } finally {
        Object.defineProperty(Deno, "rename", renameDescriptor);
      }
    });
  });

  it("fails closed when another owner appears while an unexpected recovery is restored", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const seeded = await seedExpiredLock(storagePath);
      const recoveryDirectory = `${seeded.lockDirectory}.recovering`;
      const renameDescriptor = Object.getOwnPropertyDescriptor(Deno, "rename");
      assert(renameDescriptor !== undefined);
      const originalRename = Deno.rename.bind(Deno);
      let moved = false;
      let collided = false;
      Object.defineProperty(Deno, "rename", {
        ...renameDescriptor,
        value: async (from: string | URL, to: string | URL) => {
          const fromPath = String(from);
          const toPath = String(to);
          if (!moved && fromPath === seeded.lockDirectory && toPath === recoveryDirectory) {
            moved = true;
            await Deno.writeTextFile(
              join(seeded.lockDirectory, "owner.json"),
              `${JSON.stringify({ token: crypto.randomUUID(), createdAtMs: 1 })}\n`,
            );
          }
          await originalRename(from, to);
          if (!collided && fromPath === recoveryDirectory && toPath === seeded.lockDirectory) {
            collided = true;
            for await (const entry of Deno.readDir(seeded.lockDirectory)) {
              await Deno.remove(join(seeded.lockDirectory, entry.name));
            }
            const replacementToken = crypto.randomUUID();
            await Deno.writeTextFile(
              join(seeded.lockDirectory, "owner.json"),
              `${JSON.stringify({ token: replacementToken, createdAtMs: 1 })}\n`,
            );
            const replacementLease = join(seeded.lockDirectory, `${replacementToken}.lease`);
            await Deno.writeTextFile(replacementLease, "replacement\n");
            await Deno.utime(replacementLease, new Date(0), new Date(0));
          }
        },
      });

      try {
        await assertRejects(
          () => withLocalJsonStoreLock(storagePath, async () => undefined),
          LocalJsonStoreLockError,
          "ownership changed during stale-lock recovery",
        );
        assertEquals(moved, true);
        assertEquals(collided, false);
        assertEquals(await exists(seeded.lockDirectory), false);
        assertEquals(await exists(recoveryDirectory), true);
      } finally {
        Object.defineProperty(Deno, "rename", renameDescriptor);
      }
    });
  });

  for (const mutation of ["add", "remove", "replace"] as const) {
    const pastTense = mutation === "add" ? "added" : mutation === "remove" ? "removed" : "replaced";
    it(`fails closed when a lease is ${pastTense} before the recovery move`, async () => {
      await withTempDir(async (tempDir) => {
        const storagePath = join(tempDir, "data", "index.json");
        const seeded = await seedExpiredLock(storagePath);
        const recoveryDirectory = `${seeded.lockDirectory}.recovering`;
        const foreignLeasePath = join(
          seeded.lockDirectory,
          `${crypto.randomUUID()}.lease`,
        );
        const renameDescriptor = Object.getOwnPropertyDescriptor(Deno, "rename");
        assert(renameDescriptor !== undefined);
        const originalRename = Deno.rename.bind(Deno);
        let mutated = false;
        let restores = 0;
        let recoveryMoves = 0;
        Object.defineProperty(Deno, "rename", {
          ...renameDescriptor,
          value: async (from: string | URL, to: string | URL) => {
            const fromPath = String(from);
            const toPath = String(to);
            if (
              !mutated && fromPath === seeded.lockDirectory &&
              toPath === recoveryDirectory
            ) {
              mutated = true;
              if (mutation !== "add") await Deno.remove(seeded.ownerLeasePath);
              if (mutation !== "remove") {
                await Deno.writeTextFile(foreignLeasePath, "fresh foreign generation\n");
              }
            }
            if (fromPath === seeded.lockDirectory && toPath === recoveryDirectory) {
              recoveryMoves++;
            }
            if (fromPath === recoveryDirectory && toPath === seeded.lockDirectory) {
              restores++;
            }
            await originalRename(from, to);
          },
        });

        try {
          await assertRejects(
            () => withLocalJsonStoreLock(storagePath, async () => undefined),
            LocalJsonStoreLockError,
            "ownership changed during stale-lock recovery",
          );

          assertEquals(mutated, true);
          assertEquals(restores, 0);
          assertEquals(recoveryMoves, 1);
          assertEquals(await exists(seeded.lockDirectory), false);
          assertEquals(await exists(recoveryDirectory), true);
        } finally {
          Object.defineProperty(Deno, "rename", renameDescriptor);
        }
      });
    });
  }

  for (const change of ["entry disappearance", "owner disappearance"] as const) {
    it(`retries a transient ${change} while observing a contended lock`, async () => {
      await withTempDir(async (tempDir) => {
        const storagePath = join(tempDir, "data", "index.json");
        const seeded = await seedExpiredLock(storagePath);
        const ownerPath = join(seeded.lockDirectory, "owner.json");
        const lstatDescriptor = Object.getOwnPropertyDescriptor(Deno, "lstat");
        assert(lstatDescriptor !== undefined);
        const originalLstat = Deno.lstat.bind(Deno);
        let changed = false;
        Object.defineProperty(Deno, "lstat", {
          ...lstatDescriptor,
          value: async (path: string | URL) => {
            const pathString = String(path);
            if (
              !changed && change === "entry disappearance" && pathString === seeded.ownerLeasePath
            ) {
              changed = true;
              await Deno.remove(seeded.ownerLeasePath);
            }
            const info = await originalLstat(path);
            if (!changed && change === "owner disappearance" && pathString === ownerPath) {
              changed = true;
              await Deno.remove(ownerPath);
            }
            return info;
          },
        });

        try {
          await withLocalJsonStoreLock(storagePath, async () => undefined);
          assertEquals(changed, true);
          assertEquals(await exists(seeded.lockDirectory), false);
        } finally {
          Object.defineProperty(Deno, "lstat", lstatDescriptor);
        }
      });
    });
  }

  it("retries a transient entry disappearance in an interrupted recovery", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const seeded = await seedExpiredLock(storagePath);
      const recoveryDirectory = `${seeded.lockDirectory}.recovering`;
      const recoveryLeasePath = join(recoveryDirectory, `${seeded.ownerToken}.lease`);
      await Deno.rename(seeded.lockDirectory, recoveryDirectory);
      const lstatDescriptor = Object.getOwnPropertyDescriptor(Deno, "lstat");
      assert(lstatDescriptor !== undefined);
      const originalLstat = Deno.lstat.bind(Deno);
      let changed = false;
      Object.defineProperty(Deno, "lstat", {
        ...lstatDescriptor,
        value: async (path: string | URL) => {
          if (!changed && String(path) === recoveryLeasePath) {
            changed = true;
            await Deno.remove(recoveryLeasePath);
          }
          return await originalLstat(path);
        },
      });

      try {
        await withLocalJsonStoreLock(storagePath, async () => undefined);
        assertEquals(changed, true);
        assertEquals(await exists(seeded.lockDirectory), false);
        assertEquals(await exists(recoveryDirectory), false);
      } finally {
        Object.defineProperty(Deno, "lstat", lstatDescriptor);
      }
    });
  });

  for (const phase of ["open", "iteration"] as const) {
    it(`retries when a lock directory disappears during readDir ${phase}`, async () => {
      await withTempDir(async (tempDir) => {
        const storagePath = join(tempDir, "data", "index.json");
        const seeded = await seedExpiredLock(storagePath);
        const readDirDescriptor = Object.getOwnPropertyDescriptor(Deno, "readDir");
        assert(readDirDescriptor !== undefined);
        const originalReadDir = Deno.readDir.bind(Deno);
        let changed = false;
        Object.defineProperty(Deno, "readDir", {
          ...readDirDescriptor,
          value: (path: string | URL) => {
            if (!changed && String(path) === seeded.lockDirectory) {
              changed = true;
              if (phase === "open") {
                return {
                  [Symbol.asyncIterator]() {
                    return {
                      async next() {
                        await Deno.remove(seeded.lockDirectory, { recursive: true });
                        throw new Deno.errors.NotFound("lock directory disappeared");
                      },
                    };
                  },
                };
              }
              const entries = originalReadDir(path);
              return (async function* () {
                for await (const entry of entries) {
                  yield entry;
                  await Deno.remove(seeded.lockDirectory, { recursive: true });
                  throw new Deno.errors.NotFound("lock directory disappeared");
                }
              })();
            }
            return originalReadDir(path);
          },
        });

        try {
          await withLocalJsonStoreLock(storagePath, async () => undefined);
          assertEquals(changed, true);
          assertEquals(await exists(seeded.lockDirectory), false);
        } finally {
          Object.defineProperty(Deno, "readDir", readDirDescriptor);
        }
      });
    });
  }

  it("propagates non-transient lock validation failures", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const seeded = await seedExpiredLock(storagePath);
      await Deno.writeTextFile(join(seeded.lockDirectory, "unexpected"), "invalid\n");

      await assertRejects(
        () => withLocalJsonStoreLock(storagePath, async () => undefined),
        LocalJsonStoreLockError,
        "unexpected entry",
      );
    });
  });

  it("fails closed when any observed lease has no modification time", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const seeded = await seedExpiredLock(storagePath);
      const lstatDescriptor = Object.getOwnPropertyDescriptor(Deno, "lstat");
      const renameDescriptor = Object.getOwnPropertyDescriptor(Deno, "rename");
      assert(lstatDescriptor !== undefined);
      assert(renameDescriptor !== undefined);
      const originalLstat = Deno.lstat.bind(Deno);
      const originalRename = Deno.rename.bind(Deno);
      let recoveryMoves = 0;
      Object.defineProperty(Deno, "lstat", {
        ...lstatDescriptor,
        value: async (path: string | URL) => {
          const info = await originalLstat(path);
          return String(path) === seeded.ownerLeasePath ? { ...info, mtime: null } : info;
        },
      });
      Object.defineProperty(Deno, "rename", {
        ...renameDescriptor,
        value: async (from: string | URL, to: string | URL) => {
          if (String(from) === seeded.lockDirectory) recoveryMoves++;
          await originalRename(from, to);
        },
      });

      let settled = false;
      try {
        const pending = withLocalJsonStoreLock(storagePath, async () => undefined).finally(() => {
          settled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 75));
        assertEquals(settled, false);
        assertEquals(recoveryMoves, 0);
        Object.defineProperty(Deno, "lstat", lstatDescriptor);
        await pending;
        assertEquals(recoveryMoves, 1);
      } finally {
        Object.defineProperty(Deno, "lstat", lstatDescriptor);
        Object.defineProperty(Deno, "rename", renameDescriptor);
      }
    });
  });

  it("requires the owner's token-specific lease for ownership assertions", async () => {
    await withTempDir(async (tempDir) => {
      const storagePath = join(tempDir, "data", "index.json");
      const lockDirectory = `${storagePath}.veryfront-rag.lock`;
      await withLocalJsonStoreLock(storagePath, async (lease) => {
        const leaseEntries = (await Array.fromAsync(Deno.readDir(lockDirectory)))
          .filter((entry) => entry.name.endsWith(".lease"));
        assertEquals(leaseEntries.length, 1);
        const ownerLeasePath = join(lockDirectory, leaseEntries[0]!.name);
        await Deno.remove(ownerLeasePath);
        const foreignLeasePath = join(lockDirectory, `${crypto.randomUUID()}.lease`);
        await Deno.writeTextFile(
          foreignLeasePath,
          "foreign\n",
        );
        await assertRejects(
          () => lease.assertOwned(),
          LocalJsonStoreLockError,
          "ownership was lost",
        );
        await Deno.remove(foreignLeasePath);
        await Deno.writeTextFile(ownerLeasePath, "restored owner lease\n");
      });
      assertEquals(await exists(lockDirectory), false);
    });
  });
});
