import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { init, LDClient } from '@launchdarkly/node-server-sdk';
import { FLAGS, FlagKey } from '@audit/contracts';
import { config } from '../config/config';
import type { AuthUser } from '../auth/auth.types';

const DEFAULTS: Record<FlagKey, boolean> = {
  [FLAGS.LIVE_STREAM]: true,
  [FLAGS.DATA_EXPORT]: true,
  [FLAGS.NEW_SEARCH]: true,
  [FLAGS.SENSITIVE_VIEW]: true,
  [FLAGS.DLQ_REPLAY]: true,
};

@Injectable()
export class FlagsService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(FlagsService.name);
  private client?: LDClient;

  async onModuleInit() {
    if (!config.LD_SDK_KEY) {
      this.log.warn('LD_SDK_KEY not set - using default flag values (all ON)');
      return;
    }
    this.client = init(config.LD_SDK_KEY);
    try {
      await this.client.waitForInitialization({ timeout: 5 });
    } catch {
      this.log.warn('LaunchDarkly did not initialise in time - falling back to defaults until it does');
    }
  }

  async isEnabled(flag: FlagKey, user: AuthUser): Promise<boolean> {
    const fallback = DEFAULTS[flag];
    if (!this.client) return fallback;
    return (await this.client.variation(
      flag,
      { kind: 'user', key: user.sub, email: user.email, tenantId: user.tenantId },
      fallback,
    )) as boolean;
  }

  async onApplicationShutdown() {
    this.client?.close();
  }
}
