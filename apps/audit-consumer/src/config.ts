import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

export const config = z
  .object({
    DATABASE_URL: z.string().default('postgres://audit:audit@localhost:5432/audit'),
    KAFKA_BROKERS: z.string().default('localhost:9092'),
    CONSUMER_MAX_RETRIES: z.coerce.number().int().min(1).default(3),
    CONSUMER_RETRY_BASE_MS: z.coerce.number().int().min(0).default(2000),
    ALLOW_SIMULATED_FAILURES: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  })
  .parse(process.env);
