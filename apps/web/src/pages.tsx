import { useEffect, useState, useDeferredValue } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useFlags } from 'launchdarkly-react-client-sdk';
import { AuditEvent, Filters, useGetEventQuery, useGetEventsQuery, useGetFailedQuery, useGetFiltersQuery, useGetStatsQuery, useGetTimelineQuery, useReplayMutation } from './api';
import { RootState } from './store';

const t = (s: string) => new Date(s).toLocaleString();
const Sev = ({ v }: { v: string }) => <span className={`sev ${v}`}>{v}</span>;

/* ── Dashboard ── */
export function Dashboard() {
  const { data: s } = useGetStatsQuery();
  const { events, connected } = useSelector((st: RootState) => st.live);
  const [busy, setBusy] = useState('');
  const gen = async (kind: string) => { setBusy(kind); try { await fetch(`/sim/simulate/${kind}${kind === 'bulk' ? '?count=1000' : ''}`, { method: 'POST' }); } finally { setBusy(''); } };
  return (
    <>
      <div className="cards">
        <div className="card"><span>Events today</span><b>{s?.eventsToday ?? '–'}</b></div>
        <div className="card"><span>Critical (high+)</span><b>{s?.criticalEvents ?? '–'}</b></div>
        <div className="card"><span>Active users</span><b>{s?.activeUsers ?? '–'}</b></div>
      </div>
      <section>
        <h3>Live activity <small className={connected ? 'ok' : 'muted'}>{connected ? '● connected' : '○ offline'}</small></h3>
        {!events.length && <p className="muted">Waiting for events… use the simulator below.</p>}
        {events.slice(0, 20).map((e) => (
          <Link key={e.id} to={`/events/${e.id}`} className="row">
            <time>{new Date(e.occurredAt).toLocaleTimeString()}</time><span>{e.eventType}</span><span className="muted">{e.actorEmail}</span><Sev v={e.severity} />
          </Link>
        ))}
      </section>
      <section>
        <h3>Simulator</h3>
        {['login', 'role-change', 'payment', 'order-flow', 'bulk', 'failed'].map((k) => (
          <button key={k} disabled={!!busy} onClick={() => gen(k)}>{busy === k ? '…' : k === 'bulk' ? '1000 events' : k}</button>
        ))}
      </section>
    </>
  );
}

/* ── Explorer: filters live in the URL; each page of the cursor API is its own cached query ── */
function Page({ filters, cursor, last, onMore }: { filters: Filters; cursor?: string; last: boolean; onMore: (c: string) => void }) {
  const { data, isFetching, error } = useGetEventsQuery({ ...filters, cursor });
  if (error) return <p className="err">Failed to load events.</p>;
  return (
    <>
      {data?.items.map((e) => (
        <Link key={e.id} to={`/events/${e.id}`} className="row">
          <time>{t(e.occurredAt)}</time><span>{e.eventType}</span><span className="muted">{e.actor.email ?? e.actor.id}</span><span className="muted">{e.service}</span><Sev v={e.severity} />
        </Link>
      ))}
      {isFetching && <p className="muted">Loading…</p>}
      {last && data?.nextCursor && <button onClick={() => onMore(data.nextCursor!)}>Load more</button>}
      {last && data && !data.items.length && <p className="muted">No events match.</p>}
    </>
  );
}

export function Explorer({ canExport }: { canExport: boolean }) {
  const [sp, setSp] = useSearchParams();
  const flags = useFlags();
  const advanced = flags.auditNewSearch ?? true; // LaunchDarkly key audit-new-search; ON when LD isn't configured
  const { data: opts } = useGetFiltersQuery();
  const [text, setText] = useState(sp.get('q') ?? '');
  const deferred = useDeferredValue(text);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };
  useEffect(() => { if (deferred !== (sp.get('q') ?? '')) set('q', deferred); }, [deferred]); // eslint-disable-line
  useEffect(() => setCursors([undefined]), [sp.toString()]); // eslint-disable-line
  const filters = Object.fromEntries(sp) as Filters;
  const Select = ({ k, label, values }: { k: string; label: string; values: string[] }) => (
    <select value={sp.get(k) ?? ''} onChange={(e) => set(k, e.target.value)}>
      <option value="">{label}: all</option>{values.map((v) => <option key={v}>{v}</option>)}
    </select>
  );
  return (
    <>
      <div className="filters">
        <input placeholder="Search actor, type, resource, event or correlation id" value={text} onChange={(e) => setText(e.target.value)} />
        <Select k="severity" label="Severity" values={['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']} />
        {advanced && <Select k="eventType" label="Event type" values={opts?.eventTypes ?? []} />}
        {advanced && <Select k="service" label="Service" values={opts?.services ?? []} />}
        {canExport && <a className="btn" href={`/api/audit/events/export?${sp}`}>Export CSV</a>}
      </div>
      <section>
        {cursors.map((c, i) => <Page key={c ?? 'first'} filters={filters} cursor={c} last={i === cursors.length - 1} onMore={(n) => setCursors((x) => [...x, n])} />)}
      </section>
    </>
  );
}

