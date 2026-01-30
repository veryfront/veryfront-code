import { z } from "zod";
export declare const ProjectSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    slug: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    created_at: z.ZodOptional<z.ZodString>;
    updated_at: z.ZodOptional<z.ZodString>;
    provider: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    provider_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    layout: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    layout_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    config: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodRecord<z.ZodString, z.ZodUnknown>]>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    id: string;
    slug: string;
    config?: string | Record<string, unknown> | undefined;
    description?: string | undefined;
    layout?: string | null | undefined;
    provider?: string | null | undefined;
    created_at?: string | undefined;
    updated_at?: string | undefined;
    provider_id?: string | null | undefined;
    layout_id?: string | null | undefined;
}, {
    name: string;
    id: string;
    slug: string;
    config?: string | Record<string, unknown> | undefined;
    description?: string | undefined;
    layout?: string | null | undefined;
    provider?: string | null | undefined;
    created_at?: string | undefined;
    updated_at?: string | undefined;
    provider_id?: string | null | undefined;
    layout_id?: string | null | undefined;
}>;
export declare const ProjectFileSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    version_id: z.ZodOptional<z.ZodString>;
    path: z.ZodString;
    content: z.ZodOptional<z.ZodString>;
    size: z.ZodNumber;
    type: z.ZodEnum<["page", "function", "component", "file"]>;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "function" | "page" | "file" | "component";
    path: string;
    size: number;
    updated_at: string;
    content?: string | undefined;
    id?: string | undefined;
    version_id?: string | undefined;
}, {
    type: "function" | "page" | "file" | "component";
    path: string;
    size: number;
    updated_at: string;
    content?: string | undefined;
    id?: string | undefined;
    version_id?: string | undefined;
}>;
/**
 * PageInfo for paginated responses.
 * Follows Zalando RESTful API Guidelines #248 with cursor-based pagination.
 * @see https://opensource.zalando.com/restful-api-guidelines/#248
 */
