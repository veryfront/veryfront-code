/**
 * SSR Browser Globals - Re-export from modular implementation
 *
 * This file maintains backward compatibility by re-exporting
 * from the new modular ssr-globals/ directory.
 *
 * @module rendering/ssr-globals
 */

export {
  createDocumentStub,
  createElementClass,
  createElementStub,
  createWindowStub,
  disableSSRClientOnlyFetching,
  disableSSRFetchInterception,
  enableSSRClientOnlyFetching,
  enableSSRFetchInterception,
  isSSRGlobalsActive,
  setSSRProjectDomain,
  setSSRServerPort,
  setupSSRGlobals,
} from "./ssr-globals/index.ts";
