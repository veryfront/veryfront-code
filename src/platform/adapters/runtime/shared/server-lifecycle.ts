import type { ServeOptions, Server } from "../../base.ts";

type RequestHandler = (request: Request) => Promise<Response> | Response;
type ServerFactory = (handler: RequestHandler, options: ServeOptions) => Promise<Server>;
type ServerSetter = (server: Server) => void;

export function createServeHandler(createServer: ServerFactory, setActive: ServerSetter) {
  return (
    handler: RequestHandler,
    options: ServeOptions = {},
  ): Promise<Server> => {
    return startManagedServer(createServer, handler, options, setActive);
  };
}

async function startManagedServer(
  createServer: ServerFactory,
  handler: RequestHandler,
  options: ServeOptions,
  setActive: (server: Server) => void,
): Promise<Server> {
  const server = await createServer(handler, options);
  setActive(server);
  return server;
}

export async function stopManagedServer<T extends Server>(server: T | null): Promise<T | null> {
  if (!server) return null;
  await server.stop();
  return null;
}
