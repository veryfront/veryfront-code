import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fileURLToPath } from "node:url";
import { PROVIDER_EGRESS_DENY_NET } from "../../../scripts/test/suites.ts";
import type { DependencySnapshotRecord } from "#veryfront/platform/adapters/dependency-snapshot-store.ts";

describe("dependency snapshot history across renderer processes", () => {
  it("hydrates the original module on a cold replica after dependency writeback", async () => {
    let content = '{"dependencies":{}}', version = 1000, writebacks = 0;
    const history = new Map<string, DependencySnapshotRecord>();
    const shared = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (req) => {
      const path = new URL(req.url).pathname;
      if (path.startsWith("/history/")) {
        if (req.method === "PUT") {
          const record = await req.json();
          const old = history.get(path);
          if (old && old.value !== record.value) return new Response(null, { status: 409 });
          history.set(path, record);
          return new Response(null, { status: 200 });
        }
        const record = history.get(path);
        return record ? Response.json(record) : new Response(null, { status: 404 });
      }
      if (path !== "/metadata") return new Response(null, { status: 404 });
      if (req.method === "POST") {
        const values = await req.json();
        if (JSON.stringify(values) !== '["react"]') return new Response(null, { status: 400 });
        content = '{"dependencies":{"react":"19.2.4"}}';
        version++;
        writebacks++;
      }
      return Response.json({ content, version });
    });
    const children: Deno.ChildProcess[] = [];
    const streams: Promise<unknown>[] = [];
    async function startReplica() {
      const child = new Deno.Command(Deno.execPath(), {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        args: [
          "run",
          "--allow-all",
          PROVIDER_EGRESS_DENY_NET,
          "--config",
          fileURLToPath(new URL("../../../deno.json", import.meta.url)),
          fileURLToPath(new URL("./fixtures/dependency-snapshot-replica.ts", import.meta.url)),
          `http://127.0.0.1:${shared.addr.port}`,
        ],
        clearEnv: true,
        env: {
          PATH: Deno.env.get("PATH") ?? "",
          VERYFRONT_DEPENDENCY_PINNING: "1",
          VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT: "100",
          VF_DISABLE_LRU_INTERVAL: "1",
          SENTRY_ENABLED: "false",
          LOG_LEVEL: "error",
          ...(Deno.env.get("DENO_DIR") ? { DENO_DIR: Deno.env.get("DENO_DIR")! } : {}),
        },
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      children.push(child);
      streams.push(child.stderr.pipeTo(new WritableStream({ write() {} })));
      const reader = child.stdout.getReader();
      const deadline = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch { /* Exited. */ }
      }, 30000);
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) throw new Error("Replica exited before ready");
          buffer += new TextDecoder().decode(value);
          if (buffer.length > 65536) throw new Error("Replica readiness output exceeded its limit");
          for (const line of buffer.split("\n").slice(0, -1)) {
            let ready;
            try {
              ready = JSON.parse(line);
            } catch {
              continue;
            }
            if (Number.isInteger(ready.port)) {
              return { origin: `http://127.0.0.1:${ready.port}`, pid: child.pid };
            }
          }
        }
      } finally {
        clearTimeout(deadline);
        reader.releaseLock();
        streams.push(child.stdout.pipeTo(new WritableStream({ write() {} })));
      }
    }
    async function request(origin: string, path: string) {
      const response = await fetch(origin + path, { signal: AbortSignal.timeout(30000) });
      return { status: response.status, body: await response.text() };
    }
    try {
      const warm = await startReplica();
      const document = await request(warm.origin, "/document");
      assertEquals(document.status, 200);
      const key = JSON.parse(document.body).key;
      assertEquals(key, "on:54uvgwr2ih7p");
      assertEquals(history.size, 1, "document capture must acknowledge publication first");
      assertEquals(
        (await request(warm.origin, `/module?key=${encodeURIComponent(key)}`)).status,
        200,
      );
      assertEquals((await request(warm.origin, "/writeback")).status, 200);
      assertEquals(writebacks, 1);
      const cold = await startReplica();
      assertEquals(cold.pid === warm.pid, false);
      for (const replica of [warm, cold]) {
        const module = await request(replica.origin, `/module?key=${encodeURIComponent(key)}`);
        assertEquals(module.status, 200);
        assertStringIncludes(module.body, "useServerRenderContext");
      }
      const current = await request(cold.origin, "/document");
      assertEquals(current.status, 200);
      assertEquals(JSON.parse(current.body).key === key, false);
    } finally {
      for (const child of children) {
        try {
          child.kill("SIGTERM");
        } catch { /* Already exited. */ }
      }
      await Promise.all(children.map((child) => child.status));
      await Promise.all(streams);
      await shared.shutdown();
    }
  });
});