/* ── Event details ── */
function Diff({ before, after }: { before: AuditEvent['changes']['before']; after: AuditEvent['changes']['after'] }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  if (!keys.length) return <p className="muted">No field changes recorded.</p>;
  const f = (v: unknown) => (v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <table><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>
      {keys.map((k) => { const b = before?.[k], a = after?.[k], changed = f(b) !== f(a);
        return <tr key={k} className={changed ? 'chg' : ''}><td>{k}</td><td>{f(b)}</td><td>{f(a)}</td></tr>; })}
    </tbody></table>
  );
}

export function EventDetail() {
  const { id = '' } = useParams();
  const { data: e, error } = useGetEventQuery(id);
  if (error) return <p className="err">Event not found.</p>;
  if (!e) return <p className="muted">Loading…</p>;
  const kv: [string, React.ReactNode][] = [
    ['Event ID', e.eventId], ['Timestamp', t(e.occurredAt)], ['Actor', e.actor.email ?? e.actor.id], ['Service', e.service],
    ['Resource', e.resource ? `${e.resource.type} ${e.resource.id ?? ''}` : '—'], ['IP', e.context.ipAddress ?? '—'], ['Browser', e.context.userAgent ?? '—'],
    ['Correlation ID', e.correlationId ? <Link to={`/correlation/${e.correlationId}`}>{e.correlationId} → timeline</Link> : '—'],
  ];
  return (
    <section>
      <h2>{e.eventType} <Sev v={e.severity} /></h2>
      <dl>{kv.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <h3>Changes</h3><Diff before={e.changes.before} after={e.changes.after} />
      {e.rawPayload !== undefined && <><h3>Raw payload</h3><pre>{JSON.stringify(e.rawPayload, null, 2)}</pre></>}
    </section>
  );
}

/* ── Correlation timeline ── */
export function Timeline() {
  const { id = '' } = useParams();
  const { data, isLoading } = useGetTimelineQuery(id);
  return (
    <section>
      <h2>Timeline <small className="muted">{id}</small></h2>
      {isLoading && <p className="muted">Loading…</p>}
      <ol className="timeline">
        {data?.items.map((e) => (
          <li key={e.id}><time>{new Date(e.occurredAt).toLocaleTimeString()}</time>
            <Link to={`/events/${e.id}`}>{e.eventType}</Link> <span className="muted">{e.service}</span></li>
        ))}
      </ol>
    </section>
  );
}

/* ── Failed events / DLQ ── */
export function FailedEvents({ canReplay }: { canReplay: boolean }) {
  const { data, error } = useGetFailedQuery(undefined, { pollingInterval: 5000 });
  const [replay, { isLoading }] = useReplayMutation();
  if (error) return <p className="err">Not allowed, or failed to load.</p>;
  return (
    <section>
      <h2>Failed events</h2>
      {!data?.length && <p className="muted">Nothing in the DLQ.</p>}
      {data && data.length > 0 && (
        <table><thead><tr><th>Event</th><th>Retries</th><th>Error</th><th>Failed at</th><th>Status</th><th /></tr></thead><tbody>
          {data.map((f) => (
            <tr key={f.id}><td>{f.eventId} <span className="muted">{f.eventType}</span></td><td>{f.retryCount}</td><td className="muted">{f.error}</td><td>{t(f.failedAt)}</td><td>{f.status}</td>
              <td>{canReplay && f.status === 'FAILED' && <button disabled={isLoading} onClick={() => replay(f.id)}>Replay</button>}</td></tr>
          ))}
        </tbody></table>
      )}
    </section>
  );
}
