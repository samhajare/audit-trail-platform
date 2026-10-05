import { backoffMs } from './retry';

describe('backoffMs', () => {
  it('doubles each retry', () => {
    expect([1, 2, 3].map((n) => backoffMs(n, 2000))).toEqual([2000, 4000, 8000]);
  });
  it('is capped', () => expect(backoffMs(30, 2000)).toBe(300_000));
});
