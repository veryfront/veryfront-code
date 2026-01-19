import { getEnv } from "../platform/compat/process.ts";

const DEFAULT_SCALE = 1;

function readScale(): number {
  const raw = getEnv("VF_TEST_TIME_SCALE");
  if (!raw) return DEFAULT_SCALE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SCALE;
  return parsed;
}

export function getTestTimeScale(): number {
  return readScale();
}

export function scaleMs(ms: number, minMs = 1): number {
  const scaled = Math.round(ms * readScale());
  if (scaled < minMs) return minMs;
  return scaled;
}

export function testDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, scaleMs(ms)));
}
