import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEV_SHORTCUTS } from "../../ui/components/shortcuts.ts";
import {
  accountStatusHint,
  announceNoSync,
  connectedDevDisabled,
  devSessionShortcuts,
  guardSyncShortcuts,
  NO_SYNC_NOTICE,
  NO_SYNC_SHORTCUT_NOTICE,
} from "./no-sync.ts";

describe("dev --no-sync session", () => {
  it("keeps a linked project connected unless proxy mode or --no-sync is set", () => {
    assertEquals(connectedDevDisabled({ proxyMode: false, noSync: false }), false);
    assertEquals(connectedDevDisabled({ proxyMode: true, noSync: false }), true);
    assertEquals(connectedDevDisabled({ proxyMode: false, noSync: true }), true);
  });

  it("announces skipped sync only for a linked project that would have synced", () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    const linked = { noSync: true, proxyMode: false, linkedProjectSlug: "demo" };

    assertEquals(announceNoSync({ ...linked, noSync: false }, log), false);
    assertEquals(announceNoSync({ ...linked, proxyMode: true }, log), false);
    assertEquals(announceNoSync({ ...linked, linkedProjectSlug: undefined }, log), false);
    assertEquals(lines, []);

    assertEquals(announceNoSync(linked, log), true);
    assertEquals(lines, [`  ${NO_SYNC_NOTICE}`]);
  });

  it("points the account status at the project shortcut only when it works", () => {
    assertEquals(accountStatusHint(false), ", press s to select a project");
    assertEquals(accountStatusHint(true), "");
  });

  it("names both ways sync was turned off in the shortcut notice", () => {
    assertEquals(NO_SYNC_SHORTCUT_NOTICE.includes("--no-sync"), true);
    assertEquals(NO_SYNC_SHORTCUT_NOTICE.includes("VERYFRONT_DEV_NO_SYNC"), true);
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
      noSync,
      {
        onSync: () => calls.push("select"),
        onPull: () => calls.push("pull"),
        onPush: () => calls.push("push"),
        onQuit: () => calls.push("quit"),
      },
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
