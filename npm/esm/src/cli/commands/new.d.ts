import { z } from "zod";
import { type RuntimeEnv } from "../../config/runtime-env.js";
export declare const NewArgsSchema: z.ZodObject<{
    template: z.ZodOptional<z.ZodEnum<["ai", "app", "blog", "docs", "minimal"]>>;
    integrations: z.ZodOptional<z.ZodString>;
    port: z.ZodDefault<z.ZodNumber>;
    skipDeploy: z.ZodDefault<z.ZodBoolean>;
    open: z.ZodDefault<z.ZodBoolean>;
    force: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    open: boolean;
    port: number;
    force: boolean;
    skipDeploy: boolean;
    template?: "app" | "docs" | "ai" | "blog" | "minimal" | undefined;
    integrations?: string | undefined;
}, {
    open?: boolean | undefined;
    port?: number | undefined;
    force?: boolean | undefined;
    template?: "app" | "docs" | "ai" | "blog" | "minimal" | undefined;
    integrations?: string | undefined;
    skipDeploy?: boolean | undefined;
}>;
export type NewOptions = z.infer<typeof NewArgsSchema> & {
    integrationsList?: string[];
};
export declare const parseNewArgs: (args: import("../index.js").ParsedArgs) => z.SafeParseReturnType<unknown, {
    open: boolean;
    port: number;
    force: boolean;
    skipDeploy: boolean;
    template?: "app" | "docs" | "ai" | "blog" | "minimal" | undefined;
    integrations?: string | undefined;
}>;
export declare function newCommand(name: string, options?: Partial<NewOptions>, env?: RuntimeEnv): Promise<void>;
//# sourceMappingURL=new.d.ts.map