import type { Tool } from "#veryfront/tool";
import type { Resource } from "#veryfront/resource";
import type { Prompt } from "#veryfront/prompt";

export interface MCPRegistry {
  tools: Map<string, Tool>;
  resources: Map<string, Resource>;
  prompts: Map<string, Prompt>;
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

export interface MCPStats {
  tools: number;
  resources: number;
  prompts: number;
  total: number;
}
