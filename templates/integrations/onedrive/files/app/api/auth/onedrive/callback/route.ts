import { createOAuthCallbackHandler, oneDriveConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

export const GET = createOAuthCallbackHandler(oneDriveConfig, { tokenStore });
