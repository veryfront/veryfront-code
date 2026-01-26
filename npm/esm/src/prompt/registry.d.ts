import type { Prompt } from "./types.js";
declare class PromptRegistryClass {
    private prompts;
    register(id: string, promptInstance: Prompt): void;
    get(id: string): Prompt | undefined;
    getContent(id: string, variables?: Record<string, unknown>): Promise<string>;
    getAll(): Map<string, Prompt>;
    list(): string[];
    has(id: string): boolean;
    clear(): void;
}
export declare const promptRegistry: PromptRegistryClass;
export {};
//# sourceMappingURL=registry.d.ts.map