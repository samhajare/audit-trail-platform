import { z } from 'zod';
import { SEVERITIES } from '@audit/contracts';

export const ListQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  eventType: z.string().max(100).optional(),
  service: z.string().max(100).optional(),
  severity: z.enum(SEVERITIES).optional(),
  actorId: z.string().max(128).optional(),
  resourceType: z.string().max(64).optional(),
  resourceId: z.string().max(128).optional(),
  action: z.string().max(100).optional(),
  ip: z.string().max(64).optional(),
  correlationId: z.string().max(128).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(300).optional(),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

export const StatsQuerySchema = z.object({ since: z.string().datetime().optional() });
export type StatsQuery = z.infer<typeof StatsQuerySchema>;

export interface AuditRow {
  id: string;
  event_id: string;
  schema_version: string;
  event_type: string;
  action: string;
  actor_id: string;
  actor_email: string | null;
  actor_role: string | null;
  resource_type: string | null;
  resource_id: string | null;
  service_name: string;
  tenant_id: string;
  severity: string;
  correlation_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  before_data: unknown;
  after_data: unknown;
  metadata: Record<string, unknown>;
  raw_payload?: unknown;
  occurred_at: Date;
  created_at: Date;
}
