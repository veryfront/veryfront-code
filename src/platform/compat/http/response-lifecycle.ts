/**
 * Complete request lifecycle work when a response has actually finished.
 * Non-streaming responses complete when their headers are ready, while SSE
 * responses complete only after their body closes, errors, or is cancelled.
 */

export function isEventStreamResponse(response: Response): boolean {
  if (!response.body) return false;

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.split(";", 1)[0]?.trim() === "text/event-stream";
}

export function completeOnResponseBodySettlement(
  response: Response,
  onComplete: () => void,
): Response {
  if (!isEventStreamResponse(response)) {
    onComplete();
    return response;
  }

  let completed = false;
  const complete = (): void => {
    if (completed) return;
    completed = true;
    onComplete();
  };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body!.getReader();
  } catch (error) {
    complete();
    throw error;
  }

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          complete();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        complete();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        complete();
      }
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
