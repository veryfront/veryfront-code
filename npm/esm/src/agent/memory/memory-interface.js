/**************************
 * Memory Interface
 *
 * Core memory abstractions extracted to avoid circular dependencies.
 * This file should NOT import from ../types.ts
 *
 * The Memory interface uses generic type parameters to work with
 * any message type, allowing implementations to be type-safe while
 * avoiding circular dependencies with the main types module.
 **************************/
export function getTextFromMemoryParts(parts) {
    return parts
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("");
}
export function estimateTokens(messages) {
    const totalChars = messages.reduce((sum, msg) => {
        const text = getTextFromMemoryParts(msg.parts);
        return sum + text.length;
    }, 0);
    return Math.ceil(totalChars / 4);
}
