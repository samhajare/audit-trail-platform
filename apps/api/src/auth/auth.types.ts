import type { Permission } from '@audit/contracts';

export interface AuthUser {
  sub: string;
  email?: string;
  tenantId: string;
  permissions: Permission[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
