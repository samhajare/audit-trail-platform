import { normalizeEvent, EventValidationError, deriveSeverity } from './index';

const valid = {
  schemaVersion: '1.0',
  eventId: 'evt_1',
  eventType: 'USER_ROLE_CHANGED',
  timestamp: '2026-09-30T10:42:12Z',
  actor: { id: 'usr_101', email: 'admin@company.com', role: 'ADMIN' },
  resource: { type: 'USER', id: 'usr_948' },
  action: 'UPDATE_ROLE',
  changes: { before: { role: 'USER' }, after: { role: 'MANAGER' } },
  context: { ipAddress: '10.10.2.14', userAgent: 'Chrome', service: 'user-service', correlationId: 'req_1' },
  metadata: { tenantId: 'company_123' },
};

describe('normalizeEvent', () => {
  it('normalizes a valid v1.0 event and derives severity', () => {
    const n = normalizeEvent(valid);
    expect(n.tenantId).toBe('company_123');
    expect(n.severity).toBe('HIGH');
    expect(n.beforeData).toEqual({ role: 'USER' });
    expect(n.occurredAt).toBe('2026-09-30T10:42:12.000Z');
  });
  it('rejects unknown schema versions', () => {
    expect(() => normalizeEvent({ ...valid, schemaVersion: '9.9' })).toThrow(EventValidationError);
  });
  it('rejects events without tenantId', () => {
    expect(() => normalizeEvent({ ...valid, metadata: {} })).toThrow(EventValidationError);
  });
  it('defaults unknown types to LOW', () => expect(deriveSeverity('WHATEVER')).toBe('LOW'));
});
