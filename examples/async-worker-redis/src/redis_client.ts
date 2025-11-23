import { connect, type Redis } from "redis";

let client: Redis | null = null;

export async function getRedis(): Promise<Redis> {
  if (!client) {
    const hostname = Deno.env.get("REDIS_HOST") ?? "127.0.0.1";
    const port = Number(Deno.env.get("REDIS_PORT") ?? "6379");
    try {
      client = await connect({ hostname, port });
      console.log(`[Redis] Connected to ${hostname}:${port}`);
    } catch (e) {
      console.error(`[Redis] Failed to connect to ${hostname}:${port}. Is Docker running?`);
      throw e;
    }
  }
  return client;
}
