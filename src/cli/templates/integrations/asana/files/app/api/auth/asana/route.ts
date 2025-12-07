/**
 * Asana OAuth Init
 */

import { asanaConfig, createOAuthInitHandler } from "veryfront/oauth";

export const GET = createOAuthInitHandler(asanaConfig);
