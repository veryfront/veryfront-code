import { WebSocketDispatch } from "./websocket/dispatch.ts";
import { WebSocketSubscription } from "./websocket/subscription.ts";
import type { PokeAckType, PokeMetrics, WebSocketDeps } from "./websocket/types.ts";

export type { PreviewStyleArtifactInfo, WebSocketDeps } from "./websocket/types.ts";

export class WebSocketManager {
  private readonly dispatch: WebSocketDispatch;
  private subscription: WebSocketSubscription | null = null;

  constructor(deps: WebSocketDeps) {
    this.dispatch = new WebSocketDispatch(deps, {
      getConnectionId: () => this.subscription?.connectionId ?? null,
      sendPokeAck: (
        type: PokeAckType,
        changedPaths: string[] | undefined,
        totalInvalidations: number,
      ) => this.subscription?.sendPokeAck(type, changedPaths, totalInvalidations),
    });
    this.subscription = new WebSocketSubscription(deps, {
      onMessage: (event) => this.dispatch.handlePokeMessage(event),
      getTotalPokesReceived: () => this.dispatch.getPokeMetrics().received,
    });
  }

  getPokeMetrics(): PokeMetrics & { connectionId: string | null } {
    return {
      ...this.dispatch.getPokeMetrics(),
      connectionId: this.subscription?.connectionId ?? null,
    };
  }

  connect(projectId: string): void {
    this.subscription?.connect(projectId);
  }

  dispose(): void {
    this.dispatch.dispose();
    this.subscription?.dispose();
    this.subscription = null;
  }
}
