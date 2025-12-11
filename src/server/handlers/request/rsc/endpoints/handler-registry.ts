
import { RSCDevServerHandler } from "../handlers/index.ts";

const rscHandlersByProject = new Map<string, RSCDevServerHandler>();

export function getRSCHandler(projectDir: string): RSCDevServerHandler {
  let handler = rscHandlersByProject.get(projectDir);
  if (!handler) {
    handler = new RSCDevServerHandler(projectDir);
    rscHandlersByProject.set(projectDir, handler);
  }
  return handler;
}

export function __resetRSCHandlerForTests(): void {
  rscHandlersByProject.clear();
}
