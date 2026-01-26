import { getErrorDocsUrl } from "../error-codes.js";
export function createErrorSolution(code, config) {
    return {
        ...config,
        code,
        docs: config.docs ?? getErrorDocsUrl(code),
    };
}
export function createSimpleError(code, title, message, steps) {
    return createErrorSolution(code, { title, message, steps });
}
