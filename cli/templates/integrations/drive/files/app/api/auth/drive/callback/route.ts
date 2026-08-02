import { createOAuthCallbackHandler, driveConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(driveConfig, { tokenStore });
