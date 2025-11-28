import process from "node:process";

const IS_DENO = typeof Deno !== "undefined" && "Deno" in globalThis;

export function getArgs(): string[] {
  if (IS_DENO) {
    return Deno.args;
  }
  return process.argv.slice(2);
}

export function exit(code?: number): never {
  if (IS_DENO) {
    Deno.exit(code);
  }
  process.exit(code);
}

export function cwd(): string {
  if (IS_DENO) {
    return Deno.cwd();
  }
  return process.cwd();
}

export function chdir(directory: string): void {
  if (IS_DENO) {
    Deno.chdir(directory);
  } else {
    process.chdir(directory);
  }
}

export function env(): Record<string, string> {
  if (IS_DENO) {
    return Deno.env.toObject();
  }
  return process.env as Record<string, string>;
}

export function getEnv(key: string): string | undefined {
  if (IS_DENO) {
    return Deno.env.get(key);
  }
  return process.env[key];
}

export function setEnv(key: string, value: string): void {
  if (IS_DENO) {
    Deno.env.set(key, value);
  } else {
    process.env[key] = value;
  }
}

export function deleteEnv(key: string): void {
  if (IS_DENO) {
    Deno.env.delete(key);
  } else {
    delete process.env[key];
  }
}

export function pid(): number {
  if (IS_DENO) {
    return Deno.pid;
  }
  return process.pid;
}

export function ppid(): number {
  if (IS_DENO && "ppid" in Deno) {
    return Deno.ppid || 0;
  }
  return process.ppid || 0;
}

export function memoryUsage(): {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
} {
  if (IS_DENO) {
    const usage = Deno.memoryUsage();
    return {
      rss: usage.rss,
      heapTotal: usage.heapTotal,
      heapUsed: usage.heapUsed,
      external: usage.external,
    };
  }

  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external || 0,
  };
}

/**
 * Check if stdin is a TTY (terminal)
 */
export function isInteractive(): boolean {
  if (IS_DENO) {
    return Deno.stdin.isTerminal();
  }
  return process.stdin.isTTY ?? false;
}

/**
 * Get network interfaces
 */
export async function getNetworkInterfaces(): Promise<
  Array<{ name: string; address: string; family: "IPv4" | "IPv6" }>
> {
  if (IS_DENO) {
    const interfaces = Deno.networkInterfaces();
    return interfaces.map((iface) => ({
      name: iface.name,
      address: iface.address,
      family: iface.family as "IPv4" | "IPv6",
    }));
  }

  const os = await import("node:os");
  const interfaces = os.networkInterfaces();
  const result: Array<{ name: string; address: string; family: "IPv4" | "IPv6" }> = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      result.push({
        name,
        address: addr.address,
        family: addr.family as "IPv4" | "IPv6",
      });
    }
  }

  return result;
}

/**
 * Get runtime version string
 */
export function getRuntimeVersion(): string {
  if (IS_DENO) {
    return `Deno ${Deno.version.deno}`;
  }
  if ("Bun" in globalThis) {
    return `Bun ${(globalThis as unknown as { Bun: { version: string } }).Bun.version}`;
  }
  return `Node.js ${process.version}`;
}
