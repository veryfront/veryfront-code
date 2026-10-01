import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __subscribeLogRecordEmitter } from "#veryfront/utils/logger/logger.ts";
import { FakeTime } from "#std/testing/time";
import { MemoryBackend } from "../backends/memory.ts";
import { createWorkflowClient } from "./workflow-client.ts";

type MaintenanceKind = "approval" | "event-wait";

class BlockingMaintenanceBackend extends MemoryBackend {
  readonly readStarted = Promise.withResolvers<void>();
  readonly continueRead = Promise.withResolvers<void>();
  readonly readFinished = Promise.withResolvers<void>();
  closed = false;
  readCalls = 0;
  destroyCalls = 0;

  constructor(private readonly kind: MaintenanceKind) {
    super();
  }

  private async blockRead(): Promise<void> {
    this.readCalls += 1;
    this.readStarted.resolve();
    try {
      await this.continueRead.promise;
      if (this.closed) throw new Error("The client is closed");
    } finally {
      this.readFinished.resolve();
    }
  }

  override async listPendingApprovals(
    ...args: Parameters<MemoryBackend["listPendingApprovals"]>
  ): ReturnType<MemoryBackend["listPendingApprovals"]> {
    if (this.kind === "approval") await this.blockRead();
    return await super.listPendingApprovals(...args);
  }

  override async listPendingEventWaits(): ReturnType<MemoryBackend["listPendingEventWaits"]> {
    if (this.kind === "event-wait") await this.blockRead();
    return await super.listPendingEventWaits();
  }

  override async destroy(): Promise<void> {
    this.destroyCalls += 1;
    this.closed = true;
    await super.destroy();
  }
}

class OverlappingMaintenanceBackend extends MemoryBackend {
  readonly releases: Array<PromiseWithResolvers<void>> = [];
  closed = false;
  destroyCalls = 0;
  readCalls = 0;
  private released = false;

  constructor(private readonly kind: MaintenanceKind) {
    super();
  }

  private async blockRead(): Promise<void> {
    if (this.released) return;
    this.readCalls += 1;
    const release = Promise.withResolvers<void>();
    this.releases.push(release);
    await release.promise;
  }

  override async listPendingApprovals(
    ...args: Parameters<MemoryBackend["listPendingApprovals"]>
  ): ReturnType<MemoryBackend["listPendingApprovals"]> {
    if (this.kind === "approval") await this.blockRead();
    return await super.listPendingApprovals(...args);
  }

  override async listRunEventDeliveryClaims(
    ...args: Parameters<MemoryBackend["listRunEventDeliveryClaims"]>
  ): ReturnType<MemoryBackend["listRunEventDeliveryClaims"]> {
    if (this.kind === "event-wait") await this.blockRead();
    return await super.listRunEventDeliveryClaims(...args);
  }

  releaseAll(): void {
    this.released = true;
    for (const release of this.releases) release.resolve();
  }

  release(index: number): void {
    this.releases[index]?.resolve();
  }

  override async destroy(): Promise<void> {
    this.destroyCalls += 1;
    this.closed = true;
    await super.destroy();
  }
}

async function waitForReadStart(backend: BlockingMaintenanceBackend): Promise<void> {
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      backend.readStarted.promise,
      new Promise<never>((_, reject) => {
        watchdog = setTimeout(
          () => reject(new Error("maintenance read did not start within the test runtime bound")),
          5_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(watchdog);
  }
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("WorkflowClient in-flight maintenance shutdown", () => {
  for (
    const { kind, warning } of [
      { kind: "approval", warning: "Expiration check failed" },
      { kind: "event-wait", warning: "Event wait expiration check failed" },
    ] as const
  ) {
    it(`keeps the backend open for an already-started ${kind} expiration pass`, async () => {
      const backend = new BlockingMaintenanceBackend(kind);
      const messages: string[] = [];
      const unsubscribe = __subscribeLogRecordEmitter((entry) => messages.push(entry.message));
      const client = createWorkflowClient({
        backend,
        approval: {
          expirationCheckInterval: kind === "approval" ? 1 : 0,
          decisionClaimCheckInterval: 0,
        },
        eventWait: {
          expirationCheckInterval: kind === "event-wait" ? 1 : 0,
          claimRecoveryCheckInterval: 0,
        },
      });
      try {
        await waitForReadStart(backend);
        const shutdown = client.destroy();
        const repeatedShutdown = client.destroy();
        let shutdownResolved = false;
        let repeatedShutdownResolved = false;
        void shutdown.then(() => shutdownResolved = true);
        void repeatedShutdown.then(() => repeatedShutdownResolved = true);
        await tick();
        const closedBeforeRelease = backend.closed;
        const shutdownsResolvedBeforeRelease = shutdownResolved || repeatedShutdownResolved;
        backend.continueRead.resolve();
        await backend.readFinished.promise;
        await Promise.all([shutdown, repeatedShutdown]);
        await client.destroy();
        await tick();
        assertEquals(
          {
            closedBeforeRelease,
            destroyCalls: backend.destroyCalls,
            readCalls: backend.readCalls,
            shutdownsResolvedBeforeRelease,
            warnings: messages.filter((message) => message.includes(warning)),
          },
          {
            closedBeforeRelease: false,
            destroyCalls: 1,
            readCalls: 1,
            shutdownsResolvedBeforeRelease: false,
            warnings: [],
          },
        );
      } finally {
        backend.continueRead.resolve();
        await client.destroy();
        unsubscribe();
      }
    });

    it(`starts every scheduled ${kind} expiration pass while an earlier pass is in flight`, async () => {
      using time = new FakeTime();
      const backend = new OverlappingMaintenanceBackend(kind);
      const client = createWorkflowClient({
        backend,
        approval: {
          expirationCheckInterval: kind === "approval" ? 10 : 0,
          decisionClaimCheckInterval: 0,
        },
        eventWait: {
          expirationCheckInterval: kind === "event-wait" ? 10 : 0,
          claimRecoveryCheckInterval: 0,
        },
      });
      try {
        await time.tickAsync(10);
        await time.tickAsync(10);
        assertEquals(backend.readCalls, 2);

        const shutdown = client.destroy();
        let shutdownResolved = false;
        void shutdown.then(() => shutdownResolved = true);
        await time.tickAsync(0);
        assertEquals({ closed: backend.closed, shutdownResolved }, {
          closed: false,
          shutdownResolved: false,
        });

        backend.release(0);
        await time.tickAsync(0);
        assertEquals({ closed: backend.closed, shutdownResolved }, {
          closed: false,
          shutdownResolved: false,
        });

        backend.release(1);
        await shutdown;
        await time.tickAsync(100);
        assertEquals(
          {
            closed: backend.closed,
            destroyCalls: backend.destroyCalls,
            readCalls: backend.readCalls,
          },
          { closed: true, destroyCalls: 1, readCalls: 2 },
        );
      } finally {
        backend.releaseAll();
        await client.destroy();
      }
    });
  }
});
