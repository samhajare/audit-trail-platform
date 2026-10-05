import { Controller, Get } from '@nestjs/common';
import { FLAGS, FlagKey } from '@audit/contracts';
import { CurrentUser } from './decorators';
import type { AuthUser } from './auth.types';
import { FlagsService } from '../flags/flags.service';

@Controller('me')
export class MeController {
  constructor(private readonly flags: FlagsService) {}

  /** Bootstrap call for the SPA: who am I, what may I do, which backend-enforced flags are on. */
  @Get()
  async me(@CurrentUser() user: AuthUser) {
    const entries = await Promise.all(
      (Object.values(FLAGS) as FlagKey[]).map(async (f) => [f, await this.flags.isEnabled(f, user)] as const),
    );
    return { ...user, flags: Object.fromEntries(entries) };
  }
}
