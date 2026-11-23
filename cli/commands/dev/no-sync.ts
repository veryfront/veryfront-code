import type { Shortcut } from "../../ui/components/shortcuts.ts";
import type { KeyboardOptions } from "../../ui/keyboard.ts";

/** Shown once at startup when a linked project starts with source sync off. */
export const NO_SYNC_NOTICE =
  "Source sync is off (--no-sync or VERYFRONT_DEV_NO_SYNC). Nothing is pushed or pulled, and " +
  "connected agent runs and the Studio link are unavailable for this session.";

/** Printed when a sync shortcut is pressed in a session that has sync off. */
export const NO_SYNC_SHORTCUT_NOTICE =
  "Source sync is off for this session. Restart without --no-sync and with " +
  "VERYFRONT_DEV_NO_SYNC unset to select, pull or push.";

const SYNC_SHORTCUT_KEYS: ReadonlySet<string> = new Set(["s", "p", "u"]);

/**
 * Whether a linked project starts local-only. Proxy projects never take the
 * Cloud connection, and `--no-sync` opts out of it: without the startup sync,
 * connected admission would read declarations the local source no longer
 * matches, so the opt-out skips the connection rather than only the push.
 */
export function connectedDevDisabled(options: { proxyMode: boolean; noSync: boolean }): boolean {
  return options.proxyMode || options.noSync;
}

/**
 * Say once at startup that source sync is off. A proxy or unlinked project
 * never synced, so only a linked one is told. Returns whether it was said.
 */
export function announceNoSync(
  options: { noSync: boolean; proxyMode: boolean; linkedProjectSlug: string | undefined },
  log: (line: string) => void = console.log,
): boolean {
  if (!options.noSync || options.proxyMode || !options.linkedProjectSlug) return false;
  log(`  ${NO_SYNC_NOTICE}`);
  return true;
}

/** The account status hint: it points at the project shortcut only when that key works. */
export function accountStatusHint(noSync: boolean): string {
  return noSync ? "" : ", press s to select a project";
}

/** The shortcuts a session lists: the project, pull and push keys go when sync is off. */
export function devSessionShortcuts(shortcuts: readonly Shortcut[], noSync: boolean): Shortcut[] {
  return shortcuts.filter((shortcut) => !noSync || !SYNC_SHORTCUT_KEYS.has(shortcut.key));
}

/**
 * Replace the project, pull and push handlers when sync is off, so a key press
 * cannot overwrite local files or push source in a session that promised
 * neither. The keys answer with a notice instead of doing nothing.
 */
export function guardSyncShortcuts(
  noSync: boolean,
  options: KeyboardOptions,
  notify: () => void = () => console.log(`  ${NO_SYNC_SHORTCUT_NOTICE}`),
): KeyboardOptions {
  if (!noSync) return options;
  return { ...options, onSync: notify, onPull: notify, onPush: notify };
}
