const DEFAULT_CHILD_RUN_EVENT_WRITER_TOKEN_TIMEOUT_MS = 10_000;
const CHILD_RUN_EVENT_WRITER_TOKEN_SETUP_ERROR =
  "Unable to initialize durable child event persistence";

type Fetch = typeof globalThis.fetch;

/** Internal failure raised when the control plane cannot issue an exact-child writer token. */
export class HostedChildRunEventWriterTokenExchangeError extends Error {
  constructor() {
    super(CHILD_RUN_EVENT_WRITER_TOKEN_SETUP_ERROR);
    this.name = "HostedChildRunEventWriterTokenExchangeError";
  }
}

/** Internal input for exchanging an active parent writer token for an exact-child token. */
export interface ExchangeHostedChildRunEventWriterTokenInput {
  apiUrl: string;
  parentRunId: string;
  childRunId: string;
  runEventAppendToken: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  fetch?: Fetch;
}

function isNoStoreResponse(response: Response): boolean {
  return response.headers.get("Cache-Control")?.split(",").some((directive) =>
    directive.trim().toLowerCase() === "no-store"
  ) ?? false;
}

function parseRunEventToken(value: unknown): string {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(value, "run_event_token")
  ) {
    throw new HostedChildRunEventWriterTokenExchangeError();
  }

  const token = (value as { run_event_token?: unknown }).run_event_token;
  if (typeof token !== "string" || token.length === 0 || token.trim() !== token) {
    throw new HostedChildRunEventWriterTokenExchangeError();
  }

  return token;
}

/** Exchange a verified active-parent credential for an exact-child event writer credential. */
export async function exchangeHostedChildRunEventWriterToken(
  input: ExchangeHostedChildRunEventWriterTokenInput,
): Promise<string> {
  const timeoutSignal = AbortSignal.timeout(
    input.timeoutMs ?? DEFAULT_CHILD_RUN_EVENT_WRITER_TOKEN_TIMEOUT_MS,
  );
  const signal = input.abortSignal
    ? AbortSignal.any([input.abortSignal, timeoutSignal])
    : timeoutSignal;
  const fetch = input.fetch ?? globalThis.fetch;
  const url = new URL(
    `/runs/${encodeURIComponent(input.parentRunId)}/children/${
      encodeURIComponent(input.childRunId)
    }/event-writer-token`,
    input.apiUrl,
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.runEventAppendToken}`,
        "Cache-Control": "no-store",
      },
      cache: "no-store",
      signal,
    });

    if (!response.ok || !isNoStoreResponse(response)) {
      throw new HostedChildRunEventWriterTokenExchangeError();
    }

    return parseRunEventToken(await response.json());
  } catch (error) {
    if (error instanceof HostedChildRunEventWriterTokenExchangeError) {
      throw error;
    }
    throw new HostedChildRunEventWriterTokenExchangeError();
  }
}
