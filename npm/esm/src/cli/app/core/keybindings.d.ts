import type { KeyChordState } from "./types.js";
export declare const VIM_KEYS: {
    readonly UP: "k";
    readonly DOWN: "j";
    readonly LEFT: "h";
    readonly RIGHT: "l";
};
export declare const ARROW_KEYS: {
    readonly UP: "\u001B[A";
    readonly DOWN: "\u001B[B";
    readonly RIGHT: "\u001B[C";
    readonly LEFT: "\u001B[D";
};
export declare const CTRL_KEYS: {
    readonly D: "\u0004";
    readonly U: "\u0015";
    readonly C: "\u0003";
    readonly A: "\u0001";
    readonly P: "\u0010";
};
export declare const CHORD_PREFIX: {
    readonly GO_TO: "g";
};
export declare const CHORD_TIMEOUT = 500;
export declare function startChord(prefix: string): KeyChordState;
export declare function setChordCount(state: KeyChordState, count: number): KeyChordState;
export declare function addDigitToCount(state: KeyChordState, digit: number): KeyChordState;
export declare function clearChord(): KeyChordState;
export declare function isChordTimedOut(state: KeyChordState): boolean;
export declare function getEffectiveCount(state: KeyChordState): number;
export interface ParsedKey {
    key: string;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    isArrow: boolean;
    isDigit: boolean;
    digit: number | null;
}
export declare function parseKey(raw: string): ParsedKey;
export type Direction = "up" | "down" | "left" | "right" | "top" | "bottom" | "page-up" | "page-down";
export interface NavAction {
    direction: Direction;
    count: number;
}
export declare function getNavAction(parsed: ParsedKey, chord: KeyChordState): NavAction | null;
export declare function getChordAction(pending: string, key: string): NavAction | string | null;
export interface KeyHandleResult {
    navAction: NavAction | null;
    stringAction: string | null;
    chord: KeyChordState;
    consumed: boolean;
}
export declare function handleVimKey(raw: string, chord: KeyChordState): KeyHandleResult;
export declare function applyNavToIndex(action: NavAction, currentIndex: number, totalItems: number, pageSize?: number): number;
export declare function calculateScrollOffset(index: number, currentOffset: number, visibleCount: number, totalItems: number): number;
//# sourceMappingURL=keybindings.d.ts.map