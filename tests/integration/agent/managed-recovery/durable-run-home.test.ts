import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { it } from "#veryfront/testing/bdd.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { DurableRunHome } from "#veryfront/internal-agents/durable-run-home.ts";

const identity = {
  projectId: "11111111-1111-4111-8111-111111111111",
  canonicalRunId: "22222222-2222-4222-8222-222222222222",
  publicRunId: "run-proof",
  agentId: "proof-agent",
  threadId: "77777777-7777-4777-8777-777777777777",
  sourceHash: "a".repeat(64),
};
it("durable home survives reopening and rejects a foreign identity", async () => {
  const directory = await makeTempDir();
  try {
    const home = await DurableRunHome.open({ directory, identity });
    await home.append({ sequence: 1, value: { kind: "entered" } });
    const reopened = await DurableRunHome.open({ directory, identity });
    assertEquals(await reopened.read(), [{ sequence: 1, value: { kind: "entered" } }]);
    await assertRejects(() =>
      DurableRunHome.open({
        directory,
        identity: { ...identity, sourceHash: "b".repeat(64) },
      })
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("durable home rejects gaps, conflicting retries, corrupt and torn committed bytes", async () => {
  const directory = await makeTempDir();
  try {
    const home = await DurableRunHome.open({ directory, identity });
    await assertRejects(() => home.append({ sequence: 2, value: null }));
    await home.append({ sequence: 1, value: { committed: true } });
    await home.append({ sequence: 1, value: { committed: true } });
    await assertRejects(() => home.append({ sequence: 1, value: { committed: false } }));
    const recordPath = `${directory}/0000000001.json`;
    const original = await Deno.readTextFile(recordPath);
    await Deno.writeTextFile(recordPath, original.replace("committed", "corrupted"));
    await assertRejects(() => DurableRunHome.open({ directory, identity }));
    await Deno.writeTextFile(recordPath, original.slice(0, -4));
    await assertRejects(() => home.read());
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("concurrent handles cannot overwrite a committed sequence", async () => {
  const directory = await makeTempDir();
  try {
    const [a, b] = await Promise.all([
      DurableRunHome.open({ directory, identity }),
      DurableRunHome.open({ directory, identity }),
    ]);
    const results = await Promise.allSettled([
      a.append({ sequence: 1, value: "A" }),
      b.append({ sequence: 1, value: "B" }),
    ]);
    assertEquals(results.filter((result) => result.status === "fulfilled").length, 1);
    assertEquals((await a.read()).length, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("bounds and symlink records fail closed", async () => {
  const directory = await makeTempDir();
  const outside = await Deno.makeTempFile();
  try {
    const home = await DurableRunHome.open({ directory, identity });
    await assertRejects(() => home.append({ sequence: 1, value: "x".repeat(1024 * 1024 + 1) }));
    await assertRejects(() => home.append({ sequence: 4097, value: null }));
    await Deno.symlink(outside, `${directory}/0000000001.json`);
    await assertRejects(() => home.read());
  } finally {
    await Deno.remove(directory, { recursive: true });
    await Deno.remove(outside);
  }
});

for (const boundary of ["pending", "committed"]) {
  it(`real process crash at ${boundary} boundary survives fresh process reopening`, async () => {
    const directory = await makeTempDir();
    try {
      const process = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-read",
          "--allow-write",
          "--allow-env",
          "--allow-sys",
          "--deny-net",
          new URL("./durable-run-home-subprocess.ts", import.meta.url).pathname,
          directory,
          boundary,
        ],
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const reader = process.stdout.getReader();
      const ready = await reader.read();
      assertEquals(new TextDecoder().decode(ready.value), "READY\n");
      process.kill("SIGKILL");
      await reader.cancel();
      reader.releaseLock();
      await new Response(process.stderr).text();
      const status = await process.status;
      assertEquals(status.success, false);
      const reopened = await DurableRunHome.open({ directory, identity });
      assertEquals(
        await reopened.read(),
        boundary === "committed"
          ? [{ sequence: 1, value: { kind: "effect-result", receipt: "synthetic-1" } }]
          : [],
      );
      await reopened.append({ sequence: boundary === "committed" ? 2 : 1, value: "after-restart" });
      assertEquals((await reopened.read()).length, boundary === "committed" ? 2 : 1);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
}

it("real concurrent processes exclusively publish one conflicting sequence", async () => {
  const directory = await makeTempDir();
  try {
    const outputs = await Promise.all(
      ["writer-A", "writer-B"].map((boundary) =>
        new Deno.Command(Deno.execPath(), {
          args: [
            "run",
            "--allow-read",
            "--allow-write",
            "--allow-env",
            "--allow-sys",
            "--deny-net",
            new URL("./durable-run-home-subprocess.ts", import.meta.url).pathname,
            directory,
            boundary,
          ],
          stdout: "piped",
          stderr: "piped",
        }).output()
      ),
    );
    assertEquals(outputs.filter((output) => output.success).length, 1);
    const reopened = await DurableRunHome.open({ directory, identity });
    assertEquals((await reopened.read()).length, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("transplanted valid record and committed gaps are rejected", async () => {
  const directory = await makeTempDir();
  const foreignDirectory = await makeTempDir();
  try {
    const home = await DurableRunHome.open({ directory, identity });
    const foreign = await DurableRunHome.open({
      directory: foreignDirectory,
      identity: { ...identity, publicRunId: "foreign-run" },
    });
    await foreign.append({ sequence: 1, value: "foreign" });
    await Deno.copyFile(`${foreignDirectory}/0000000001.json`, `${directory}/0000000001.json`);
    await assertRejects(() => home.read());
    await Deno.rename(`${directory}/0000000001.json`, `${directory}/0000000002.json`);
    await assertRejects(() => home.read());
  } finally {
    await Deno.remove(directory, { recursive: true });
    await Deno.remove(foreignDirectory, { recursive: true });
  }
});

it("real concurrent identical retries both acknowledge durable immutable bytes", async () => {
  const directory = await makeTempDir();
  try {
    const outputs = await Promise.all([1, 2].map(() =>
      new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-read",
          "--allow-write",
          "--allow-env",
          "--allow-sys",
          "--deny-net",
          new URL("./durable-run-home-subprocess.ts", import.meta.url).pathname,
          directory,
          "writer-same",
        ],
        stdout: "piped",
        stderr: "piped",
      }).output()
    ));
    assertEquals(outputs.map((output) => output.success), [true, true]);
    const reopened = await DurableRunHome.open({ directory, identity });
    assertEquals(await reopened.read(), [{ sequence: 1, value: "writer-same" }]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("abandoned pending publications do not exhaust committed recovery bounds", async () => {
  const directory = await makeTempDir();
  try {
    const home = await DurableRunHome.open({ directory, identity });
    for (let index = 0; index < 4160; index++) {
      await Deno.writeTextFile(`${directory}/.pending-${index}`, "");
    }
    await home.append({ sequence: 1, value: "committed" });
    const reopened = await DurableRunHome.open({ directory, identity });
    assertEquals(await reopened.read(), [{ sequence: 1, value: "committed" }]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("special record files reject without waiting for a writer", async () => {
  const directory = await makeTempDir();
  try {
    const home = await DurableRunHome.open({ directory, identity });
    const result = await new Deno.Command("mkfifo", {
      args: [`${directory}/0000000001.json`],
    }).output();
    assertEquals(result.success, true);
    await assertRejects(() => home.read());
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("durable publication ignores poisoned JSON and array hooks and never exposes private records", async () => {
  const directory = await makeTempDir();
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const reduce = Array.prototype.reduce;
  const filter = Array.prototype.filter;
  const some = Array.prototype.some;
  const entries = Array.prototype.entries;
  const push = Array.prototype.push;
  let exposed = false;
  try {
    const home = await DurableRunHome.open({ directory, identity });
    JSON.stringify = () => {
      exposed = true;
      return '"forged"';
    };
    JSON.parse = () => {
      exposed = true;
      return {};
    };
    Array.prototype.reduce = function (...args) {
      exposed = true;
      return Reflect.apply(reduce, this, args);
    };
    Array.prototype.filter = function (...args) {
      exposed = true;
      return Reflect.apply(filter, this, args);
    };
    Array.prototype.some = function (...args) {
      exposed = true;
      return Reflect.apply(some, this, args);
    };
    Array.prototype.entries = function () {
      exposed = true;
      return Reflect.apply(entries, this, []);
    };
    Array.prototype.push = function (...args) {
      exposed = true;
      return Reflect.apply(push, this, args);
    };
    await home.append({ sequence: 1, value: { privateJournal: "synthetic" } });
    const records = await home.read();
    JSON.stringify = stringify;
    JSON.parse = parse;
    Array.prototype.reduce = reduce;
    Array.prototype.filter = filter;
    Array.prototype.some = some;
    Array.prototype.entries = entries;
    Array.prototype.push = push;
    assertEquals(records[0]?.value, { privateJournal: "synthetic" });
    assertEquals(exposed, false);
  } finally {
    JSON.stringify = stringify;
    JSON.parse = parse;
    Array.prototype.reduce = reduce;
    Array.prototype.filter = filter;
    Array.prototype.some = some;
    Array.prototype.entries = entries;
    Array.prototype.push = push;
    await Deno.remove(directory, { recursive: true });
  }
});

it("poisoned reduce cannot bypass the actual 64 MiB durable home limit", async () => {
  const { createHash } = await import("node:crypto");
  const directory = await makeTempDir();
  const originalReduce = Array.prototype.reduce;
  try {
    const home = await DurableRunHome.open({ directory, identity });
    const value = "x".repeat(1_000_000);
    // Seed complete immutable disk records without quadratic test setup appends.
    for (let sequence = 1; sequence <= 67; sequence++) {
      const body = JSON.stringify({ version: 1, identity, sequence, value });
      const text = JSON.stringify({
        body,
        checksum: createHash("sha256").update(body).digest("hex"),
      });
      await Deno.writeTextFile(`${directory}/${String(sequence).padStart(10, "0")}.json`, text);
    }
    Array.prototype.reduce = () => 0;
    await assertRejects(() => home.append({ sequence: 68, value }));
    Array.prototype.reduce = originalReduce;
    assertEquals((await home.read()).length, 67);
    assertEquals(
      await Deno.stat(`${directory}/0000000068.json`).then(() => true, () => false),
      false,
    );
  } finally {
    Array.prototype.reduce = originalReduce;
    await Deno.remove(directory, { recursive: true });
  }
});
