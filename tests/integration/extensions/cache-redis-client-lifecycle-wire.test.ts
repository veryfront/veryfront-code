import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import type { TokenCacheEntry } from "veryfront/extensions/cache";
import { RedisTokenCacheStore } from "../../../extensions/ext-cache-redis/src/redis-cache.ts";

// Exercise the real redis@5.11.0 client, including its ErrorReply and socket
// disposal, against a local RESP fixture. No external Redis or credentials.
it("Redis replica refusal reconnects the real client to the same writer URL", async () => {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const sockets = new Set<Deno.Conn>();
  const handlers: Promise<void>[] = [];
  const writes: string[][] = [];
  let accepted = 0;
  const serving = (async () => {
    try {
      for await (const socket of listener) {
        sockets.add(socket);
        const ordinal = ++accepted;
        handlers.push((async () => {
          const decoder = new TextDecoder();
          const encoder = new TextEncoder();
          let pending = "";
          const buffer = new Uint8Array(16_384);
          try {
            for (;;) {
              const read = await socket.read(buffer);
              if (read === null) return;
              pending += decoder.decode(buffer.subarray(0, read), { stream: true });
              for (;;) {
                const lines = pending.split("\r\n");
                const count = Number(lines[0]?.slice(1));
                if (!count || lines.length < count * 2 + 2) break;
                const args = lines.slice(2, count * 2 + 1).filter((_, index) => index % 2 === 0);
                pending = lines.slice(count * 2 + 1).join("\r\n");
                let response = "+OK\r\n";
                if (args[0]?.toUpperCase() === "SETEX") {
                  writes.push(args);
                  if (ordinal === 1) {
                    response = "-READONLY You can't write against a read only replica.\r\n";
                  }
                }
                const bytes = encoder.encode(response);
                let sent = 0;
                while (sent < bytes.length) sent += await socket.write(bytes.subarray(sent));
              }
            }
          } catch (error) {
            if (
              !(error instanceof Deno.errors.BadResource ||
                error instanceof Deno.errors.Interrupted)
            ) throw error;
          } finally {
            sockets.delete(socket);
            try {
              socket.close();
            } catch { /* Already closed by teardown. */ }
          }
        })());
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.BadResource)) throw error;
    }
  })();
  const store = new RedisTokenCacheStore({ url: `redis://127.0.0.1:${listener.addr.port}` });
  try {
    const value: TokenCacheEntry = {
      token: "local-fixture",
      scope: "preview",
      projectSlug: "fixture",
      expiresAt: Date.now() + 60_000,
    };
    await store.set("key", value);
    assertEquals(accepted, 2);
    assertEquals(writes.length, 2);
    assertEquals(writes.map((args) => args[1]), ["vf:token:key", "vf:token:key"]);
    assertEquals(writes.map((args) => args[3]), [JSON.stringify(value), JSON.stringify(value)]);
  } finally {
    await store.close();
    listener.close();
    for (const socket of sockets) socket.close();
    await serving;
    await Promise.all(handlers);
  }
});
