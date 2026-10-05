import { maskDeep } from './masking';
import type { AuditRow } from './audit.types';

export interface DtoOptions {
  /** caller holds audit:view-sensitive (and the flag is on) */
  sensitive: boolean;
}

export function toDto(row: AuditRow, { sensitive }: DtoOptions) {
  const view = (v: unknown) => (sensitive ? v : maskDeep(v));
  return {
    id: row.id,
    eventId: row.event_id,
    schemaVersion: row.schema_version,
    eventType: row.event_type,
    action: row.action,
    severity: row.severity,
    occurredAt: row.occurred_at.toISOString(),
    ingestedAt: row.created_at.toISOString(),
    actor: { id: row.actor_id, email: row.actor_email, role: row.actor_role },
    resource: row.resource_type ? { type: row.resource_type, id: row.resource_id } : null,
    service: row.service_name,
    tenantId: row.tenant_id,
    correlationId: row.correlation_id,
    context: { ipAddress: row.ip_address, userAgent: row.user_agent },
    changes: { before: view(row.before_data), after: view(row.after_data) },
    metadata: view(row.metadata),
    // the untouched payload is only ever returned to callers allowed to see sensitive data
    ...(sensitive && row.raw_payload !== undefined ? { rawPayload: row.raw_payload } : {}),
  };
}
