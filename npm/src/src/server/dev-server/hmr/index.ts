/**
 * HMR Module
 * Main exports for Hot Module Replacement runtime generation
 */

export { generateHMRRuntimeScript } from "./runtime-generator.js";
export type { HMRRuntimeOptions } from "./runtime-generator.js";
export type {
  HMRConnectedMessage,
  HMRMessage,
  HMRMessageType,
  HMRReloadMessage,
  HMRUpdateMessage,
} from "./message-handler.js";
