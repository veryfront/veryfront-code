
import type { z } from "zod";

export interface ResourceConfig<TParams = any, TData = any> {
  pattern?: string;

  description: string;

  paramsSchema: z.ZodSchema<TParams>;

  load: (params: TParams) => Promise<TData> | TData;

  subscribe?: (params: TParams) => AsyncIterable<TData>;

  mcp?: {
    enabled?: boolean;

    cachePolicy?: "no-cache" | "cache" | "cache-first";
  };
}

export interface Resource<TParams = any, TData = any> {
  id: string;

  pattern: string;

  description: string;

  paramsSchema: z.ZodSchema<TParams>;

  load: (params: TParams) => Promise<TData>;

  subscribe?: (params: TParams) => AsyncIterable<TData>;

  mcp?: ResourceConfig["mcp"];
}

export interface PromptConfig {
  id?: string;

  description: string;

  content?: string;

  generate?: (variables: Record<string, unknown>) => string | Promise<string>;
}

export interface Prompt {
  id: string;

  description: string;

  getContent: (variables?: Record<string, unknown>) => Promise<string>;
}

export interface MCPServerConfig {
  enabled: boolean;

  port?: number;

  auth?: {
    type: "bearer" | "api-key" | "none";

    validate?: (token: string) => Promise<boolean> | boolean;
  };

  cors?: {
    enabled: boolean;
    origins?: string[];
  };
}

export interface MCPRegistry {
  tools: Map<string, import("./tool.ts").Tool>;

  resources: Map<string, Resource>;

  prompts: Map<string, Prompt>;
}
