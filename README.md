# Real-Time Audit Trail Explorer

Backend (V1) is implemented: contracts, Postgres schema, Kafka consumer (retry + DLQ + idempotency),
NestJS API (Auth0 RBAC, multi-tenant, SSE, masking, LaunchDarkly gating) and an event simulator.
Frontend: `apps/web` (Vite + React + RTK Query). Run `npm run dev:web` → http://localhost:5173 (uses `apps/web/.env`; Auth0 vars only needed when `VITE_AUTH_DISABLED=false`).

```
simulator ─► Kafka audit.events ─► audit-consumer ─► Postgres ─pg_notify─► API ──REST/SSE──► React (next)
                 │  fail                │ fail x3
                 └► audit.events.retry ─┴► audit.events.dlq ─► DLQ indexer ─► failed_events ─► replay (API)
```

## Run it

```bash
cp .env.example .env
npm install                 # also builds @audit/contracts
npm run infra:up            # Postgres 16 + Kafka (KRaft)
npm run db:migrate
npm run dev:consumer        # terminal 1  (creates topics on boot)
npm run dev:api             # terminal 2  → http://localhost:4000/api
npm run dev:simulator       # terminal 3  → http://localhost:4100
```

`AUTH_DISABLED=true` (default in `.env.example`) injects a dev user so you can work without Auth0.
Change `DEV_PERMISSIONS=audit:read` to see the viewer experience. The API refuses to start with
`AUTH_DISABLED=true` when `NODE_ENV=production`.

Generate data:

```bash
curl -X POST localhost:4100/simulate/role-change
curl -X POST localhost:4100/simulate/order-flow      # 6 events, one correlationId (timeline demo)
curl -X POST "localhost:4100/simulate/bulk?count=1000"
curl -X POST localhost:4100/simulate/failed          # retry x3 (~14s) → DLQ → GET /api/failed-events
# or: npm run simulate -w @audit/simulator -- bulk 5000
```

## API (all under `/api`, JWT required unless noted)

| Method & path | Permission | Notes |
|---|---|---|
| `GET /health` | public | DB check |
| `GET /me` | any | user, permissions, backend-evaluated flags |
| `GET /audit/events` | `audit:read` | filters: `q eventType service severity actorId resourceType resourceId action ip correlationId from to`; keyset paging `limit`, `cursor` → `nextCursor` |
| `GET /audit/events/:id` | `audit:read` | before/after; `rawPayload` only with `audit:view-sensitive` |
| `GET /audit/events/export` | `audit:export` + flag `audit-data-export` | streamed CSV, ≤50k rows, formula-injection safe |
| `GET /audit/correlation/:id` | `audit:read` | ordered timeline |
| `GET /audit/statistics?since=` | `audit:read` | cards + severity/service/hourly breakdowns |
| `GET /audit/filters` | `audit:read` | dropdown values for the tenant |
| `GET /audit/stream` | `audit:read` + flag `audit-live-stream` | SSE; browsers pass `?access_token=` |
| `GET /failed-events` | `audit:manage` | DLQ list (`status`, `limit`, `offset`) |
| `POST /failed-events/:id/replay` | `audit:replay` + flag `audit-dlq-replay` | 202; claims row atomically, re-publishes |

## Auth0 setup

1. Create an **API** (identifier = `AUTH0_AUDIENCE`), enable **RBAC** and **Add Permissions in the Access Token**.
2. Add permissions `audit:read audit:export audit:view-sensitive audit:replay audit:manage`.
3. Create roles `AUDIT_VIEWER`, `AUDIT_ANALYST`, `AUDIT_ADMIN` (mapping in `packages/audit-contracts`).
4. Post-login **Action** to put the tenant in the access token:
   ```js
   exports.onExecutePostLogin = async (event, api) => {
     api.accessToken.setCustomClaim('https://audit-explorer/tenant_id', event.user.app_metadata?.tenantId);
   };
   ```
5. Set `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH_DISABLED=false`.

## Design decisions worth knowing

- **Tenant isolation** is a SQL predicate (`tenant_id = $1`) from the verified token, in every query; cross-tenant IDs return 404.
- **Idempotency**: `UNIQUE(event_id)` + `ON CONFLICT DO NOTHING`; `pg_notify` fires only for rows actually inserted.
- **Live stream**: consumer → `NOTIFY` → API `LISTEN` → SSE. API and consumer stay decoupled, and only stored events are pushed.
- **Retry**: 3 retries, exponential backoff (2s/4s/8s). Malformed/unsupported events skip retries and go straight to the DLQ.
- **DLQ**: the topic is the source of truth; an indexer materialises it into `failed_events` (retries until the DB is back).
- **Masking** happens at read time by key name (`email`, `phone`, `cardNumber`, `password`, …), so access is decided per request.
- **Schema versioning**: `normalizeEvent()` dispatches on `schemaVersion`; add `case '2.0'` and old producers keep working.
- Demo hook: events with `metadata._simulateFailure=true` fail on purpose (`ALLOW_SIMULATED_FAILURES`); replay strips it.

## Known V1 limitations / next steps

- Retry delay blocks its partition (fine for the demo; use tiered retry topics at scale).
- DLQ entries with an unparseable payload have no tenant, so tenant admins can't see them (needs an ops role).
- Search uses `ILIKE`; add `pg_trgm` GIN indexes if the table gets large.
- The API doesn't yet audit its own actions (e.g. publish `DATA_EXPORTED` / `EVENT_REPLAYED` back to Kafka).
- Not exercised here: the Kafka path (no Docker in my sandbox) and live Auth0/LaunchDarkly.
