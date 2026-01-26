/**
 * CORS Constants
 * Default values and constants for CORS handling
 *
 * @module core/cors/constants
 */

import { DEV_LOCALHOST_ORIGINS } from "../../../config/index.js";

export const DEFAULT_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
export const DEFAULT_HEADERS = ["Content-Type", "Authorization"];
export const DEFAULT_MAX_AGE = 86400;

export { DEV_LOCALHOST_ORIGINS };

export const HTTP_NO_CONTENT = 204;
export const HTTP_FORBIDDEN = 403;
