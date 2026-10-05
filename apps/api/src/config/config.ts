import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Works from repo root, from apps/api (npm workspaces cwd), or with real env vars (Docker/CI).
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const optional = z.string().optional().transform((v) => v || undefined);

const Env = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgres://audit:audit@localhost:5432/audit'),
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  AUTH_DISABLED: bool.default('false'),
  DEV_TENANT_ID: z.string().default('company_123'),
  DEV_PERMISSIONS: z
    .string()
    .default('audit:read,audit:export,audit:view-sensitive,audit:replay,audit:manage'),
  AUTH0_DOMAIN: optional,
  AUTH0_AUDIENCE: optional,
  AUTH_TENANT_CLAIM: z.string().default('https://audit-explorer/tenant_id'),
  LD_SDK_KEY: optional,
});

export const config = Env.parse(process.env);

if (config.NODE_ENV === 'production' && config.AUTH_DISABLED) {
  throw new Error('AUTH_DISABLED must never be true in production');
}
if (!config.AUTH_DISABLED && (!config.AUTH0_DOMAIN || !config.AUTH0_AUDIENCE)) {
  throw new Error('AUTH0_DOMAIN and AUTH0_AUDIENCE are required unless AUTH_DISABLED=true');
}
