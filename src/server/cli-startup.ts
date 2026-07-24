/**
 * Private startup port for the Veryfront CLI.
 *
 * This module is available through an internal import-map alias only. It is
 * intentionally absent from `veryfront/server` and the package export map so
 * application callers cannot request the local proxy trust exemption.
 *
 * @internal
 */

export {
  startLocalCliProxyProductionServer,
  type StartProductionServerOptions,
} from "./production-server.ts";
