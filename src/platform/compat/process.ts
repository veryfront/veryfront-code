import { isDeno as IS_DENO } from "./runtime.ts";

const nodeProcess = (globalThis as { process?: typeof import("node:process") }).process;
const hasNodeProcess = !!nodeProcess?.versions?.node;

export function getArgs(): string[] {
  if (IS_DENO) {
    return Deno.args;
  }
  if (hasNodeProcess) {
    return nodeProcess!.argv.slice(2);
  }
  return [];
}

export function exit(code?: number): never {
  if (IS_DENO) {
    Deno.exit(code);
  }
  if (hasNodeProcess) {
    nodeProcess!.exit(code);
  }
  throw new Error("exit() is not supported in this runtime");
}

export function cwd(): string {
  if (IS_DENO) {
    return Deno.cwd();
  }
  if (hasNodeProcess) {
    return nodeProcess!.cwd();
  }
  throw new Error("cwd() is not supported in this runtime");
}

export function chdir(directory: string): void {
  if (IS_DENO) {
    Deno.chdir(directory);
  } else {
    if (hasNodeProcess) {
      nodeProcess!.chdir(directory);
      return;
    }
    throw new Error("chdir() is not supported in this runtime");
  }
}

export function env(): Record<string, string> {
  if (IS_DENO) {
    return Deno.env.toObject();
  }
  if (hasNodeProcess) {
    return nodeProcess!.env as Record<string, string>;
  }
  return {};
}

export function getEnv(key: string): string | undefined {
  if (IS_DENO) {
    return Deno.env.get(key);
  }
  if (hasNodeProcess) {
    return nodeProcess!.env[key];
  }
  return undefined;
}

/**
 * Get an environment variable or throw if not set
 * @throws Error if the environment variable is not set
 */
export function requireEnv(key: string): string {
  const value = getEnv(key);
  if (value === undefined) {
    throw new Error(`Required environment variable "${key}" is not set`);
  }
  return value;
}

export function setEnv(key: string, value: string): void {
  if (IS_DENO) {
    Deno.env.set(key, value);
  } else {
    if (hasNodeProcess) {
      nodeProcess!.env[key] = value;
      return;
    }
    throw new Error("setEnv() is not supported in this runtime");
  }
}

export function deleteEnv(key: string): void {
  if (IS_DENO) {
    Deno.env.delete(key);
  } else {
    if (hasNodeProcess) {
      delete nodeProcess!.env[key];
      return;
    }
    throw new Error("deleteEnv() is not supported in this runtime");
  }
}

export function pid(): number {
  if (IS_DENO) {
    return Deno.pid;
  }
  if (hasNodeProcess) {
    return nodeProcess!.pid;
  }
  return 0;
}

export function ppid(): number {
  if (IS_DENO && "ppid" in Deno) {
    return Deno.ppid || 0;
  }
  if (hasNodeProcess) {
    return nodeProcess!.ppid || 0;
  }
  return 0;
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

  if (!hasNodeProcess) {
    throw new Error("memoryUsage() is not supported in this runtime");
  }

  const usage = nodeProcess!.memoryUsage();
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
  if (hasNodeProcess) {
    return nodeProcess!.stdin.isTTY ?? false;
  }
  return false;
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

  if (!hasNodeProcess) {
    throw new Error("networkInterfaces() is not supported in this runtime");
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
  if (hasNodeProcess) {
    return `Node.js ${nodeProcess!.version}`;
  }
  return "unknown";
}

/**
 * Register a signal handler (SIGINT, SIGTERM) for graceful shutdown
 */
export function onSignal(signal: "SIGINT" | "SIGTERM", handler: () => void): void {
  if (IS_DENO) {
    Deno.addSignalListener(signal, handler);
  } else if (hasNodeProcess) {
    nodeProcess!.on(signal, handler);
  }
}

/**
 * Unreference a timer to prevent it from keeping the process alive
 */
export function unrefTimer(timerId: ReturnType<typeof setInterval>): void {
  if (IS_DENO) {
    Deno.unrefTimer(timerId as number);
  } else if (timerId && typeof timerId === "object" && "unref" in timerId) {
    (timerId as { unref: () => void }).unref();
  }
}

/**
 * Get the executable path of the current runtime
 */
export function execPath(): string {
  if (IS_DENO) {
    return Deno.execPath();
  }
  if (hasNodeProcess) {
    return nodeProcess!.execPath;
  }
  return "";
}

/**
 * Get stdout stream for writing
 * Returns null if not available (e.g., in browser/workers)
 */
export function getStdout(): { write: (data: string) => void } | null {
  if (IS_DENO) {
    const encoder = new TextEncoder();
    return {
      write: (data: string) => {
        Deno.stdout.writeSync(encoder.encode(data));
      },
    };
  }
  if (hasNodeProcess && nodeProcess!.stdout) {
    return {
      write: (data: string) => {
        nodeProcess!.stdout.write(data);
      },
    };
  }
  return null;
}
