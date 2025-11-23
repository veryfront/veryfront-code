// Optional RSC Server Action guard. Apps can override by shadowing this module with an import map.
// Return true to allow, false to reject with 403.
export function rscActionGuard(_req: Request, _info: { id: string; args: unknown[] }): boolean {
  return true;
}
