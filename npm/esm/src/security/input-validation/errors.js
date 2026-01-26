export class ValidationError extends Error {
    details;
    constructor(message, details) {
        super(message);
        this.name = "ValidationError";
        this.details = details;
    }
}
