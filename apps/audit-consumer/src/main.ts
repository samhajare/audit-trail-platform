import { IHeaders, Kafka, KafkaMessage, logLevel, Partitioners, Producer } from 'kafkajs';
import { HEADERS, TOPICS } from '@audit/contracts';
import { config } from './config';
import { pool, recordFailedEvent } from './db';
import { isPermanent, processEvent } from './processor';
import { backoffMs } from './retry';

const kafka = new Kafka({ clientId: 'audit-consumer', brokers: config.KAFKA_BROKERS.split(','), logLevel: logLevel.WARN });
const producer: Producer = kafka.producer({ idempotent: true, createPartitioner: Partitioners.DefaultPartitioner });

const hdr = (h: IHeaders | undefined, name: string): string | undefined => {
  const v = h?.[name];
  return v == null ? undefined : Array.isArray(v) ? v[0]?.toString() : v.toString();
};
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 500);
const log = (msg: string, extra?: unknown) => console.log(`[${new Date().toISOString()}] ${msg}`, extra ?? '');

async function ensureTopics() {
  const admin = kafka.admin();
  await admin.connect();
  await admin.createTopics({
    topics: Object.values(TOPICS).map((topic) => ({ topic, numPartitions: 3 })),
  });
  await admin.disconnect();
}

async function toRetry(msg: KafkaMessage, error: unknown, retriesDone: number, from: string) {
  const delay = backoffMs(retriesDone + 1, config.CONSUMER_RETRY_BASE_MS);
  await producer.send({
    topic: TOPICS.RETRY,
    messages: [{
      key: msg.key,
      value: msg.value,
      headers: {
        [HEADERS.RETRY_COUNT]: String(retriesDone),
        [HEADERS.NEXT_ATTEMPT_AT]: String(Date.now() + delay),
        [HEADERS.ERROR]: errText(error),
        [HEADERS.ORIGINAL_TOPIC]: from,
      },
    }],
  });
  log(`→ retry #${retriesDone + 1} in ${delay}ms`, errText(error));
}

async function toDlq(msg: KafkaMessage, error: unknown, retriesDone: number, from: string) {
  await producer.send({
    topic: TOPICS.DLQ,
    messages: [{
      key: msg.key,
      value: msg.value,
      headers: {
        [HEADERS.RETRY_COUNT]: String(retriesDone),
        [HEADERS.ERROR]: errText(error),
        [HEADERS.ORIGINAL_TOPIC]: from,
      },
    }],
  });
  log(`→ DLQ after ${retriesDone} retries`, errText(error));
}

/** 1) Main consumer: try once; transient failure -> retry topic, permanent failure -> DLQ. */
async function runMain() {
  const c = kafka.consumer({ groupId: 'audit-consumer' });
  await c.connect();
  await c.subscribe({ topic: TOPICS.EVENTS, fromBeginning: true });
  await c.run({
    eachMessage: async ({ message }) => {
      const raw = message.value?.toString() ?? '';
      try {
        const r = await processEvent(raw);
        if (r === 'duplicate') log('duplicate ignored');
      } catch (e) {
        if (isPermanent(e)) await toDlq(message, e, 0, TOPICS.EVENTS);
        else await toRetry(message, e, 0, TOPICS.EVENTS);
      }
    },
  });
  return c;
}

/** 2) Retry consumer: waits until next-attempt-at (heartbeating), retries, then re-queues or dead-letters. */
async function runRetry() {
  const c = kafka.consumer({ groupId: 'audit-retry-consumer' });
  await c.connect();
  await c.subscribe({ topic: TOPICS.RETRY, fromBeginning: true });
  await c.run({
    eachMessage: async ({ message, heartbeat }) => {
      const done = Number(hdr(message.headers, HEADERS.RETRY_COUNT) ?? 0);
      const at = Number(hdr(message.headers, HEADERS.NEXT_ATTEMPT_AT) ?? 0);
      // v1 trade-off: a delay blocks this partition. For high volume use tiered retry topics instead.
      while (Date.now() < at) {
        await new Promise((r) => setTimeout(r, Math.min(1000, at - Date.now())));
        await heartbeat();
      }
      try {
        await processEvent(message.value?.toString() ?? '');
        log(`retry #${done + 1} succeeded`);
      } catch (e) {
        const retriesDone = done + 1;
        if (isPermanent(e) || retriesDone >= config.CONSUMER_MAX_RETRIES) await toDlq(message, e, retriesDone, TOPICS.RETRY);
        else await toRetry(message, e, retriesDone, TOPICS.RETRY);
      }
    },
  });
  return c;
}

/** 3) DLQ indexer: materialises the DLQ topic into failed_events. Throwing here = kafkajs retries until the DB is back. */
async function runDlqIndexer() {
  const c = kafka.consumer({ groupId: 'audit-dlq-indexer' });
  await c.connect();
  await c.subscribe({ topic: TOPICS.DLQ, fromBeginning: true });
  await c.run({
    eachMessage: async ({ partition, message }) => {
      const payload = message.value?.toString() ?? '';
      let p: any = null;
      try { p = JSON.parse(payload); } catch { /* poison payload stays inspectable as raw text */ }
      await recordFailedEvent({
        eventId: p?.eventId ?? null,
        eventType: p?.eventType ?? null,
        tenantId: p?.metadata?.tenantId ?? null,
        payload,
        error: hdr(message.headers, HEADERS.ERROR) ?? 'unknown',
        retryCount: Number(hdr(message.headers, HEADERS.RETRY_COUNT) ?? 0),
        partition,
        offset: message.offset,
      });
    },
  });
  return c;
}

async function main() {
  await ensureTopics();
  await producer.connect();
  const consumers = await Promise.all([runMain(), runRetry(), runDlqIndexer()]);
  log(`audit-consumer up (max retries ${config.CONSUMER_MAX_RETRIES}, base backoff ${config.CONSUMER_RETRY_BASE_MS}ms)`);

  const shutdown = async () => {
    log('shutting down');
    await Promise.allSettled(consumers.map((c) => c.disconnect()));
    await producer.disconnect();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
main().catch((e) => { console.error(e); process.exit(1); });
