export declare const LF: "\n";
/** End-of-line character for Windows platforms. */
export declare const CRLF: "\r\n";
/**
 * End-of-line character evaluated for the current platform.
 *
 * @example
 * ```ts
 * import { EOL } from "https://deno.land/std@$STD_VERSION/fs/eol.ts";
 *
 * EOL; // Returns "\n" on POSIX platforms or "\r\n" on Windows
 * ```
 */
export declare const EOL: "\n" | "\r\n";
/**
 * Detect the EOL character for string input.
 * returns null if no newline.
 *
 * @example
 * ```ts
 * import { detect, EOL } from "https://deno.land/std@$STD_VERSION/fs/mod.ts";
 *
 * const CRLFinput = "deno\r\nis not\r\nnode";
 * const Mixedinput = "deno\nis not\r\nnode";
 * const LFinput = "deno\nis not\nnode";
 * const NoNLinput = "deno is not node";
 *
 * detect(LFinput); // output EOL.LF
 * detect(CRLFinput); // output EOL.CRLF
 * detect(Mixedinput); // output EOL.CRLF
 * detect(NoNLinput); // output null
 * ```
 */
export declare function detect(content: string): typeof EOL | null;
/**
 * Format the file to the targeted EOL.
 *
 * @example
 * ```ts
 * import { LF, format } from "https://deno.land/std@$STD_VERSION/fs/mod.ts";
 *
 * const CRLFinput = "deno\r\nis not\r\nnode";
 *
 * format(CRLFinput, LF); // output "deno\nis not\nnode"
 * ```
 */
export declare function format(content: string, eol: typeof EOL): string;
//# sourceMappingURL=eol.d.ts.map