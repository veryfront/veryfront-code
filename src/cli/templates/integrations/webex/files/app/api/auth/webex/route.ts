/**
 * Webex OAuth Init
 */

import { createOAuthInitHandler, webexConfig } from "veryfront/oauth";

export const GET = createOAuthInitHandler(webexConfig);
