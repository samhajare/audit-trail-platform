import dotenv from 'dotenv';
import path from 'path';
import http from 'http';
import { Kafka, logLevel, Partitioners, Producer } from 'kafkajs';
import { build, bulk, Kind, KINDS } from './events';

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const TOPIC = 'audit.events';
const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
const DEFAULT_TENANT = process.env.DEV_TENANT_ID ?? 'company_123';
const PORT = Number(process.env.SIMULATOR_PORT ?? 4100);
const CORS = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

const producer: Producer = new Kafka({ clientId: 'audit-simulator', brokers, logLevel: logLevel.WARN }).producer({ idempotent: true, createPartitioner: Partitioners.DefaultPartitioner });

async function publish(events: any[]) {
  for (let i = 0; i < events.length; i += 500) {
    await producer.send({
      topic: TOPIC,
      messages: events.slice(i, i + 500).map((e) => ({
        key: e.context?.correlationId ?? e.eventId,   // same correlation -> same partition -> ordered
        value: JSON.stringify(e),
      })),
    });
  }
  return events.length;
}

async function run(kind: string, tenantId: string, count: number) {
  if (kind === 'bulk') return publish(bulk(count, tenantId));
  if (!KINDS.includes(kind as Kind)) throw new Error(`Unknown kind "${kind}". Use: ${[...KINDS, 'bulk'].join(', ')}`);
  return publish(build(kind as Kind, tenantId));
}

async function main() {
  await producer.connect();
  const [cmd, arg] = process.argv.slice(2);

  // CLI: npm run simulate -w @audit/simulator -- role-change | bulk 1000
  if (cmd && cmd !== 'serve') {
    const n = await run(cmd, DEFAULT_TENANT, Number(arg ?? 1000));
    console.log(`published ${n} event(s)`);
    await producer.disconnect();
    return;
  }

  // HTTP: POST /simulate/:kind?count=1000&tenantId=company_123  (drives the UI's "Generate ..." buttons)
  http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', CORS);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const send = (code: number, body: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { status: 'ok', kinds: [...KINDS, 'bulk'] });
      const m = url.pathname.match(/^\/simulate\/([a-z-]+)$/);
      if (req.method === 'POST' && m) {
        const count = Math.min(Number(url.searchParams.get('count') ?? 1000), 50_000);
        const published = await run(m[1], url.searchParams.get('tenantId') ?? DEFAULT_TENANT, count);
        return send(202, { published });
      }
      send(404, { error: 'not found' });
    } catch (e) {
      send(400, { error: (e as Error).message });
    }
  }).listen(PORT, () => console.log(`simulator on :${PORT}  POST /simulate/{${[...KINDS, 'bulk'].join('|')}}`));
}
main().catch((e) => { console.error(e); process.exit(1); });
