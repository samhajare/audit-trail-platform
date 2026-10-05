import { randomUUID } from 'crypto';

export type Kind = 'login' | 'logout' | 'role-change' | 'payment' | 'config' | 'export' | 'order-flow' | 'failed';
export const KINDS: Kind[] = ['login', 'logout', 'role-change', 'payment', 'config', 'export', 'order-flow', 'failed'];

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const users = ['john', 'priya', 'amit', 'sara', 'li', 'maria'].map((n, i) => ({ id: `usr_${200 + i}`, email: `${n}@company.com` }));
const admin = { id: 'usr_101', email: 'admin@company.com', role: 'ADMIN' };
const ips = ['10.10.2.14', '10.20.12.54', '10.10.0.18', '172.16.4.9'];
const agents = ['Chrome', 'Firefox', 'Safari', 'Edge'];
const now = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const id = (p: string) => `${p}_${randomUUID()}`;

function make(tenantId: string, over: Record<string, any>) {
  return {
    schemaVersion: '1.0',
    eventId: id('evt'),
    timestamp: now(),
    action: 'UNKNOWN',
    context: { ipAddress: pick(ips), userAgent: pick(agents), service: 'user-service', correlationId: id('req') },
    ...over,
    metadata: { tenantId, ...(over.metadata ?? {}) },
  };
}

export function build(kind: Kind, tenantId: string): any[] {
  const u = pick(users);
  switch (kind) {
    case 'login':
      return [make(tenantId, { eventType: 'USER_LOGIN', action: 'LOGIN', actor: u, resource: { type: 'SESSION', id: id('ses') } })];
    case 'logout':
      return [make(tenantId, { eventType: 'USER_LOGOUT', action: 'LOGOUT', actor: u })];
    case 'role-change': {
      const target = pick(users);
      const [before, after] = pick([['USER', 'MANAGER'], ['USER', 'ADMIN'], ['MANAGER', 'USER']]);
      return [make(tenantId, {
        eventType: 'USER_ROLE_CHANGED', action: 'UPDATE_ROLE', actor: admin,
        resource: { type: 'USER', id: target.id },
        changes: { before: { role: before }, after: { role: after } },
      })];
    }
    case 'payment':
      return [make(tenantId, {
        eventType: 'PAYMENT_REFUNDED', action: 'REFUND', actor: pick([admin, u]),
        resource: { type: 'PAYMENT', id: id('pay') },
        changes: { before: { status: 'CAPTURED' }, after: { status: 'REFUNDED', cardNumber: '4111111111111111', email: u.email } },
        context: { service: 'payment-service', ipAddress: pick(ips), userAgent: pick(agents), correlationId: id('req') },
      })];
    case 'config':
      return [make(tenantId, {
        eventType: 'CONFIG_CHANGED', action: 'UPDATE_CONFIG', actor: admin,
        resource: { type: 'CONFIG', id: 'session.timeout' },
        changes: { before: { value: 30 }, after: { value: 60 } },
        context: { service: 'configuration-service', ipAddress: pick(ips), userAgent: 'Chrome', correlationId: id('req') },
      })];
    case 'export':
      return [make(tenantId, {
        eventType: 'DATA_EXPORTED', action: 'EXPORT', actor: admin,
        resource: { type: 'REPORT', id: id('rpt') },
        context: { service: 'admin-service', ipAddress: pick(ips), userAgent: 'Chrome', correlationId: id('req') },
      })];
    case 'order-flow': {
      // one distributed operation -> one correlationId (feeds the timeline screen)
      const corr = id('req');
      const steps: [string, string, string][] = [
        ['USER_LOGIN', 'LOGIN', 'user-service'], ['ORDER_CREATED', 'CREATE_ORDER', 'order-service'],
        ['INVENTORY_RESERVED', 'RESERVE_STOCK', 'inventory-service'], ['PAYMENT_PROCESSED', 'CHARGE', 'payment-service'],
        ['ORDER_CONFIRMED', 'CONFIRM_ORDER', 'order-service'], ['NOTIFICATION_SENT', 'SEND_EMAIL', 'notification-service'],
      ];
      const order = id('ord');
      return steps.map(([eventType, action, service], i) => make(tenantId, {
        eventType, action, actor: u, timestamp: now(i * 900),
        resource: { type: eventType === 'USER_LOGIN' ? 'SESSION' : 'ORDER', id: order },
        context: { service, ipAddress: pick(ips), userAgent: 'Chrome', correlationId: corr },
      }));
    }
    case 'failed':
      // consumer fails this on purpose -> retry topic (x3) -> DLQ -> Failed Events screen
      return [make(tenantId, {
        eventType: 'USER_ROLE_CHANGED', action: 'UPDATE_ROLE', actor: admin,
        resource: { type: 'USER', id: pick(users).id },
        changes: { before: { role: 'USER' }, after: { role: 'ADMIN' } },
        metadata: { _simulateFailure: true },
      })];
  }
}

export function bulk(count: number, tenantId: string): any[] {
  const weighted: Kind[] = ['login', 'login', 'login', 'logout', 'logout', 'role-change', 'payment', 'config', 'export'];
  return Array.from({ length: count }, () => build(pick(weighted), tenantId)[0]);
}
