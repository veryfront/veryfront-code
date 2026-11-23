import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEV_SHORTCUTS } from "../../ui/components/shortcuts.ts";
import {
  announcesNoSync,
  connectedDevDisabled,
  devSessionShortcuts,
  guardSyncShortcuts,
} from "./no-sync.ts";

describe("dev --no-sync session", () => {
  it("keeps a linked project connected unless proxy mode or --no-sync is set", () => {
    assertEquals(connectedDevDisabled({ proxyMode: false, noSync: false }), false);
    assertEquals(connectedDevDisabled({ proxyMode: true, noSync: false }), true);
    assertEquals(connectedDevDisabled({ proxyMode: false, noSync: true }), true);
  });

  it("announces skipped sync only for a linked project that would have synced", () => {
    const linked = { noSync: true, proxyMode: false, linkedProjectSlug: "demo" };
    assertEquals(announcesNoSync(linked), true);
    assertEquals(announcesNoSync({ ...linked, noSync: false }), false);
    assertEquals(announcesNoSync({ ...linked, proxyMode: true }), false);
    assertEquals(announcesNoSync({ ...linked, linkedProjectSlug: undefined }), false);
  });

  it("lists every shortcut in a syncing session", () => {
    assertEquals(devSessionShortcuts(DEV_SHORTCUTS, false), DEV_SHORTCUTS);
  });

  it("drops the project, pull and push shortcuts when sync is off", () => {
    const keys = devSessionShortcuts(DEV_SHORTCUTS, true).map((shortcut) => shortcut.key);
    assertEquals(keys, ["?", "o", "l", "a", "c", "q"]);
  });

  function pressSyncKeys(noSync: boolean): string[] {
    const calls: string[] = [];
    const guarded = guardSyncShortcuts(
      {
        onSync: () => calls.push("select"),
        onPull: () => calls.push("pull"),
        onPush: () => calls.push("push"),
        onQuit: () => calls.push("quit"),
      },
      noSync,
      () => calls.push("notice"),
    );
    guarded.onSync?.();
    guarded.onPull?.();
    guarded.onPush?.();
    guarded.onQuit?.();
    return calls;
  }

  it("leaves the sync shortcuts working in a syncing session", () => {
    assertEquals(pressSyncKeys(false), ["select", "pull", "push", "quit"]);
  });

  it("never selects, pulls or pushes from a shortcut when sync is off", () => {
    assertEquals(pressSyncKeys(true), ["notice", "notice", "notice", "quit"]);
  });
});
