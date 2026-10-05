import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { FLAGS, PERMISSIONS } from '@audit/contracts';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { RequireFlag } from '../flags/flags.guard';
import { ZodPipe } from '../audit/zod.pipe';
import { FailedEventsService } from './failed-events.service';

const ListSchema = z.object({
  status: z.enum(['FAILED', 'REPLAYED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

@Controller('failed-events')
export class FailedEventsController {
  constructor(private readonly svc: FailedEventsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MANAGE)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(ListSchema)) q: z.infer<typeof ListSchema>) {
    return this.svc.list(user.tenantId, q.status, q.limit, q.offset);
  }

  @Post(':id/replay')
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.REPLAY)
  @RequireFlag(FLAGS.DLQ_REPLAY)
  replay(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.replay(user, id);
  }
}
