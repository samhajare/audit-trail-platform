import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FlagKey } from '@audit/contracts';
import { FlagsService } from './flags.service';

export const FLAG_KEY = 'requiredFlag';
export const RequireFlag = (flag: FlagKey) => SetMetadata(FLAG_KEY, flag);

@Injectable()
export class FlagsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly flags: FlagsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const flag = this.reflector.getAllAndOverride<FlagKey>(FLAG_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!flag) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user) return false;
    if (!(await this.flags.isEnabled(flag, user))) {
      throw new ForbiddenException(`Feature "${flag}" is disabled`);
    }
    return true;
  }
}