export declare const PageInfoSchema: z.ZodObject<{
    self: z.ZodNullable<z.ZodString>;
    first: z.ZodLiteral<null>;
    next: z.ZodNullable<z.ZodString>;
    prev: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    self: string | null;
    first: null;
    next: string | null;
    prev: string | null;
}, {
    self: string | null;
    first: null;
    next: string | null;
    prev: string | null;
}>;
export declare const EnvironmentSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    id: string;
}, {
    name: string;
    id: string;
}>;
export declare const BranchFileListItemSchema: z.ZodObject<{
    path: z.ZodString;
    type: z.ZodEnum<["page", "function", "component", "file"]>;
    size: z.ZodNumber;
    updated_at: z.ZodString;
    _links: z.ZodOptional<z.ZodObject<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">>>;
    id: z.ZodOptional<z.ZodString>;
    version_id: z.ZodOptional<z.ZodString>;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "function" | "page" | "file" | "component";
    path: string;
    size: number;
    content: string;
    updated_at: string;
    id?: string | undefined;
    version_id?: string | undefined;
    _links?: z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    type: "function" | "page" | "file" | "component";
    path: string;
    size: number;
    content: string;
    updated_at: string;
    id?: string | undefined;
    version_id?: string | undefined;
    _links?: z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
export declare const ListBranchFilesResponseSchema: z.ZodObject<{
    data: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        type: z.ZodEnum<["page", "function", "component", "file"]>;
        size: z.ZodNumber;
        updated_at: z.ZodString;
        _links: z.ZodOptional<z.ZodObject<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough">>>;
        id: z.ZodOptional<z.ZodString>;
        version_id: z.ZodOptional<z.ZodString>;
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "function" | "page" | "file" | "component";
        path: string;
        size: number;
        content: string;
        updated_at: string;
        id?: string | undefined;
        version_id?: string | undefined;
        _links?: z.objectOutputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }, {
        type: "function" | "page" | "file" | "component";
        path: string;
        size: number;
        content: string;
        updated_at: string;
        id?: string | undefined;
        version_id?: string | undefined;
        _links?: z.objectInputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }>, "many">;
    page_info: z.ZodObject<{
        self: z.ZodNullable<z.ZodString>;
        first: z.ZodLiteral<null>;
        next: z.ZodNullable<z.ZodString>;
        prev: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        self: string | null;
        first: null;
        next: string | null;
        prev: string | null;
    }, {
        self: string | null;
        first: null;
        next: string | null;
        prev: string | null;
    }>;
    _links: z.ZodOptional<z.ZodObject<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, "strip", z.ZodTypeAny, {
    data: {
        type: "function" | "page" | "file" | "component";
        path: string;
        size: number;
        content: string;
        updated_at: string;
        id?: string | undefined;
        version_id?: string | undefined;
        _links?: z.objectOutputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }[];
    page_info: {
        self: string | null;
        first: null;
        next: string | null;
        prev: string | null;
    };
    _links?: z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    data: {
        type: "function" | "page" | "file" | "component";
        path: string;
        size: number;
        content: string;
        updated_at: string;
        id?: string | undefined;
        version_id?: string | undefined;
        _links?: z.objectInputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }[];
    page_info: {
        self: string | null;
        first: null;
        next: string | null;
        prev: string | null;
    };
    _links?: z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
export declare const BranchFileDetailSchema: z.ZodObject<{
    path: z.ZodString;
    type: z.ZodEnum<["page", "function", "component", "file"]>;
    size: z.ZodNumber;
    updated_at: z.ZodString;
    _links: z.ZodOptional<z.ZodObject<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">>>;
    id: z.ZodOptional<z.ZodString>;
    version_id: z.ZodOptional<z.ZodString>;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "function" | "page" | "file" | "component";
    path: string;
    size: number;
    content: string;
    updated_at: string;
    id?: string | undefined;
    version_id?: string | undefined;
    _links?: z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    type: "function" | "page" | "file" | "component";
    path: string;
    size: number;
    content: string;
    updated_at: string;
    id?: string | undefined;
    version_id?: string | undefined;
    _links?: z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
export declare const EnvironmentFileListItemSchema: z.ZodObject<{
    path: z.ZodString;
    type: z.ZodEnum<["page", "function", "component", "file"]>;
    size: z.ZodNumber;
    updated_at: z.ZodString;
    _links: z.ZodOptional<z.ZodObject<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">>>;
    content: z.ZodString;
    id: z.ZodString;
    version_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "function" | "page" | "file" | "component";
    path: string;
    size: number;
    content: string;
    id: string;
    updated_at: string;
    version_id: string;
    _links?: z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    type: "function" | "page" | "file" | "component";
    path: string;
    size: number;
    content: string;
    id: string;
    updated_at: string;
    version_id: string;
    _links?: z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
export declare const ListEnvironmentFilesResponseSchema: z.ZodObject<{
    _links: z.ZodOptional<z.ZodObject<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">>>;
    release_id: z.ZodString;
    release_version: z.ZodNullable<z.ZodString>;
    environment_id: z.ZodString;
    environment_name: z.ZodString;
    data: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        type: z.ZodEnum<["page", "function", "component", "file"]>;
        size: z.ZodNumber;
        updated_at: z.ZodString;
        _links: z.ZodOptional<z.ZodObject<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough">>>;
        content: z.ZodString;
        id: z.ZodString;
        version_id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "function" | "page" | "file" | "component";
        path: string;
        size: number;
        content: string;
        id: string;
        updated_at: string;
        version_id: string;
        _links?: z.objectOutputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }, {
        type: "function" | "page" | "file" | "component";
        path: string;
        size: number;
        content: string;
        id: string;
        updated_at: string;
        version_id: string;
        _links?: z.objectInputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }>, "many">;
    page_info: z.ZodObject<{
        self: z.ZodNullable<z.ZodString>;
        first: z.ZodLiteral<null>;
        next: z.ZodNullable<z.ZodString>;
        prev: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        self: string | null;
        first: null;
        next: string | null;
        prev: string | null;
    }, {
        self: string | null;
        first: null;
        next: string | null;
        prev: string | null;
    }>;
}, "strip", z.ZodTypeAny, {
    data: {
        type: "function" | "page" | "file" | "component";
        path: string;
        size: number;
        content: string;
        id: string;
        updated_at: string;
        version_id: string;
        _links?: z.objectOutputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }[];
    release_id: string;
    page_info: {
        self: string | null;
        first: null;
        next: string | null;
        prev: string | null;
    };
    release_version: string | null;
    environment_id: string;
    environment_name: string;
    _links?: z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    data: {
        type: "function" | "page" | "file" | "component";
        path: string;
        size: number;
        content: string;
        id: string;
        updated_at: string;
        version_id: string;
        _links?: z.objectInputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }[];
    release_id: string;
    page_info: {
        self: string | null;
        first: null;
        next: string | null;
        prev: string | null;
    };
    release_version: string | null;
    environment_id: string;
    environment_name: string;
    _links?: z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
export declare const EnvironmentFileDetailSchema: z.ZodObject<{
    release_id: z.ZodString;
    release_version: z.ZodNullable<z.ZodString>;
    environment_id: z.ZodString;
    environment_name: z.ZodString;
    path: z.ZodString;
    type: z.ZodEnum<["page", "function", "component", "file"]>;
    size: z.ZodNumber;
    updated_at: z.ZodString;
    _links: z.ZodOptional<z.ZodObject<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">>>;
    content: z.ZodString;
    id: z.ZodString;
    version_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "function" | "page" | "file" | "component";
    path: string;
    release_id: string;
    size: number;
    content: string;
    id: string;
    updated_at: string;
    version_id: string;
    release_version: string | null;
    environment_id: string;
    environment_name: string;
    _links?: z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    type: "function" | "page" | "file" | "component";
    path: string;
    release_id: string;
    size: number;
    content: string;
    id: string;
    updated_at: string;
    version_id: string;
    release_version: string | null;
    environment_id: string;
    environment_name: string;
    _links?: z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
export declare const ReleaseFileListItemSchema: z.ZodObject<{
    path: z.ZodString;
    type: z.ZodEnum<["page", "function", "component", "file"]>;
    size: z.ZodNumber;
    updated_at: z.ZodString;
    _links: z.ZodOptional<z.ZodObject<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">>>;
    content: z.ZodString;
    id: z.ZodString;
    version_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "function" | "page" | "file" | "component";
    path: string;
    size: number;
    content: string;
    id: string;
    updated_at: string;
    version_id: string;
    _links?: z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    type: "function" | "page" | "file" | "component";
    path: string;
    size: number;
    content: string;
    id: string;
    updated_at: string;
    version_id: string;
    _links?: z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
export declare const ListReleaseFilesResponseSchema: z.ZodObject<{
    _links: z.ZodOptional<z.ZodObject<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">>>;
    release_id: z.ZodString;
    release_version: z.ZodNullable<z.ZodString>;
    data: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        type: z.ZodEnum<["page", "function", "component", "file"]>;
        size: z.ZodNumber;
        updated_at: z.ZodString;
        _links: z.ZodOptional<z.ZodObject<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough">>>;
        content: z.ZodString;
        id: z.ZodString;
        version_id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "function" | "page" | "file" | "component";
        path: string;
        size: number;
        content: string;
        id: string;
        updated_at: string;
        version_id: string;
        _links?: z.objectOutputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }, {
        type: "function" | "page" | "file" | "component";
        path: string;
        size: number;
        content: string;
        id: string;
        updated_at: string;
        version_id: string;
        _links?: z.objectInputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }>, "many">;
    page_info: z.ZodObject<{
        self: z.ZodNullable<z.ZodString>;
        first: z.ZodLiteral<null>;
        next: z.ZodNullable<z.ZodString>;
        prev: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        self: string | null;
        first: null;
        next: string | null;
        prev: string | null;
    }, {
        self: string | null;
        first: null;
        next: string | null;
        prev: string | null;
    }>;
}, "strip", z.ZodTypeAny, {
    data: {
        type: "function" | "page" | "file" | "component";
        path: string;
        size: number;
        content: string;
        id: string;
        updated_at: string;
        version_id: string;
        _links?: z.objectOutputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }[];
    release_id: string;
    page_info: {
        self: string | null;
        first: null;
        next: string | null;
        prev: string | null;
    };
    release_version: string | null;
    _links?: z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    data: {
        type: "function" | "page" | "file" | "component";
        path: string;
        size: number;
        content: string;
        id: string;
        updated_at: string;
        version_id: string;
        _links?: z.objectInputType<{
            self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
            files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                href: z.ZodString;
                method: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                href: string;
                method?: string | undefined;
            }, {
                href: string;
                method?: string | undefined;
            }>]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }[];
    release_id: string;
    page_info: {
        self: string | null;
        first: null;
        next: string | null;
        prev: string | null;
    };
    release_version: string | null;
    _links?: z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
export declare const ReleaseFileDetailSchema: z.ZodObject<{
    release_id: z.ZodString;
    release_version: z.ZodNullable<z.ZodString>;
    path: z.ZodString;
    type: z.ZodEnum<["page", "function", "component", "file"]>;
    size: z.ZodNumber;
    updated_at: z.ZodString;
    _links: z.ZodOptional<z.ZodObject<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough">>>;
    content: z.ZodString;
    id: z.ZodString;
    version_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "function" | "page" | "file" | "component";
    path: string;
    release_id: string;
    size: number;
    content: string;
    id: string;
    updated_at: string;
    version_id: string;
    release_version: string | null;
    _links?: z.objectOutputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    type: "function" | "page" | "file" | "component";
    path: string;
    release_id: string;
    size: number;
    content: string;
    id: string;
    updated_at: string;
    version_id: string;
    release_version: string | null;
    _links?: z.objectInputType<{
        self: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        content: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        project: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
        files: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            href: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            href: string;
            method?: string | undefined;
        }, {
            href: string;
            method?: string | undefined;
        }>]>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
export declare const ListProjectsResponseSchema: z.ZodObject<{
    data: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        slug: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        created_at: z.ZodOptional<z.ZodString>;
        updated_at: z.ZodOptional<z.ZodString>;
        provider: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        provider_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        layout: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        layout_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        config: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodRecord<z.ZodString, z.ZodUnknown>]>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        id: string;
        slug: string;
        config?: string | Record<string, unknown> | undefined;
        description?: string | undefined;
        layout?: string | null | undefined;
        provider?: string | null | undefined;
        created_at?: string | undefined;
        updated_at?: string | undefined;
        provider_id?: string | null | undefined;
        layout_id?: string | null | undefined;
    }, {
        name: string;
        id: string;
        slug: string;
        config?: string | Record<string, unknown> | undefined;
        description?: string | undefined;
        layout?: string | null | undefined;
        provider?: string | null | undefined;
        created_at?: string | undefined;
        updated_at?: string | undefined;
        provider_id?: string | null | undefined;
        layout_id?: string | null | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    data: {
        name: string;
        id: string;
        slug: string;
        config?: string | Record<string, unknown> | undefined;
        description?: string | undefined;
        layout?: string | null | undefined;
        provider?: string | null | undefined;
        created_at?: string | undefined;
        updated_at?: string | undefined;
        provider_id?: string | null | undefined;
        layout_id?: string | null | undefined;
    }[];
}, {
    data: {
        name: string;
        id: string;
        slug: string;
        config?: string | Record<string, unknown> | undefined;
        description?: string | undefined;
        layout?: string | null | undefined;
        provider?: string | null | undefined;
        created_at?: string | undefined;
        updated_at?: string | undefined;
        provider_id?: string | null | undefined;
        layout_id?: string | null | undefined;
    }[];
}>;
export declare const LookupDomainResponseSchema: z.ZodObject<{
    project_id: z.ZodString;
    project_slug: z.ZodString;
    project_name: z.ZodString;
    environment: z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        id: string;
    }, {
        name: string;
        id: string;
    }>>;
    release_id: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    project_slug: string;
    project_id: string;
    release_id: string | null;
    project_name: string;
    environment: {
        name: string;
        id: string;
    } | null;
}, {
    project_slug: string;
    project_id: string;
    release_id: string | null;
    project_name: string;
    environment: {
        name: string;
        id: string;
    } | null;
}>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectFile = z.infer<typeof ProjectFileSchema>;
export type PageInfo = z.infer<typeof PageInfoSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;
export type BranchFileListItem = z.infer<typeof BranchFileListItemSchema>;
export type ListBranchFilesResponse = z.infer<typeof ListBranchFilesResponseSchema>;
export type BranchFileDetail = z.infer<typeof BranchFileDetailSchema>;
export type EnvironmentFileListItem = z.infer<typeof EnvironmentFileListItemSchema>;
export type ListEnvironmentFilesResponse = z.infer<typeof ListEnvironmentFilesResponseSchema>;
export type EnvironmentFileDetail = z.infer<typeof EnvironmentFileDetailSchema>;
export type ReleaseFileListItem = z.infer<typeof ReleaseFileListItemSchema>;
export type ListReleaseFilesResponse = z.infer<typeof ListReleaseFilesResponseSchema>;
export type ReleaseFileDetail = z.infer<typeof ReleaseFileDetailSchema>;
export type LookupDomainResponse = z.infer<typeof LookupDomainResponseSchema>;
export declare const API_ENDPOINTS: {
    readonly listProjects: {
        readonly method: "GET";
        readonly path: "/projects";
        readonly description: "List all accessible projects";
    };
    readonly getProject: {
        readonly method: "GET";
        readonly path: "/projects/{projectRef}";
        readonly description: "Get project by UUID or slug";
    };
    readonly listBranchFiles: {
        readonly method: "GET";
        readonly path: "/projects/{projectRef}/branches/{branchName}/files";
        readonly description: "List files in a branch (draft/working copy)";
    };
    readonly getBranchFile: {
        readonly method: "GET";
        readonly path: "/projects/{projectRef}/branches/{branchName}/files/{pathOrId}";
        readonly description: "Get file from a branch by path or UUID";
    };
    readonly listEnvironmentFiles: {
        readonly method: "GET";
        readonly path: "/projects/{projectRef}/environments/{environmentName}/files";
        readonly description: "List files from an environment (deployed release)";
    };
    readonly getEnvironmentFile: {
        readonly method: "GET";
        readonly path: "/projects/{projectRef}/environments/{environmentName}/files/{pathOrId}";
        readonly description: "Get file from an environment by path or UUID";
    };
    readonly listReleaseFiles: {
        readonly method: "GET";
        readonly path: "/projects/{projectRef}/releases/{version}/files";
        readonly description: "List files from a specific release";
    };
    readonly getReleaseFile: {
        readonly method: "GET";
        readonly path: "/projects/{projectRef}/releases/{version}/files/{pathOrId}";
        readonly description: "Get file from a release by path or UUID";
    };
    readonly lookupDomain: {
        readonly method: "GET";
        readonly path: "/projects/{domain}";
        readonly description: "Look up project by custom domain (resolved via project_reference)";
    };
};
//# sourceMappingURL=schemas.d.ts.map