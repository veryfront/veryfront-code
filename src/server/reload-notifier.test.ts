import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ReloadNotifier, type ReloadProjectInfo } from "./reload-notifier.ts";

describe("server/reload-notifier", () => {
  afterEach(() => ReloadNotifier.reset());

  it("debounces different projects independently", async () => {
    using time = new FakeTime();
    const notifications: Array<{
      paths?: string[];
      project?: ReloadProjectInfo;
    }> = [];
    ReloadNotifier.subscribe((paths, project) => notifications.push({ paths, project }));

    await ReloadNotifier.triggerReload(["app/a.tsx"], {
      projectSlug: "project-a",
      projectDir: "project-a",
    });
    await ReloadNotifier.triggerReload(["app/b.tsx"], {
      projectSlug: "project-b",
      projectDir: "project-b",
    });
    time.tick(301);

    assertEquals(notifications, [
      {
        paths: ["app/a.tsx"],
        project: {
          projectSlug: "project-a",
          projectDir: "project-a",
        },
      },
      {
        paths: ["app/b.tsx"],
        project: {
          projectSlug: "project-b",
          projectDir: "project-b",
        },
      },
    ]);
  });

  it("passes project identity to immediate invalidation listeners", async () => {
    const projects: Array<ReloadProjectInfo | undefined> = [];
    ReloadNotifier.subscribeInvalidate((project) => {
      projects.push(project);
    });

    await ReloadNotifier.triggerReload(["app/page.tsx"], {
      projectSlug: "project-a",
      projectDir: "project-a",
    });

    assertEquals(projects, [{
      projectSlug: "project-a",
      projectDir: "project-a",
    }]);
  });

  it("waits for asynchronous invalidation before scheduling a reload", async () => {
    using time = new FakeTime();
    const releaseInvalidation = Promise.withResolvers<void>();
    const invalidationStarted = Promise.withResolvers<void>();
    const notifications: string[][] = [];
    ReloadNotifier.subscribeInvalidate(() => {
      invalidationStarted.resolve();
      return releaseInvalidation.promise;
    });
    ReloadNotifier.subscribe((paths) => notifications.push(paths ?? []));

    const trigger = ReloadNotifier.triggerReload(["app/page.tsx"], {
      projectSlug: "project-a",
    });
    await invalidationStarted.promise;
    time.tick(301);
    const notificationsBeforeInvalidation = [...notifications];
    releaseInvalidation.resolve();
    await trigger;
    time.tick(301);

    assertEquals(notificationsBeforeInvalidation, []);
    assertEquals(notifications, [["app/page.tsx"]]);
  });

  it("serializes invalidation for repeated events in the same project", async () => {
    const firstInvalidationStarted = Promise.withResolvers<void>();
    const releaseFirstInvalidation = Promise.withResolvers<void>();
    let activeInvalidations = 0;
    let maximumActiveInvalidations = 0;
    let calls = 0;
    ReloadNotifier.subscribeInvalidate(async () => {
      calls++;
      activeInvalidations++;
      maximumActiveInvalidations = Math.max(maximumActiveInvalidations, activeInvalidations);
      try {
        if (calls === 1) {
          firstInvalidationStarted.resolve();
          await releaseFirstInvalidation.promise;
        }
      } finally {
        activeInvalidations--;
      }
    });

    const first = ReloadNotifier.triggerReload(undefined, { projectSlug: "project-a" });
    await firstInvalidationStarted.promise;
    const second = ReloadNotifier.triggerReload(undefined, { projectSlug: "project-a" });
    await Promise.resolve();
    const overlapBeforeRelease = maximumActiveInvalidations;
    releaseFirstInvalidation.resolve();
    await Promise.all([first, second]);

    assertEquals(overlapBeforeRelease, 1);
    assertEquals(maximumActiveInvalidations, 1);
    assertEquals(calls, 2);
  });

  it("does not broadcast a reload when cache invalidation fails", async () => {
    using time = new FakeTime();
    const notifications: string[][] = [];
    ReloadNotifier.subscribeInvalidate(() => Promise.reject(new Error("cache reset failed")));
    ReloadNotifier.subscribe((paths) => notifications.push(paths ?? []));

    await ReloadNotifier.triggerReload(["app/page.tsx"], {
      projectSlug: "project-a",
    });
    time.tick(301);

    assertEquals(notifications, []);
  });

  it("collapses oversized path batches into a full project invalidation", async () => {
    using time = new FakeTime();
    const notifications: Array<string[] | undefined> = [];
    ReloadNotifier.subscribe((paths) => notifications.push(paths));
    const paths = Array.from({ length: 4_097 }, (_, index) => `app/${index}.tsx`);

    await ReloadNotifier.triggerReload(paths, { projectSlug: "project-a" });
    await ReloadNotifier.triggerReload(["app/later.tsx"], { projectSlug: "project-a" });
    time.tick(301);

    assertEquals(notifications, [undefined]);
  });

  it("bounds changed paths by UTF-8 bytes", async () => {
    using time = new FakeTime();
    const notifications: Array<string[] | undefined> = [];
    ReloadNotifier.subscribe((paths) => notifications.push(paths));

    await ReloadNotifier.triggerReload([`app/${"😀".repeat(2_000)}.tsx`], {
      projectSlug: "project-a",
    });
    time.tick(301);

    assertEquals(notifications, [undefined]);
  });

  it("rejects invalid project metadata before invoking listeners", async () => {
    let invalidationCalls = 0;
    ReloadNotifier.subscribeInvalidate(() => {
      invalidationCalls++;
    });

    await assertRejects(
      () =>
        ReloadNotifier.triggerReload(undefined, {
          projectSlug: `invalid\n${"x".repeat(600)}`,
        }),
      TypeError,
      "project metadata",
    );
    assertEquals(invalidationCalls, 0);
  });
});
