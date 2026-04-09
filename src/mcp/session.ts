/**
 * Manages MCP sessions for the Streamable HTTP transport.
 * Sessions are created during initialization and validated on subsequent requests.
 */
export class SessionManager {
  private sessions = new Set<string>();

  create(): string {
    const id = crypto.randomUUID();
    this.sessions.add(id);
    return id;
  }

  isValid(id: string): boolean {
    return this.sessions.has(id);
  }

  terminate(id: string): void {
    this.sessions.delete(id);
  }

  get size(): number {
    return this.sessions.size;
  }

  clear(): void {
    this.sessions.clear();
  }
}
