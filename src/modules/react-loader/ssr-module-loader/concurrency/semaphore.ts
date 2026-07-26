/**
 * Compatibility export for the explicit-permit semaphore.
 *
 * The implementation belongs to Utils so generic concurrency helpers do not
 * depend upward on the React module loader.
 */
export { PermitSemaphore as Semaphore } from "#veryfront/utils/permit-semaphore.ts";
