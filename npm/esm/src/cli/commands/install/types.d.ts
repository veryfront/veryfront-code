import { z } from "zod";
export declare const AIToolIdSchema: z.ZodEnum<["cursor", "claude-code", "skill", "copilot", "windsurf", "agents"]>;
export type AIToolId = z.infer<typeof AIToolIdSchema>;
export declare const AIToolSchema: z.ZodObject<{
    id: z.ZodEnum<["cursor", "claude-code", "skill", "copilot", "windsurf", "agents"]>;
    label: z.ZodString;
    file: z.ZodString;
    description: z.ZodString;
    template: z.ZodString;
}, "strip", z.ZodTypeAny, {
    file: string;
    description: string;
    id: "cursor" | "claude-code" | "skill" | "copilot" | "windsurf" | "agents";
    label: string;
    template: string;
}, {
    file: string;
    description: string;
    id: "cursor" | "claude-code" | "skill" | "copilot" | "windsurf" | "agents";
    label: string;
    template: string;
}>;
export type AITool = z.infer<typeof AIToolSchema>;
export declare const InstallOptionsSchema: z.ZodObject<{
    target: z.ZodOptional<z.ZodString>;
    global: z.ZodOptional<z.ZodBoolean>;
    force: z.ZodOptional<z.ZodBoolean>;
    cwd: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    global?: boolean | undefined;
    cwd?: string | undefined;
    force?: boolean | undefined;
    target?: string | undefined;
}, {
    global?: boolean | undefined;
    cwd?: string | undefined;
    force?: boolean | undefined;
    target?: string | undefined;
}>;
export type InstallOptions = z.infer<typeof InstallOptionsSchema>;
export declare const UninstallOptionsSchema: z.ZodObject<{
    target: z.ZodOptional<z.ZodString>;
    global: z.ZodOptional<z.ZodBoolean>;
    force: z.ZodOptional<z.ZodBoolean>;
    cwd: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    global?: boolean | undefined;
    cwd?: string | undefined;
    force?: boolean | undefined;
    target?: string | undefined;
}, {
    global?: boolean | undefined;
    cwd?: string | undefined;
    force?: boolean | undefined;
    target?: string | undefined;
}>;
export type UninstallOptions = z.infer<typeof UninstallOptionsSchema>;
export declare const DetectOptionsSchema: z.ZodObject<{
    cwd: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    cwd?: string | undefined;
}, {
    cwd?: string | undefined;
}>;
export type DetectOptions = z.infer<typeof DetectOptionsSchema>;
export interface MultiSelectOption {
    label: string;
    value: string;
    description: string;
    selected: boolean;
}
//# sourceMappingURL=types.d.ts.map