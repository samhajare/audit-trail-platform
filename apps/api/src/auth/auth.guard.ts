import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Request } from 'express';
import type { Permission } from '@audit/contracts';
import { config } from '../config/config';
import { IS_PUBLIC } from './decorators';
import type { AuthUser } from './auth.types';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly jwks = config.AUTH0_DOMAIN
    ? createRemoteJWKSet(new URL(`https://${config.AUTH0_DOMAIN}/.well-known/jwks.json`))
    : null;

  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();

    if (config.AUTH_DISABLED) {
      req.user = {
        sub: 'dev|local',
        email: 'dev@local',
        tenantId: config.DEV_TENANT_ID,
        permissions: config.DEV_PERMISSIONS.split(',').map((p) => p.trim()) as Permission[],
      };
      return true;
    }

    const token = this.extractToken(req);
    if (!token || !this.jwks) throw new UnauthorizedException('Missing bearer token');

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: `https://${config.AUTH0_DOMAIN}/`,
        audience: config.AUTH0_AUDIENCE,
      });
      const tenantId = payload[config.AUTH_TENANT_CLAIM];
      if (typeof tenantId !== 'string' || !tenantId) {
        throw new ForbiddenException(
          `Token carries no tenant. Expected claim "${config.AUTH_TENANT_CLAIM}". Claim names present: ${Object.keys(payload).join(', ')}`,
        );
      }
      const user: AuthUser = {
        sub: String(payload.sub),
        email: typeof payload['email'] === 'string' ? payload['email'] : undefined,
        tenantId,
        permissions: Array.isArray(payload.permissions) ? (payload.permissions as Permission[]) : [],
      };
      req.user = user;
      return true;
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    // EventSource cannot set headers, so the SSE endpoint alone accepts ?access_token=
    if (req.path.endsWith('/stream') && typeof req.query.access_token === 'string') {
      return req.query.access_token;
    }
    return null;
  }
}
