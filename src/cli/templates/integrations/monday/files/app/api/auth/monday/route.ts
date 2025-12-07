/**
 * Monday.com OAuth Init
 */

import { mondayConfig, createOAuthInitHandler } from "veryfront/oauth";

export const GET = createOAuthInitHandler(mondayConfig);
