/** Exponential backoff: retry #1 = base, #2 = 2*base, #3 = 4*base ... capped at 5 minutes. */
export const backoffMs = (retryNumber: number, baseMs: number): number =>
  Math.min(baseMs * 2 ** Math.max(0, retryNumber - 1), 5 * 60_000);
