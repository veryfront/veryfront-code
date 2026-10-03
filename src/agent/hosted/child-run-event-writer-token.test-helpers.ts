/** The target `RunEventToken` body for the child run named by a `POST /runs/{run_id}/event-tokens` request. */
export function runEventTokenResponse(input: string | URL | Request, token: string): Response {
  const url = new URL(input instanceof Request ? input.url : input);
  const runId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
  return Response.json(
    {
      token,
      token_type: "Bearer",
      expires_at: "2026-10-03T03:00:00.000Z",
      run_id: runId,
      permissions: ["run.events.append"],
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
