import { z } from "zod";
import { type RuntimeEnv } from "../../config/runtime-env.js";
export declare const UpArgsSchema: z.ZodObject<{
    force: z.ZodDefault<z.ZodBoolean>;
    dryRun: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    force: boolean;
    dryRun: boolean;
}, {
    force?: boolean | undefined;
    dryRun?: boolean | undefined;
}>;
export type UpOptions = z.infer<typeof UpArgsSchema>;
export declare const parseUpArgs: (args: import("../index.js").ParsedArgs) => z.SafeParseReturnType<unknown, {
    force: boolean;
    dryRun: boolean;
}>;
export declare function upCommand(options?: Partial<UpOptions>, env?: RuntimeEnv): Promise<void>;
//# sourceMappingURL=up.d.ts.map