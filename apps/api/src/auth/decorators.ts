import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@audit/contracts';
import type { AuthUser } from './auth.types';

export const IS_PUBLIC = 'isPublic';
export const PERMS_KEY = 'requiredPermissions';

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(PERMS_KEY, perms);
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
