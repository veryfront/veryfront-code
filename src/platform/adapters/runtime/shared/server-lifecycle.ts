import type { ServeOptions, Server } from "../../base.ts";

type RequestHandler = (request: Request) => Promise<Response> | Response;
type ServerFactory = (
  handler: RequestHandler,
  options: ServeOptions,
) => Promise<Server>;

function shutdownInProgressError(): DOMException {
  return new DOMException(
    "Server startup was cancelled because the runtime adapter is shutting down",
    "AbortError",
  );
}

class ManagedServer implements Server {
  private stopPromise: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly delegate: Server,
    private readonly onStopped: () => void,
  ) {}

  get addr(): { hostname: string; port: number } {
    return this.delegate.addr;
  }

  stop(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.stopPromise) return this.stopPromise;

    const attempt = Promise.resolve().then(() => this.delegate.stop());
    const result = attempt.then(
      () => {
        this.stopped = true;
        this.stopPromise = undefined;
        this.onStopped();
      },
      (error) => {
        this.stopPromise = undefined;
        throw error;
      },
    );
    this.stopPromise = result;
    return result;
  }
}

/**
 * Own every server started by a runtime adapter.
 *
 * Startups that race with shutdown are retired before their promises reject.
 * Successful direct `Server.stop()` calls unregister themselves, concurrent
 * shutdown callers share one attempt, and failed stops remain tracked so a
 * later shutdown can retry only the unfinished resources.
 */
export class ManagedServerRegistry {
  private readonly servers = new Set<ManagedServer>();
  private readonly pendingStarts = new Set<Promise<Server>>();
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | undefined;

  start(
    createServer: ServerFactory,
    handler: RequestHandler,
    options: ServeOptions,
  ): Promise<Server> {
    if (this.shuttingDown) return Promise.reject(shutdownInProgressError());

    const operation = (async (): Promise<Server> => {
      const server = await createServer(handler, options);
      const managed = this.track(server);

      if (this.shuttingDown) {
        await managed.stop();
        throw shutdownInProgressError();
      }
      return managed;
    })();

    this.pendingStarts.add(operation);
    void operation.then(
      () => this.pendingStarts.delete(operation),
      () => this.pendingStarts.delete(operation),
    );
    return operation;
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;

    this.shuttingDown = true;
    const attempt = this.stopAll();
    const shared = attempt.finally(() => {
      this.shutdownPromise = undefined;
      this.shuttingDown = false;
    });
    this.shutdownPromise = shared;
    return shared;
  }

  private track(server: Server): ManagedServer {
    const managed = new ManagedServer(server, () => this.servers.delete(managed));
    this.servers.add(managed);
    return managed;
  }

  private async stopAll(): Promise<void> {
    if (this.pendingStarts.size > 0) {
      await Promise.allSettled([...this.pendingStarts]);
    }

    const servers = [...this.servers];
    const results = await Promise.allSettled(servers.map((server) => server.stop()));
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length === 0) return;

    const details = errors
      .map((error) => error instanceof Error ? error.message : String(error))
      .join("; ");
    throw new AggregateError(
      errors,
      `Failed to stop ${errors.length} managed server${errors.length === 1 ? "" : "s"}: ${details}`,
    );
  }
}

export function createServeHandler(
  createServer: ServerFactory,
  registry: ManagedServerRegistry,
) {
  return (
    handler: RequestHandler,
    options: ServeOptions = {},
  ): Promise<Server> => registry.start(createServer, handler, options);
}
