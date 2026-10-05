import { useEffect, useRef } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { api, currentToken, useGetMeQuery } from './api';
import { AppDispatch, push, setConnected } from './store';
import { Dashboard, EventDetail, Explorer, FailedEvents, Timeline } from './pages';

/** One SSE connection for the whole app so the live buffer survives navigation. */
function useLiveStream(enabled: boolean) {
  const dispatch = useDispatch<AppDispatch>();
  const timer = useRef<number>();
  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | undefined; let closed = false;
    void currentToken().then((t) => {
      if (closed) return;
      es = new EventSource(`/api/audit/stream${t ? `?access_token=${encodeURIComponent(t)}` : ''}`);
      es.onopen = () => dispatch(setConnected(true));
      es.onerror = () => dispatch(setConnected(false));
      es.addEventListener('audit', (m) => {
        dispatch(push(JSON.parse((m as MessageEvent).data)));
        window.clearTimeout(timer.current); // refresh stats at most every 2s during bursts
        timer.current = window.setTimeout(() => dispatch(api.util.invalidateTags(['Stats'])), 2000);
      });
    });
    return () => { closed = true; es?.close(); dispatch(setConnected(false)); };
  }, [enabled, dispatch]);
}

export default function App() {
  const { data: me, error } = useGetMeQuery();
  useLiveStream(!!me?.flags['audit-live-stream']);
  const can = (p: string) => !!me?.permissions.includes(p);
  if (error) return <p className="pad err">Cannot reach the API. Is it running on :4000?</p>;
  return (
    <>
      <header>
        <strong>Audit Explorer</strong>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/events">Events</NavLink>
          {can('audit:manage') && <NavLink to="/failed">Failed events</NavLink>}
        </nav>
        <span className="muted">{me ? `${me.email ?? me.sub} · ${me.tenantId}` : ''}</span>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/events" element={<Explorer canExport={can('audit:export') && !!me?.flags['audit-data-export']} />} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/correlation/:id" element={<Timeline />} />
          <Route path="/failed" element={<FailedEvents canReplay={can('audit:replay') && !!me?.flags['audit-dlq-replay']} />} />
        </Routes>
      </main>
    </>
  );
}
