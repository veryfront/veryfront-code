export function identifyError(error: Error): string {
  const message = error.message.toLowerCase();

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
    message.includes("import") || message.includes("module not found") ||
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
