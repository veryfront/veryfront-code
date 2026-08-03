/**
 * Stateless SSE formatting utilities per the Server-Sent Events standard.
 * Used by the Streamable HTTP transport for MCP.
 */

export function formatSSEEvent(data: unknown, id?: string): string {
  let event = "";
  if (id) event += `id: ${id}\n`;
  event += `data: ${JSON.stringify(data)}\n\n`;
  return event;
}

/** Formats sseretry. */
export function formatSSERetry(ms: number): string {
  return `retry: ${ms}\n\n`;
}

/** Format an SSE priming event. */
export function formatSSEPrimingEvent(id: string): string {
  return `id: ${id}\ndata: \n\n`;
}
