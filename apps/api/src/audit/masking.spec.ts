import { maskDeep } from './masking';

describe('maskDeep', () => {
  it('masks the documented examples', () => {
    expect(maskDeep({ email: 'john@gmail.com', phone: '9876543210', cardNumber: '4111111111111111' })).toEqual({
      email: 'j***@gmail.com',
      phone: '******3210',
      cardNumber: '************1111',
    });
  });
  it('recurses into nested objects and arrays, and redacts secrets', () => {
    expect(maskDeep({ a: [{ password: 'x', role: 'ADMIN' }], b: { card_number: '4111111111111111' } })).toEqual({
      a: [{ password: '********', role: 'ADMIN' }],
      b: { card_number: '************1111' },
    });
  });
  it('passes through null and primitives', () => {
    expect(maskDeep(null)).toBeNull();
    expect(maskDeep(5)).toBe(5);
  });
});
