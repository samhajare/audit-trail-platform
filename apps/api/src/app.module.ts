import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';   // guard order matters: auth -> permissions -> flags
import { FlagsModule } from './flags/flags.module';
import { KafkaModule } from './kafka/kafka.module';
import { AuditModule } from './audit/audit.module';
import { FailedEventsModule } from './failed-events/failed-events.module';
import { HealthController } from './health.controller';

@Module({
  imports: [DbModule, AuthModule, FlagsModule, KafkaModule, AuditModule, FailedEventsModule],
  controllers: [HealthController],
})
export class AppModule {}
