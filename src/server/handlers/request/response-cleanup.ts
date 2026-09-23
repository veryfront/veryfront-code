/** Keep invocation resources alive until its response finishes or is cancelled. */
export function withResponseCleanup(
  response: Response,
  cleanup: () => void,
  signal: AbortSignal,
): Response {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    signal.removeEventListener("abort", finish);
    cleanup();
  };
  if (!response.body || signal.aborted) {
    finish();
    return response;
  }
  signal.addEventListener("abort", finish, { once: true });
  const reader = response.body.getReader();
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await reader.read();
          if (result.done) {
            finish();
            controller.close();
          } else controller.enqueue(result.value);
        } catch (error) {
          finish();
          controller.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          finish();
        }
      },
    }, { highWaterMark: 0 }),
    { status: response.status, statusText: response.statusText, headers: response.headers },
  );
}
