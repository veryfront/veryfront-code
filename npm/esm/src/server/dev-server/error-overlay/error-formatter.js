const ERROR_SUGGESTIONS = [
    {
        patterns: ["unexpected token", "parse error"],
        suggestion: "Check for syntax errors in your file. Common issues include unclosed JSX tags or invalid JavaScript expressions.",
    },
    {
        patterns: ["cannot find module", "module not found"],
        suggestion: "Make sure the imported module exists and the path is correct. For npm packages, ensure they're installed.",
    },
    {
        patterns: ["frontmatter"],
        suggestion: "Check your frontmatter syntax. It should be valid YAML between '---' markers at the top of the file.",
    },
    {
        patterns: ["invalid hook call", "hooks can only", " hook", "usestate", "useeffect"],
        suggestion: "React hooks can only be called from within function components or custom hooks. Make sure you're not using hooks in server-side code.",
    },
    {
        patterns: ["component"],
        suggestion: "Ensure your component is properly exported and the import path is correct.",
    },
    {
        patterns: ["hydration"],
        suggestion: "Hydration errors occur when server and client HTML don't match. Check for client-only code like window/document access.",
    },
];
export function getSuggestion(error) {
    const message = error.message.toLowerCase();
    for (const { patterns, suggestion } of ERROR_SUGGESTIONS) {
        if (patterns.some((pattern) => message.includes(pattern)))
            return suggestion;
    }
    return undefined;
}
export function formatErrorType(type) {
    return `${type[0].toUpperCase()}${type.slice(1)}`;
}
