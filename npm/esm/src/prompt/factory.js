import { createError, toError } from "../errors/veryfront-error.js";
export function prompt(config) {
    const id = config.id ?? generatePromptId();
    return {
        id,
        description: config.description,
        async getContent(variables) {
            const vars = variables ?? {};
            if (config.content)
                return interpolateVariables(config.content, vars);
            if (config.generate)
                return await config.generate(vars);
            throw toError(createError({
                type: "agent",
                message: `Prompt "${id}" has no content or generator`,
            }));
        },
    };
}
let promptIdCounter = 0;
function generatePromptId() {
    return `prompt_${Date.now()}_${promptIdCounter++}`;
}
function interpolateVariables(template, variables) {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        const value = variables[key];
        return value != null ? String(value) : match;
    });
}
