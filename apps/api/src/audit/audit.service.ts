import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { AuditRow, ListQuery } from './audit.types';

const LIST_COLS = `id, event_id, schema_version, event_type, action, actor_id, actor_email, actor_role,
  resource_type, resource_id, service_name, tenant_id, severity, correlation_id, ip_address, user_agent,
  before_data, after_data, metadata, occurred_at, created_at`;

interface Cursor { t: string; id: string }

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const encodeCursor = (row: Pick<AuditRow, 'occurred_at' | 'id'>) =>
  Buffer.from(JSON.stringify({ t: row.occurred_at.toISOString(), id: row.id })).toString('base64url');

function decodeCursor(raw: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof c.t === 'string' && typeof c.id === 'string' && !Number.isNaN(Date.parse(c.t))) return c;
  } catch { /* fallthrough */ }
  throw new BadRequestException('Invalid cursor');
}

@Injectable()
export class AuditService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Tenant isolation lives HERE: tenant_id is always the first predicate, taken from the verified token. */
  private buildWhere(tenantId: string, f: Partial<ListQuery>, cursor?: Cursor) {
    const params: unknown[] = [tenantId];
    const where = ['tenant_id = $1'];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('$?', `$${params.length}`));
    };
    if (f.eventType) add('event_type = $?', f.eventType);
    if (f.service) add('service_name = $?', f.service);
    if (f.severity) add('severity = $?', f.severity);
    if (f.actorId) add('actor_id = $?', f.actorId);
    if (f.resourceType) add('resource_type = $?', f.resourceType);
    if (f.resourceId) add('resource_id = $?', f.resourceId);
    if (f.action) add('action = $?', f.action);
    if (f.ip) add('ip_address = $?', f.ip);
    if (f.correlationId) add('correlation_id = $?', f.correlationId);
    if (f.from) add('occurred_at >= $?', f.from);
    if (f.to) add('occurred_at <= $?', f.to);
    if (f.q) {
      params.push(`%${escapeLike(f.q)}%`);
      const n = `$${params.length}`;
      where.push(
        `(actor_email ILIKE ${n} OR event_type ILIKE ${n} OR resource_id ILIKE ${n} OR event_id ILIKE ${n} OR correlation_id ILIKE ${n})`,
      );
    }
    if (cursor) {
      params.push(cursor.t, cursor.id);
      where.push(`(occurred_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    return { sql: where.join(' AND '), params };
  }

  async list(tenantId: string, q: ListQuery) {
    const cursor = q.cursor ? decodeCursor(q.cursor) : undefined;
    const { sql, params } = this.buildWhere(tenantId, q, cursor);
    params.push(q.limit + 1);
    const { rows } = await this.pool.query<AuditRow>(
      `SELECT ${LIST_COLS} FROM audit_events WHERE ${sql} ORDER BY occurred_at DESC, id DESC LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null };
  }

  async getById(tenantId: string, id: string): Promise<AuditRow> {
    // a row from another tenant is indistinguishable from a missing one
    const { rows } = await this.pool.query<AuditRow>(
      `SELECT ${LIST_COLS}, raw_payload FROM audit_events WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (!rows[0]) throw new NotFoundException('Audit event not found');
    return rows[0];
  }

  async timeline(tenantId: string, correlationId: string): Promise<AuditRow[]> {
    const { rows } = await this.pool.query<AuditRow>(
      `SELECT ${LIST_COLS} FROM audit_events
       WHERE tenant_id = $1 AND correlation_id = $2
       ORDER BY occurred_at ASC, id ASC LIMIT 500`,
      [tenantId, correlationId],
    );
    return rows;
  }

  async statistics(tenantId: string, sinceIso?: string) {
    const since = sinceIso ?? new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
    const [totals, bySeverity, byService, hourly] = await Promise.all([
      this.pool.query(
        `SELECT count(*)::int AS events,
                count(*) FILTER (WHERE severity IN ('HIGH','CRITICAL'))::int AS critical,
                count(DISTINCT actor_id)::int AS active_users
         FROM audit_events WHERE tenant_id = $1 AND occurred_at >= $2`,
        [tenantId, since],
      ),
      this.pool.query(
        `SELECT severity, count(*)::int AS count FROM audit_events
         WHERE tenant_id = $1 AND occurred_at >= $2 GROUP BY severity`,
        [tenantId, since],
      ),
      this.pool.query(
        `SELECT service_name AS service, count(*)::int AS count FROM audit_events
         WHERE tenant_id = $1 AND occurred_at >= $2 GROUP BY service_name ORDER BY count DESC LIMIT 10`,
        [tenantId, since],
      ),
      this.pool.query(
        `SELECT date_trunc('hour', occurred_at) AS hour, count(*)::int AS count FROM audit_events
         WHERE tenant_id = $1 AND occurred_at >= now() - interval '24 hours' GROUP BY 1 ORDER BY 1`,
        [tenantId],
      ),
    ]);
    const t = totals.rows[0];
    return {
      since,
      eventsToday: t.events as number,
      criticalEvents: t.critical as number,
      activeUsers: t.active_users as number,
      bySeverity: bySeverity.rows as { severity: string; count: number }[],
      byService: byService.rows as { service: string; count: number }[],
      hourly: hourly.rows.map((r) => ({ hour: (r.hour as Date).toISOString(), count: r.count as number })),
    };
  }

  async filterOptions(tenantId: string) {
    const distinct = async (col: 'event_type' | 'service_name' | 'action') =>
      (
        await this.pool.query(
          `SELECT DISTINCT ${col} AS v FROM audit_events WHERE tenant_id = $1 ORDER BY 1 LIMIT 200`,
          [tenantId],
        )
      ).rows.map((r) => r.v as string);
    const [eventTypes, services, actions] = await Promise.all([
      distinct('event_type'),
      distinct('service_name'),
      distinct('action'),
    ]);
    return { eventTypes, services, actions };
  }

  /** Keyset-paginated iteration for exports (bounded memory). */
  async *iterate(tenantId: string, q: ListQuery, maxRows: number, batch = 1000): AsyncGenerator<AuditRow> {
    let cursor: Cursor | undefined = q.cursor ? decodeCursor(q.cursor) : undefined;
    let sent = 0;
    while (sent < maxRows) {
      const { sql, params } = this.buildWhere(tenantId, q, cursor);
      params.push(Math.min(batch, maxRows - sent));
      const { rows } = await this.pool.query<AuditRow>(
        `SELECT ${LIST_COLS} FROM audit_events WHERE ${sql} ORDER BY occurred_at DESC, id DESC LIMIT $${params.length}`,
        params,
      );
      if (!rows.length) return;
      for (const r of rows) yield r;
      sent += rows.length;
      const last = rows[rows.length - 1];
      cursor = { t: last.occurred_at.toISOString(), id: last.id };
      if (rows.length < batch) return;
    }
  }
}
