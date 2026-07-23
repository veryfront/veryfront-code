const PHP_PROBE_PATTERN = /(?:^|\/)[^/?#]*\.php$/i;

const SCANNER_PROBE_SEGMENTS = new Set([
  "autoload_classmap.php",
  "dropdown.php",
  "edit.php",
  "h.php",
  "shell20211028.php",
  "wp-admin",
  "wp.php",
  "x.php",
  "zwso.php",
]);

/** Return whether a path matches a common automated vulnerability probe. */
export function isLikelyScannerProbePath(pathname: string): boolean {
  const normalized = pathname.replace(/^\/+/, "/").toLowerCase();
  if (PHP_PROBE_PATTERN.test(normalized)) return true;

  return normalized
    .split("/")
    .filter(Boolean)
    .some((segment) => SCANNER_PROBE_SEGMENTS.has(segment));
}

/** Log levels used for completed proxy requests that did not succeed. */
export type ProxyFailureLogLevel = "info" | "warn" | "error";

/** Select a failure log level while reducing noise from expected scanner probes. */
export function getProxyFailureLogLevel(
  status: number,
  method: string,
  pathname: string,
): ProxyFailureLogLevel {
  if (
    status === 502 &&
    ["GET", "HEAD"].includes(method.toUpperCase()) &&
    isLikelyScannerProbePath(pathname)
  ) {
    return "warn";
  }

  if (status < 400) return "info";
  return status < 500 ? "warn" : "error";
}
