import "#veryfront/schemas/_test-setup.ts";
import { startStdioJsonRpc } from "../../../../cli/mcp/stdio.ts";
import {
  internalError,
  invalidRequestError,
  type JSONRPCRequest,
  JSONRPCRequestSchema,
  type JSONRPCResponse,
  parseError,
  successResponse,
} from "../../../../cli/mcp/jsonrpc.ts";

startStdioJsonRpc<JSONRPCRequest, JSONRPCResponse>({
  isRunning: () => true,
  isNotification: (request) => request.id === undefined,
  parseRequest: (payload) => JSONRPCRequestSchema.parse(payload),
  handleRequest: async (request) => {
    console.error(`handled:${request.method}`);
    if (request.method === "fail") throw new Error("fixture handler failure");
    return successResponse(request.id, { handled: request.method });
  },
  toParseErrorResponse: parseError,
  toInvalidRequestResponse: invalidRequestError,
  toErrorResponse: (_error, request) => internalError(request.id),
});
