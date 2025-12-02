// Helper for Cross-Platform CWD
function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== 'undefined') {
    // @ts-ignore - Deno global
    return Deno.env.get(key);
  }
  // @ts-ignore - process global
  else if (typeof process !== 'undefined' && process.env) {
    // @ts-ignore - process global
    return process.env[key];
  }
  return undefined;
}

import { createClient, type RedisClientType } from 'redis';

let client: RedisClientType | null = null;

export async function getRedis(): Promise<RedisClientType> {
  if (!client) {
    const hostname = getEnv("REDIS_HOST") ?? "127.0.0.1";
    const port = Number(getEnv("REDIS_PORT") ?? "6379");
    try {
      client = createClient({
        socket: {
          host: hostname,
          port: port,
        },
      });
      await client.connect();
      console.log(`[Redis] Connected to ${hostname}:${port}`);
    } catch (e) {
      console.error(`[Redis] Failed to connect to ${hostname}:${port}. Is Docker running?`);
      throw e;
    }
  }
  return client;
}
