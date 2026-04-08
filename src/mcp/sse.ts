/**
 * Utility for formatting Server-Sent Events per the SSE standard.
 * Used by the Streamable HTTP transport for MCP.
 */
export class SSEWriter {
  formatEvent(data: unknown, id?: string): string {
    let event = "";
    if (id) event += `id: ${id}\n`;
    event += `data: ${JSON.stringify(data)}\n\n`;
    return event;
  }

  formatRetry(ms: number): string {
    return `retry: ${ms}\n\n`;
  }

  formatPrimingEvent(id: string): string {
    return `id: ${id}\ndata: \n\n`;
  }
}
