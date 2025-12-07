/**
 * Pipedrive OAuth Init
 */

import { pipedriveConfig, createOAuthInitHandler } from "veryfront/oauth";

export const GET = createOAuthInitHandler(pipedriveConfig);
