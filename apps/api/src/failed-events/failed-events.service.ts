import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Pool } from 'pg';
import { HEADERS, TOPICS } from '@audit/contracts';
import { PG_POOL } from '../db/db.module';
import { KafkaProducerService } from '../kafka/producer.service';
import type { AuthUser } from '../auth/auth.types';

interface FailedRow {
  id: string; event_id: string | null; event_type: string | null; tenant_id: string;
  payload: string; error: string; retry_count: number; status: string;
  failed_at: Date; replayed_at: Date | null; replayed_by: string | null;
}

const dto = (r: FailedRow) => ({
  id: r.id,
  eventId: r.event_id,
  eventType: r.event_type,
  error: r.error,
  retryCount: r.retry_count,
  status: r.status,
  failedAt: r.failed_at.toISOString(),
  replayedAt: r.replayed_at?.toISOString() ?? null,
  replayedBy: r.replayed_by,
});

@Injectable()
export class FailedEventsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool, private readonly producer: KafkaProducerService) {}

  async list(tenantId: string, status: 'FAILED' | 'REPLAYED' | undefined, limit: number, offset: number) {
    const params: unknown[] = [tenantId];
    let where = 'tenant_id = $1';
    if (status) { params.push(status); where += ` AND status = $${params.length}`; }
    params.push(limit, offset);
    const { rows } = await this.pool.query<FailedRow>(
      `SELECT id, event_id, event_type, tenant_id, payload, error, retry_count, status, failed_at, replayed_at, replayed_by
       FROM failed_events WHERE ${where} ORDER BY failed_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows.map(dto);
  }

  async replay(user: AuthUser, id: string) {
    // Atomically claim the row so concurrent clicks can't publish twice.
    const claim = await this.pool.query<FailedRow>(
      `UPDATE failed_events SET status = 'REPLAYED', replayed_at = now(), replayed_by = $3
       WHERE id = $1 AND tenant_id = $2 AND status = 'FAILED' RETURNING *`,
      [id, user.tenantId, user.sub],
    );
    const row = claim.rows[0];
    if (!row) {
      const exists = await this.pool.query('SELECT status FROM failed_events WHERE id = $1 AND tenant_id = $2', [id, user.tenantId]);
      if (!exists.rowCount) throw new NotFoundException('Failed event not found');
      throw new ConflictException('Event was already replayed');
    }

    try {
      let payload: Record<string, any>;
      try { payload = JSON.parse(row.payload); } catch { throw new UnprocessableEntityException('Payload is not valid JSON and cannot be replayed'); }
      // demo hook: replayed simulated failures should now succeed
      if (payload?.metadata && '_simulateFailure' in payload.metadata) delete payload.metadata._simulateFailure;
      const key = payload?.context?.correlationId ?? payload?.eventId ?? row.id;
      await this.producer.send(TOPICS.EVENTS, key, JSON.stringify(payload), { [HEADERS.REPLAYED]: 'true' });
    } catch (e) {
      // publishing failed -> give the row back so the operator can retry
      await this.pool.query(`UPDATE failed_events SET status = 'FAILED', replayed_at = NULL, replayed_by = NULL WHERE id = $1`, [id]);
      throw e;
    }
    return dto({ ...row, status: 'REPLAYED' });
  }
}
