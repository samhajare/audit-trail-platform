import { Controller, Get, MessageEvent, Param, ParseUUIDPipe, Query, Res, Sse } from '@nestjs/common';
import type { Response } from 'express';
import { interval, merge, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { FLAGS, PERMISSIONS } from '@audit/contracts';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { RequireFlag } from '../flags/flags.guard';
import { FlagsService } from '../flags/flags.service';
import { AuditService } from './audit.service';
import { LiveStreamService } from './live-stream.service';
import { toDto } from './audit.mapper';
import { ListQuery, ListQuerySchema, StatsQuery, StatsQuerySchema } from './audit.types';
import { ZodPipe } from './zod.pipe';
import { maskDeep } from './masking';

const MAX_EXPORT_ROWS = 50_000;
const csvCell = (v: unknown): string => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

@Controller('audit')
@RequirePermissions(PERMISSIONS.READ)
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly live: LiveStreamService,
    private readonly flags: FlagsService,
  ) {}

  private async canSeeSensitive(user: AuthUser) {
    return (
      user.permissions.includes(PERMISSIONS.VIEW_SENSITIVE) &&
      (await this.flags.isEnabled(FLAGS.SENSITIVE_VIEW, user))
    );
  }

  @Get('events')
  async list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(ListQuerySchema)) q: ListQuery) {
    const sensitive = await this.canSeeSensitive(user);
    const { items, nextCursor } = await this.audit.list(user.tenantId, q);
    return { items: items.map((r) => toDto(r, { sensitive })), nextCursor };
  }

  // NOTE: declared before events/:id so "export" is not parsed as an id
  @Get('events/export')
  @RequirePermissions(PERMISSIONS.READ, PERMISSIONS.EXPORT)
  @RequireFlag(FLAGS.DATA_EXPORT)
  async export(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(ListQuerySchema)) q: ListQuery,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-events-${Date.now()}.csv"`);
    res.write('event_id,occurred_at,event_type,action,severity,actor_id,actor_email,resource_type,resource_id,service,correlation_id,ip_address\n');
    for await (const r of this.audit.iterate(user.tenantId, q, MAX_EXPORT_ROWS)) {
      res.write(
        [r.event_id, r.occurred_at.toISOString(), r.event_type, r.action, r.severity, r.actor_id, r.actor_email,
          r.resource_type, r.resource_id, r.service_name, r.correlation_id, r.ip_address].map(csvCell).join(',') + '\n',
      );
    }
    res.end();
  }

  @Get('events/:id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const sensitive = await this.canSeeSensitive(user);
    return toDto(await this.audit.getById(user.tenantId, id), { sensitive });
  }

  @Get('correlation/:correlationId')
  async timeline(@CurrentUser() user: AuthUser, @Param('correlationId') correlationId: string) {
    const sensitive = await this.canSeeSensitive(user);
    const rows = await this.audit.timeline(user.tenantId, correlationId.slice(0, 128));
    return { correlationId, items: rows.map((r) => toDto(r, { sensitive })) };
  }

  @Get('statistics')
  statistics(@CurrentUser() user: AuthUser, @Query(new ZodPipe(StatsQuerySchema)) q: StatsQuery) {
    return this.audit.statistics(user.tenantId, q.since);
  }

  @Get('filters')
  filters(@CurrentUser() user: AuthUser) {
    return this.audit.filterOptions(user.tenantId);
  }

  /** SSE. EventSource can't send headers -> this route accepts ?access_token= (see AuthGuard). */
  @Sse('stream')
  @RequireFlag(FLAGS.LIVE_STREAM)
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    const events = this.live.forTenant(user.tenantId).pipe(
      map((e): MessageEvent => ({
        type: 'audit',
        id: e.id,
        data: {
          id: e.id,
          eventId: e.event_id,
          eventType: e.event_type,
          action: e.action,
          severity: e.severity,
          service: e.service_name,
          actorEmail: e.actor_email,
          correlationId: e.correlation_id,
          occurredAt: e.occurred_at,
        },
      })),
    );
    const heartbeat = interval(15_000).pipe(map((): MessageEvent => ({ type: 'heartbeat', data: {} })));
    return merge(events, heartbeat);
  }
}
