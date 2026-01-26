import { toolRegistry } from "../tool/index.js";
import { resourceRegistry } from "../resource/index.js";
import { promptRegistry } from "../prompt/index.js";
export function getMCPRegistry() {
    return {
        tools: toolRegistry.getAll(),
        resources: resourceRegistry.getAll(),
        prompts: promptRegistry.getAll(),
    };
}
export function registerTool(id, tool) {
    toolRegistry.register(id, tool);
}
export function registerResource(id, resource) {
    resourceRegistry.register(id, resource);
}
export function registerPrompt(id, prompt) {
    promptRegistry.register(id, prompt);
}
export function getMCPStats() {
    const tools = toolRegistry.getAll().size;
    const resources = resourceRegistry.getAll().size;
    const prompts = promptRegistry.getAll().size;
    return { tools, resources, prompts, total: tools + resources + prompts };
}
export function clearMCPRegistry() {
    toolRegistry.clear();
    resourceRegistry.clear();
    promptRegistry.clear();
}
