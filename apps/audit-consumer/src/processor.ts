import { EventValidationError, normalizeEvent } from '@audit/contracts';
import { config } from './config';
import { insertEvent } from './db';

/** Errors that will never succeed on retry -> straight to the DLQ. */
export const isPermanent = (e: unknown) => e instanceof SyntaxError || e instanceof EventValidationError;

export class SimulatedFailure extends Error {
  constructor() { super('Simulated processing failure (database unavailable)'); this.name = 'SimulatedFailure'; }
}

export async function processEvent(raw: string): Promise<'inserted' | 'duplicate'> {
  const parsed = JSON.parse(raw);                 // SyntaxError -> permanent
  const event = normalizeEvent(parsed);           // EventValidationError -> permanent
  if (config.ALLOW_SIMULATED_FAILURES && (event.metadata as { _simulateFailure?: unknown })._simulateFailure === true) {
    throw new SimulatedFailure();                 // transient -> retry topic -> DLQ
  }
  return insertEvent(event);
}
