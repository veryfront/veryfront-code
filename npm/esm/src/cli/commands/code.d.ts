import { z } from "zod";
import type { ParsedArgs } from "../index/types.js";
export declare const CodeArgsSchema: z.ZodObject<{
    agent: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    list: z.ZodOptional<z.ZodBoolean>;
    set: z.ZodOptional<z.ZodBoolean>;
    projectDir: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    agent?: string | undefined;
    set?: boolean | undefined;
    model?: string | undefined;
    list?: boolean | undefined;
    projectDir?: string | undefined;
}, {
    agent?: string | undefined;
    set?: boolean | undefined;
    model?: string | undefined;
    list?: boolean | undefined;
    projectDir?: string | undefined;
}>;
export type CodeArgs = z.infer<typeof CodeArgsSchema>;
export declare function parseCodeArgs(args: ParsedArgs): z.SafeParseReturnType<CodeArgs, CodeArgs>;
export declare function codeCommand(args: CodeArgs): Promise<void>;
//# sourceMappingURL=code.d.ts.map