import { Module } from '@nestjs/common';
import { FailedEventsController } from './failed-events.controller';
import { FailedEventsService } from './failed-events.service';

@Module({ controllers: [FailedEventsController], providers: [FailedEventsService] })
export class FailedEventsModule {}
