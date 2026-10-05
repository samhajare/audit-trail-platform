import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FlagsService } from './flags.service';
import { FlagsGuard } from './flags.guard';

@Global()
@Module({
  providers: [FlagsService, { provide: APP_GUARD, useClass: FlagsGuard }],
  exports: [FlagsService],
})
export class FlagsModule {}
