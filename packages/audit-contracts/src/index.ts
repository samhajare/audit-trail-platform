import { z } from 'zod';

/* ───────── Kafka topology ───────── */
export const TOPICS = {
  EVENTS: 'audit.events',
  RETRY: 'audit.events.retry',
  DLQ: 'audit.events.dlq',
} as const;

export const HEADERS = {
  RETRY_COUNT: 'retry-count',
  NEXT_ATTEMPT_AT: 'next-attempt-at',
  ERROR: 'error',
  ORIGINAL_TOPIC: 'original-topic',
  REPLAYED: 'replayed',
} as const;

/* ───────── RBAC ───────── */
export const PERMISSIONS = {
  READ: 'audit:read',
  EXPORT: 'audit:export',
  VIEW_SENSITIVE: 'audit:view-sensitive',
  REPLAY: 'audit:replay',
  MANAGE: 'audit:manage',
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  AUDIT_VIEWER: ['audit:read'],
  AUDIT_ANALYST: ['audit:read', 'audit:export', 'audit:view-sensitive'],
  AUDIT_ADMIN: ['audit:read', 'audit:export', 'audit:view-sensitive', 'audit:replay', 'audit:manage'],
};

/* ───────── Feature flags (LaunchDarkly keys) ───────── */
export const FLAGS = {
  LIVE_STREAM: 'audit-live-stream',
  DATA_EXPORT: 'audit-data-export',
  NEW_SEARCH: 'audit-new-search',
  SENSITIVE_VIEW: 'audit-sensitive-data-view',
  DLQ_REPLAY: 'audit-dlq-replay',
} as const;
export type FlagKey = (typeof FLAGS)[keyof typeof FLAGS];

/* ───────── Severity ───────── */
export const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];

const SEVERITY_BY_TYPE: Record<string, Severity> = {
  USER_LOGIN: 'INFO',
  USER_LOGOUT: 'INFO',
  DATA_EXPORTED: 'MEDIUM',
  CONFIG_CHANGED: 'MEDIUM',
  FEATURE_TOGGLED: 'MEDIUM',
  ORDER_CREATED: 'INFO',
  ORDER_CONFIRMED: 'INFO',
  INVENTORY_RESERVED: 'INFO',
  PAYMENT_PROCESSED: 'LOW',
  NOTIFICATION_SENT: 'INFO',
  USER_ROLE_CHANGED: 'HIGH',
  ACCOUNT_DISABLED: 'HIGH',
  PAYMENT_REFUNDED: 'HIGH',
  SENSITIVE_SETTING_CHANGED: 'CRITICAL',
};
export const deriveSeverity = (eventType: string): Severity => SEVERITY_BY_TYPE[eventType] ?? 'LOW';

/* ───────── Event schema v1.0 ───────── */
const AuditEventV1 = z.object({
  schemaVersion: z.literal('1.0'),
  eventId: z.string().min(1).max(128),
  eventType: z.string().min(1).max(100),
  timestamp: z.string().datetime(),
  actor: z.object({
    id: z.string().min(1).max(128),
    email: z.string().max(255).optional(),
    role: z.string().max(64).optional(),
  }),
  resource: z.object({ type: z.string().min(1).max(64), id: z.string().min(1).max(128) }).optional(),
  action: z.string().min(1).max(100),
  severity: z.enum(SEVERITIES).optional(),
  changes: z
    .object({
      before: z.record(z.unknown()).optional(),
      after: z.record(z.unknown()).optional(),
    })
    .optional(),
  context: z.object({
    service: z.string().min(1).max(100),
    ipAddress: z.string().max(64).optional(),
    userAgent: z.string().max(512).optional(),
    correlationId: z.string().max(128).optional(),
  }),
  metadata: z.object({ tenantId: z.string().min(1).max(100) }).passthrough(),
});
export type AuditEventV1 = z.infer<typeof AuditEventV1>;

/** Version-independent shape the rest of the system works with. */
export interface NormalizedAuditEvent {
  eventId: string;
  schemaVersion: string;
  eventType: string;
  action: string;
  occurredAt: string; // ISO, ms precision
  actorId: string;
  actorEmail: string | null;
  actorRole: string | null;
  resourceType: string | null;
  resourceId: string | null;
  serviceName: string;
  tenantId: string;
  severity: Severity;
  correlationId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  rawPayload: unknown;
}

export class EventValidationError extends Error {
  constructor(message: string, public readonly issues?: unknown) {
    super(message);
    this.name = 'EventValidationError';
  }
}

function fromV1(e: AuditEventV1, raw: unknown): NormalizedAuditEvent {
  return {
    eventId: e.eventId,
    schemaVersion: e.schemaVersion,
    eventType: e.eventType,
    action: e.action,
    occurredAt: new Date(e.timestamp).toISOString(),
    actorId: e.actor.id,
    actorEmail: e.actor.email ?? null,
    actorRole: e.actor.role ?? null,
    resourceType: e.resource?.type ?? null,
    resourceId: e.resource?.id ?? null,
    serviceName: e.context.service,
    tenantId: e.metadata.tenantId,
    severity: e.severity ?? deriveSeverity(e.eventType),
    correlationId: e.context.correlationId ?? null,
    ipAddress: e.context.ipAddress ?? null,
    userAgent: e.context.userAgent ?? null,
    beforeData: e.changes?.before ?? null,
    afterData: e.changes?.after ?? null,
    metadata: e.metadata,
    rawPayload: raw,
  };
}

/**
 * Schema-version dispatcher. Add a `case '2.0'` here (with its own zod schema + mapper)
 * and old producers keep working until they are upgraded.
 */
export function normalizeEvent(raw: unknown): NormalizedAuditEvent {
  const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  switch (version) {
    case '1.0': {
      const parsed = AuditEventV1.safeParse(raw);
      if (!parsed.success) throw new EventValidationError('Invalid audit event (v1.0)', parsed.error.issues);
      return fromV1(parsed.data, raw);
    }
    default:
      throw new EventValidationError(`Unsupported schemaVersion: ${String(version)}`);
  }
}
