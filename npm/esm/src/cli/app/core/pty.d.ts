import * as dntShim from "../../../../_dnt.shims.js";
import { z } from "zod";
import type { CodingAgentDef } from "./types.js";
export declare const PtyOptionsSchema: z.ZodObject<{
    cwd: z.ZodOptional<z.ZodString>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    inheritEnv: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    inheritEnv: boolean;
    cwd?: string | undefined;
    env?: Record<string, string> | undefined;
}, {
    cwd?: string | undefined;
    env?: Record<string, string> | undefined;
    inheritEnv?: boolean | undefined;
}>;
export type PtyOptions = z.infer<typeof PtyOptionsSchema>;
export declare const PtyStateSchema: z.ZodEnum<["idle", "running", "exited", "error"]>;
export type PtyState = z.infer<typeof PtyStateSchema>;
export declare const PtySessionSchema: z.ZodObject<{
    id: z.ZodString;
    agent: z.ZodType<{
        type: "cli" | "ide";
        provider: string;
        name: string;
        id: string;
        command: string;
        models?: string[] | undefined;
        defaultModel?: string | undefined;
    }, z.ZodTypeDef, {
        type: "cli" | "ide";
        provider: string;
        name: string;
        id: string;
        command: string;
        models?: string[] | undefined;
        defaultModel?: string | undefined;
    }>;
    state: z.ZodEnum<["idle", "running", "exited", "error"]>;
    exitCode: z.ZodNullable<z.ZodNumber>;
    error: z.ZodNullable<z.ZodString>;
    startedAt: z.ZodNullable<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    agent: {
        type: "cli" | "ide";
        provider: string;
        name: string;
        id: string;
        command: string;
        models?: string[] | undefined;
        defaultModel?: string | undefined;
    };
    error: string | null;
    id: string;
    startedAt: number | null;
    state: "error" | "running" | "idle" | "exited";
    exitCode: number | null;
}, {
    agent: {
        type: "cli" | "ide";
        provider: string;
        name: string;
        id: string;
        command: string;
        models?: string[] | undefined;
        defaultModel?: string | undefined;
    };
    error: string | null;
    id: string;
    startedAt: number | null;
    state: "error" | "running" | "idle" | "exited";
    exitCode: number | null;
}>;
export type PtySession = z.infer<typeof PtySessionSchema>;
export declare function createPtySession(agent: CodingAgentDef): PtySession;
export declare function updatePtySession(session: PtySession, update: Partial<Pick<PtySession, "state" | "exitCode" | "error" | "startedAt">>): PtySession;
export interface SpawnResult {
    success: boolean;
    session: PtySession;
    process?: dntShim.Deno.ChildProcess;
    error?: string;
}
export declare function parseCommand(command: string): string[];
export declare function spawnAgent(agent: CodingAgentDef, options?: Partial<PtyOptions>): SpawnResult;
export declare function waitForExit(process: dntShim.Deno.ChildProcess, session: PtySession): Promise<PtySession>;
export declare function isCommandAvailable(command: string): Promise<boolean>;
export declare function detectInstalledAgents(agents: CodingAgentDef[]): Promise<Set<string>>;
//# sourceMappingURL=pty.d.ts.map