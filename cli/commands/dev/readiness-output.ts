interface DevConnectionDisplay {
  apiUrl: string;
  project: string;
  environment: string;
  signedIn?: string;
  studioUrl: string;
}

export function veryfrontServiceName(apiUrl: string): string {
  const hostname = new URL(apiUrl).hostname;
  return hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" || hostname === "[::1]"
    ? "Local Veryfront"
    : "Veryfront Cloud";
}

/** Plain lines keep terminal readiness readable with or without ANSI support. */
export function devReadinessLines(options: {
  appUrl: string;
  connection?: DevConnectionDisplay;
  /** A linked project started local-only (`--no-sync`); it is still linked. */
  localOnlyProject?: string;
}): string[] {
  const lines = [`  ✓ App ready       ${options.appUrl}`];
  const connection = options.connection;
  if (connection) {
    lines.push(
      `  ✓ Connected       ${veryfrontServiceName(connection.apiUrl)} · ${connection.apiUrl}`,
      "",
      `    Project         ${connection.project}`,
      `    Environment     ${connection.environment} (shared)`,
      "    Execution       This machine",
    );
    if (connection.signedIn) lines.push(`    Signed in       ${connection.signedIn}`);
    lines.push(`    Studio          ${connection.studioUrl}`);
  } else if (options.localOnlyProject) {
    lines.push(
      "    Execution       This machine",
      `    Veryfront       Linked to ${options.localOnlyProject}, source sync off. Restart without --no-sync and with VERYFRONT_DEV_NO_SYNC unset to connect.`,
    );
  } else {
    lines.push(
      "    Execution       This machine",
      '    Veryfront       Not linked. For gateway inference and Studio runs, restart veryfront dev and answer Yes to "Use Veryfront Cloud?". Linked dev syncs your source to a Cloud preview.',
    );
  }
  return lines;
}
