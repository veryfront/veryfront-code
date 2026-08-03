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

async function waitUntil(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for lock test state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function makeEveryLeaseExpired(lockDirectory: string): Promise<void> {
  for await (const entry of Deno.readDir(lockDirectory)) {
    if (entry.name.endsWith(".lease")) {
      await Deno.utime(join(lockDirectory, entry.name), new Date(0), new Date(0));
    }
  }
}

describe("local JSON RAG store lock generations", () => {
  for (const mutation of ["add", "remove", "replace"] as const) {
    const pastTense = mutation === "add" ? "added" : mutation === "remove" ? "removed" : "replaced";
    it(`restores a stale lock when a lease is ${pastTense} before the move`, async () => {
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

        let settled = false;
        try {
          const pending = withLocalJsonStoreLock(storagePath, async () => undefined).finally(() => {
            settled = true;
          });
          await waitUntil(() => restores === 1);
          assertEquals(await exists(seeded.lockDirectory), true);

          if (mutation === "remove") {
            await pending;
          } else {
            // A valid owner that points at another token cannot make a fresh
            // foreign lease stale. Every observed lease governs recovery.
            await new Promise((resolve) => setTimeout(resolve, 50));
            assertEquals(settled, false);
            assertEquals(await exists(foreignLeasePath), true);
            await makeEveryLeaseExpired(seeded.lockDirectory);
            await pending;
          }

          assertEquals(mutated, true);
          assertEquals(restores, 1);
          assertEquals(recoveryMoves >= 2, true);
          assertEquals(await exists(seeded.lockDirectory), false);
          assertEquals(await exists(recoveryDirectory), false);
        } finally {
          Object.defineProperty(Deno, "rename", renameDescriptor);
        }
      });
    });
  }

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
