/**
 * Veryfront API Client Types
 *
 * Re-exports types from schemas.ts and defines config/error types.
 */
export class VeryfrontAPIError extends Error {
    status;
    details;
    constructor(message, status, details) {
        super(message);
        this.name = "VeryfrontAPIError";
        this.status = status;
        this.details = details;
    }
}
