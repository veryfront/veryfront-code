// PTY Passthrough Module
// Spawns coding agents as child processes with full PTY support
import * as dntShim from "../../../../_dnt.shims.js";
import { z } from "zod";
// ============================================================================
// Schemas
// ============================================================================
export const PtyOptionsSchema = z.object({
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
    inheritEnv: z.boolean().default(true),
});
export const PtyStateSchema = z.enum(["idle", "running", "exited", "error"]);
export const PtySessionSchema = z.object({
    id: z.string(),
    agent: z.custom(),
    state: PtyStateSchema,
    exitCode: z.number().nullable(),
    error: z.string().nullable(),
    startedAt: z.number().nullable(),
});
// ============================================================================
// Session Management
// ============================================================================
export function createPtySession(agent) {
    return {
        id: dntShim.crypto.randomUUID(),
        agent,
        state: "idle",
        exitCode: null,
        error: null,
        startedAt: null,
    };
}
export function updatePtySession(session, update) {
    return { ...session, ...update };
}
export function parseCommand(command) {
    const args = [];
    let current = "";
    let inQuote = null;
    for (const char of command) {
        if (inQuote) {
            if (char === inQuote) {
                inQuote = null;
            }
            else {
                current += char;
            }
        }
        else if (char === '"' || char === "'") {
            inQuote = char;
        }
        else if (char === " ") {
            if (current) {
                args.push(current);
                current = "";
            }
        }
        else {
            current += char;
        }
    }
    if (current) {
        args.push(current);
    }
    return args;
}
export function spawnAgent(agent, options = {}) {
    const session = createPtySession(agent);
    const opts = PtyOptionsSchema.parse(options);
    // Parse command
    const args = parseCommand(agent.command);
    const cmd = args[0];
    if (!cmd) {
        return {
            success: false,
            session: updatePtySession(session, {
                state: "error",
                error: "Invalid command: empty",
            }),
            error: "Invalid command: empty",
        };
    }
    try {
        // Build environment
        const env = {};
        if (opts.inheritEnv) {
            // Copy current environment
            for (const [key, value] of Object.entries(dntShim.Deno.env.toObject())) {
                env[key] = value;
            }
        }
        // Add custom env vars
        if (opts.env) {
            for (const [key, value] of Object.entries(opts.env)) {
                env[key] = value;
            }
        }
        // Spawn the process
        const command = new dntShim.Deno.Command(cmd, {
            args: args.slice(1),
            cwd: opts.cwd,
            env,
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
        });
        const process = command.spawn();
        return {
            success: true,
            session: updatePtySession(session, {
                state: "running",
                startedAt: Date.now(),
            }),
            process,
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            success: false,
            session: updatePtySession(session, {
                state: "error",
                error: message,
            }),
            error: message,
        };
    }
}
export async function waitForExit(process, session) {
    try {
        const status = await process.status;
        return updatePtySession(session, {
            state: "exited",
            exitCode: status.code,
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return updatePtySession(session, {
            state: "error",
            error: message,
        });
    }
}
// ============================================================================
// Agent Detection
// ============================================================================
export async function isCommandAvailable(command) {
    const args = parseCommand(command);
    const cmd = args[0];
    if (!cmd)
        return false;
    try {
        const process = new dntShim.Deno.Command("which", {
            args: [cmd],
            stdout: "null",
            stderr: "null",
        });
        const status = await process.output();
        return status.success;
    }
    catch {
        return false;
    }
}
export async function detectInstalledAgents(agents) {
    const installed = new Set();
    const checks = await Promise.all(agents.map(async (agent) => ({
        id: agent.id,
        available: await isCommandAvailable(agent.command),
    })));
    for (const { id, available } of checks) {
        if (available) {
            installed.add(id);
        }
    }
    return installed;
}
