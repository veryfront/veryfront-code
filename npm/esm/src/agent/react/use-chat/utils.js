export function generateClientId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
export function createAssistantMessage(messageId, parts) {
    return {
        id: messageId || generateClientId("msg"),
        role: "assistant",
        parts,
    };
}
