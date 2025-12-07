/**
 * Intercom OAuth Init
 */

import { intercomConfig, createOAuthInitHandler } from "veryfront/oauth";

export const GET = createOAuthInitHandler(intercomConfig);
