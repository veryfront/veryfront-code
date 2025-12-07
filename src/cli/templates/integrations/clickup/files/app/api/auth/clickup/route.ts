/**
 * ClickUp OAuth Init
 */

import { clickupConfig, createOAuthInitHandler } from "veryfront/oauth";

export const GET = createOAuthInitHandler(clickupConfig);
