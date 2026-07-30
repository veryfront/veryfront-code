import { scaleDuration } from "../time-scale.ts";

/** Resolve after the scaled duration using the host timer contract. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, scaleDuration(ms)));
}
