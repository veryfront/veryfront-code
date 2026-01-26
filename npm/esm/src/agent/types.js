export function getTextFromParts(parts) {
    return parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
}
export function hasArgs(part) {
    return "args" in part && part.args !== undefined;
}
export function hasInput(part) {
    return "input" in part && part.input !== undefined;
}
export function getToolArguments(part) {
    if (hasArgs(part))
        return part.args;
    if (hasInput(part))
        return part.input;
    const p = part;
    throw new Error(`Tool call part for "${p.toolName}" (${p.toolCallId}) missing both 'args' and 'input' fields`);
}
