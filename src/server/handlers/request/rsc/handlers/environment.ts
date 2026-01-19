import { getEnvironment } from "#veryfront/build/config/environment.ts";

export function isProductionMode(): boolean {
  return getEnvironment() === "production";
}
