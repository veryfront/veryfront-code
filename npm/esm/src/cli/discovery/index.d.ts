import type { Tool } from "../../tool/index.js";
import type { Prompt } from "../../prompt/index.js";
import type { Resource } from "../../resource/index.js";
import type { Agent } from "../../agent/index.js";
import type { Workflow } from "../../workflow/index.js";
import type { FileSystemAdapter } from "../../platform/adapters/base.js";
export interface DiscoveryConfig {
    baseDir: string;
    toolDirs?: string[];
    agentDirs?: string[];
    resourceDirs?: string[];
    promptDirs?: string[];
    workflowDirs?: string[];
    verbose?: boolean;
    fsAdapter?: FileSystemAdapter;
}
export interface DiscoveryResult {
    tools: Map<string, Tool>;
    agents: Map<string, Agent>;
    resources: Map<string, Resource>;
    prompts: Map<string, Prompt>;
    workflows: Map<string, Workflow>;
    errors: Array<{
        file: string;
        error: Error;
    }>;
}
export declare function discoverAll(config: DiscoveryConfig): Promise<DiscoveryResult>;
export declare function generateAgentIndex(baseDir: string): Promise<void>;
export declare function clearTrackedAgents(): void;
export declare function clearTranspileCache(): void;
//# sourceMappingURL=index.d.ts.map