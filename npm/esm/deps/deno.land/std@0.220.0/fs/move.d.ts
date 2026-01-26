/**
 * Error thrown in {@linkcode move} or {@linkcode moveSync} when the
 * destination is a subdirectory of the source.
 */
export declare class SubdirectoryMoveError extends Error {
    /** Constructs a new instance. */
    constructor(src: string | URL, dest: string | URL);
}
/** Options for {@linkcode move} and {@linkcode moveSync}. */
export interface MoveOptions {
    /**
     * Whether the destination file should be overwritten if it already exists.
     *
     * @default {false}
     */
    overwrite?: boolean;
}
/**
 * Moves a file or directory.
 *
 * @example
 * ```ts
 * import { move } from "https://deno.land/std@$STD_VERSION/fs/mod.ts";
 *
 * move("./foo", "./bar"); // returns a promise
 * ```
 */
export declare function move(src: string | URL, dest: string | URL, { overwrite }?: MoveOptions): Promise<void>;
/**
 * Moves a file or directory synchronously.
 *
 * @example
 * ```ts
 * import { moveSync } from "https://deno.land/std@$STD_VERSION/fs/mod.ts";
 *
 * moveSync("./foo", "./bar"); // void
 * ```
 */
export declare function moveSync(src: string | URL, dest: string | URL, { overwrite }?: MoveOptions): void;
//# sourceMappingURL=move.d.ts.map