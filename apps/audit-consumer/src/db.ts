import { Pool } from 'pg';
import type { NormalizedAuditEvent } from '@audit/contracts';
import { config } from './config';

export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 10 });

/**
 * Idempotent insert. `ON CONFLICT (event_id) DO NOTHING` makes redelivery / replay harmless.
 * pg_notify runs in the same statement, and only for rows that were actually inserted,
 * so the API's live stream never emits duplicates or events that weren't stored.
 */
const INSERT_SQL = `
WITH ins AS (
  INSERT INTO audit_events (
    event_id, schema_version, event_type, action, actor_id, actor_email, actor_role,
    resource_type, resource_id, service_name, tenant_id, severity, correlation_id,
    ip_address, user_agent, before_data, after_data, metadata, raw_payload, occurred_at
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING id, event_id, event_type, action, severity, tenant_id, service_name, actor_email, correlation_id, occurred_at
)
SELECT pg_notify('audit_events', row_to_json(ins)::text) FROM ins`;

const json = (v: unknown) => (v == null ? null : JSON.stringify(v));

export async function insertEvent(e: NormalizedAuditEvent): Promise<'inserted' | 'duplicate'> {
  const r = await pool.query(INSERT_SQL, [
    e.eventId, e.schemaVersion, e.eventType, e.action, e.actorId, e.actorEmail, e.actorRole,
    e.resourceType, e.resourceId, e.serviceName, e.tenantId, e.severity, e.correlationId,
    e.ipAddress, e.userAgent, json(e.beforeData), json(e.afterData), JSON.stringify(e.metadata),
    JSON.stringify(e.rawPayload), e.occurredAt,
  ]);
  return r.rowCount ? 'inserted' : 'duplicate';
}

export async function recordFailedEvent(f: {
  eventId: string | null; eventType: string | null; tenantId: string | null;
  payload: string; error: string; retryCount: number; partition: number; offset: string;
}) {
  await pool.query(
    `INSERT INTO failed_events (event_id, event_type, tenant_id, payload, error, retry_count, dlq_partition, dlq_offset)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (dlq_partition, dlq_offset) DO NOTHING`,
    [f.eventId, f.eventType, f.tenantId, f.payload, f.error, f.retryCount, f.partition, f.offset],
  );
}
