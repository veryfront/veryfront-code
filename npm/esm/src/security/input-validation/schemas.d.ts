import { z } from "zod";
export declare const CommonSchemas: {
    email: z.ZodString;
    uuid: z.ZodString;
    slug: z.ZodString;
    url: z.ZodString;
    phoneNumber: z.ZodString;
    pagination: z.ZodObject<{
        page: z.ZodDefault<z.ZodNumber>;
        limit: z.ZodDefault<z.ZodNumber>;
        sort: z.ZodOptional<z.ZodString>;
        order: z.ZodOptional<z.ZodEnum<["asc", "desc"]>>;
    }, "strip", z.ZodTypeAny, {
        page: number;
        limit: number;
        sort?: string | undefined;
        order?: "asc" | "desc" | undefined;
    }, {
        page?: number | undefined;
        sort?: string | undefined;
        limit?: number | undefined;
        order?: "asc" | "desc" | undefined;
    }>;
    dateRange: z.ZodEffects<z.ZodObject<{
        from: z.ZodString;
        to: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        from: string;
        to: string;
    }, {
        from: string;
        to: string;
    }>, {
        from: string;
        to: string;
    }, {
        from: string;
        to: string;
    }>;
    strongPassword: z.ZodString;
};
//# sourceMappingURL=schemas.d.ts.map