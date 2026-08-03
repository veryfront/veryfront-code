import { writeStdoutAsync } from "veryfront/platform";
import { getStdinReader, type StdinReader } from "veryfront/platform";

export interface StartStdioJsonRpcOptions<TRequest, TResponse> {
  isRunning: () => boolean;
  parseRequest: (payload: unknown) => TRequest;
  handleRequest: (request: TRequest) => Promise<TResponse>;
  toParseErrorResponse: (error: unknown) => TResponse;
  toInvalidRequestResponse: (error: unknown) => TResponse;
  toErrorResponse: (error: unknown, request: TRequest) => TResponse;
}

export function startStdioJsonRpc<TRequest, TResponse>(
  options: StartStdioJsonRpcOptions<TRequest, TResponse>,
): StdinReader {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const stdinReader = getStdinReader();

  const writeResponse = async (response: TResponse): Promise<void> => {
    await writeStdoutAsync(encoder.encode(`${JSON.stringify(response)}\n`));
  };

  const readLoop = async (): Promise<void> => {
    let buffer = "";

    while (options.isRunning()) {
      try {
        const { value, done } = await stdinReader.read();
        if (done) break;
        if (!value) continue;

        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex === -1) break;

          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) continue;

          let payload: unknown;
          try {
            payload = JSON.parse(line);
          } catch (error) {
            await writeResponse(options.toParseErrorResponse(error));
            continue;
          }

          let request: TRequest;
          try {
            request = options.parseRequest(payload);
          } catch (error) {
            await writeResponse(options.toInvalidRequestResponse(error));
            continue;
          }

          try {
            const response = await options.handleRequest(request);
            await writeResponse(response);
          } catch (error) {
            await writeResponse(options.toErrorResponse(error, request));
          }
        }
      } catch {
        break;
      }
    }
  };

  void readLoop();
  return stdinReader;
}
