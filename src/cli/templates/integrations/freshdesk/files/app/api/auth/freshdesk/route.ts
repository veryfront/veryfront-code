/**
 * Freshdesk OAuth Init
 */

import { freshdeskConfig, createOAuthInitHandler } from "veryfront/oauth";

export const GET = createOAuthInitHandler(freshdeskConfig);
