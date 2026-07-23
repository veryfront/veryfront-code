/** Internal storage for the process-wide extension contract registry. */

const contracts = new Map<string, unknown>();
let lifecycleOwner: object | undefined;

export function getRegisteredContract(name: string): unknown {
  return contracts.get(name);
}

export function hasRegisteredContract(name: string): boolean {
  return contracts.has(name);
}

export function getRegisteredContractCount(): number {
  return contracts.size;
}

export function setRegisteredContract(name: string, implementation: unknown): void {
  contracts.set(name, implementation);
}

export function deleteRegisteredContract(name: string): void {
  contracts.delete(name);
}

export function clearRegisteredContracts(): void {
  contracts.clear();
  lifecycleOwner = undefined;
}

export function claimContractRegistryLifecycle(owner: object): boolean {
  if (lifecycleOwner !== undefined && lifecycleOwner !== owner) return false;
  lifecycleOwner = owner;
  return true;
}

export function getContractRegistryLifecycleOwner(): object | undefined {
  return lifecycleOwner;
}

export function releaseContractRegistryLifecycle(owner: object): void {
  if (lifecycleOwner === owner) lifecycleOwner = undefined;
}

export function snapshotContracts(): Map<string, unknown> {
  return new Map(contracts);
}

export function restoreContracts(snapshot: ReadonlyMap<string, unknown>): void {
  contracts.clear();
  for (const [name, implementation] of snapshot) contracts.set(name, implementation);
}
