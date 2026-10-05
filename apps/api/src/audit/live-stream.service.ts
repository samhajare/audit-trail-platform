import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
import { Observable, Subject } from 'rxjs';
import { filter } from 'rxjs/operators';
import { config } from '../config/config';

export interface LiveEvent {
  id: string;
  event_id: string;
  event_type: string;
  action: string;
  severity: string;
  tenant_id: string;
  service_name: string;
  actor_email: string | null;
  correlation_id: string | null;
  occurred_at: string;
}

/**
 * The consumer does `pg_notify('audit_events', ...)` in the same statement that inserts the row,
 * so the API only ever pushes events that are durably stored, and API/consumer stay decoupled.
 */
@Injectable()
export class LiveStreamService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(LiveStreamService.name);
  private readonly bus = new Subject<LiveEvent>();
  private client?: Client;
  private stopped = false;
  private reconnectTimer?: NodeJS.Timeout;

  onModuleInit() {
    void this.connect();
  }

  forTenant(tenantId: string): Observable<LiveEvent> {
    return this.bus.pipe(filter((e) => e.tenant_id === tenantId));
  }

  private async connect() {
    if (this.stopped) return;
    const client = new Client({ connectionString: config.DATABASE_URL });
    const retry = () => {
      if (this.stopped || this.reconnectTimer) return;
      client.removeAllListeners();
      client.end().catch(() => undefined);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        void this.connect();
      }, 2000);
    };
    client.on('error', (e) => { this.log.warn(`LISTEN connection error: ${e.message}`); retry(); });
    client.on('end', retry);
    client.on('notification', (msg) => {
      if (!msg.payload) return;
      try { this.bus.next(JSON.parse(msg.payload)); } catch { /* ignore malformed */ }
    });
    try {
      await client.connect();
      await client.query('LISTEN audit_events');
      this.client = client;
      this.log.log('Listening on pg channel audit_events');
    } catch (e) {
      this.log.warn(`LISTEN connect failed: ${(e as Error).message}`);
      retry();
    }
  }

  async onApplicationShutdown() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await this.client?.end().catch(() => undefined);
  }
}
