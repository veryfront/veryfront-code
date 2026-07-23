/** Map a legacy free-form Error message to a compatibility solution key. */
export function identifyError(error: Error): string {
  let message: string;
  try {
    message = typeof error.message === "string" ? error.message.slice(0, 16_384).toLowerCase() : "";
  } catch {
    return "unknown";
  }

  if (message.includes("veryfront.config") && message.includes("not found")) {
    return "missing-config";
  }

  if (message.includes("config") && (message.includes("invalid") || message.includes("parse"))) {
    return "invalid-config";
  }

  if (message.includes("route") && (message.includes("invalid") || message.includes("export"))) {
    return "invalid-route";
  }

  if (message.includes("client") && (message.includes("boundary") || message.includes("server"))) {
    return "client-boundary";
  }

  if (
    message.includes("import") ||
    message.includes("module not found") ||
    message.includes("resolve")
  ) {
    return "import-not-found";
  }

  if (message.includes("port") && (message.includes("in use") || message.includes("eaddrinuse"))) {
    return "port-in-use";
  }

  if (message.includes("build") && message.includes("fail")) {
    return "build-failed";
  }

  if (message.includes("react") && message.includes("not found")) {
    return "missing-deps";
  }

  return "unknown";
}
