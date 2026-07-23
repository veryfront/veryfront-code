/**
 * Ownership of Node HTTP upgrade listeners and noServer WebSocket servers.
 *
 * @module server/node-upgrade-lifecycle
 */

export interface NodeUpgradeEventSource {
  on(event: "upgrade", listener: (...args: unknown[]) => void): unknown;
  off?(event: "upgrade", listener: (...args: unknown[]) => void): unknown;
  removeListener?(event: "upgrade", listener: (...args: unknown[]) => void): unknown;
}

export interface OwnedWebSocketClient {
  terminate?(): void;
  close?(): void;
}

export interface OwnedUpgradeSocket {
  destroy(): void;
}

export interface OwnedWebSocketServer {
  readonly clients?: Iterable<OwnedWebSocketClient>;
  close(callback: (error?: Error) => void): void;
}

/** Owns every global listener and socket server created by one handler. */
export class NodeUpgradeLifecycle {
  private readonly listeners = new Map<NodeUpgradeEventSource, (...args: unknown[]) => void>();
  private readonly socketServers = new Set<OwnedWebSocketServer>();
  private readonly upgradeSockets = new Set<OwnedUpgradeSocket>();
  private disposePromise: Promise<void> | undefined;
  private disposed = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Attach at most one upgrade listener to a given HTTP server. */
  attach(source: NodeUpgradeEventSource, listener: (...args: unknown[]) => void): boolean {
    if (this.disposed) throw new Error("Node upgrade lifecycle is already disposed");
    if (this.listeners.has(source)) return false;
    source.on("upgrade", listener);
    this.listeners.set(source, listener);
    return true;
  }

  /** Register a noServer WebSocket server before it handles an upgrade. */
  track(server: OwnedWebSocketServer): void {
    if (this.disposed) throw new Error("Node upgrade lifecycle is already disposed");
    this.socketServers.add(server);
  }

  /** Retain an accepted raw upgrade socket until handshake completion. */
  trackSocket(socket: OwnedUpgradeSocket): () => void {
    if (this.disposed) throw new Error("Node upgrade lifecycle is already disposed");
    this.upgradeSockets.add(socket);
    return () => {
      this.upgradeSockets.delete(socket);
    };
  }

  /** Remove listeners, terminate clients, and close every owned server once. */
  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    const attempt = this.disposeInternal();
    this.disposePromise = attempt;
    void attempt.then(
      () => undefined,
      () => {
        // Cleanup hooks are required to be idempotent. Retain failed
        // resources and permit an explicit later retry while still sharing
        // the current attempt across concurrent callers.
        if (this.disposePromise === attempt) this.disposePromise = undefined;
      },
    );
    return attempt;
  }

  private async disposeInternal(): Promise<void> {
    this.disposed = true;
    const failures: unknown[] = [];

    for (const [source, listener] of this.listeners) {
      try {
        if (source.off) source.off("upgrade", listener);
        else if (source.removeListener) source.removeListener("upgrade", listener);
        else throw new Error("Node upgrade source cannot remove listeners");
        this.listeners.delete(source);
      } catch (error) {
        failures.push(error);
      }
    }

    for (const socket of this.upgradeSockets) {
      try {
        socket.destroy();
        this.upgradeSockets.delete(socket);
      } catch (error) {
        failures.push(error);
      }
    }

    await Promise.all(
      [...this.socketServers].map(async (server) => {
        const serverFailures: unknown[] = [];
        try {
          for (const client of server.clients ?? []) {
            try {
              if (client.terminate) client.terminate();
              else client.close?.();
            } catch (error) {
              serverFailures.push(error);
            }
          }
          await new Promise<void>((resolve, reject) => {
            try {
              server.close((error) => error ? reject(error) : resolve());
            } catch (error) {
              reject(error);
            }
          });
        } catch (error) {
          serverFailures.push(error);
        }

        if (serverFailures.length === 0) {
          this.socketServers.delete(server);
        } else {
          failures.push(...serverFailures);
        }
      }),
    );

    if (failures.length > 0) {
      const details = failures
        .map((error) => error instanceof Error ? error.message : String(error))
        .join("; ");
      throw new AggregateError(
        failures,
        `Node WebSocket upgrade cleanup failed${details ? `: ${details}` : ""}`,
      );
    }
  }
}
