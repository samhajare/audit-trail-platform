import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

let getToken: (() => Promise<string | undefined>) | undefined;
export const setTokenGetter = (f: () => Promise<string | undefined>) => { getToken = f; };
export const currentToken = async () => (getToken ? getToken() : undefined);

export interface AuditEvent {
  id: string; eventId: string; eventType: string; action: string; severity: string; occurredAt: string;
  actor: { id: string; email: string | null; role: string | null };
  resource: { type: string; id: string | null } | null; service: string; correlationId: string | null;
  context: { ipAddress: string | null; userAgent: string | null };
  changes: { before: Record<string, unknown> | null; after: Record<string, unknown> | null };
  metadata: Record<string, unknown>; rawPayload?: unknown;
}
export interface Filters { q?: string; eventType?: string; service?: string; severity?: string; correlationId?: string; cursor?: string }
export interface Me { sub: string; email?: string; tenantId: string; permissions: string[]; flags: Record<string, boolean> }
export interface Stats { eventsToday: number; criticalEvents: number; activeUsers: number }
export interface Failed { id: string; eventId: string | null; eventType: string | null; error: string; retryCount: number; status: string; failedAt: string }

const qs = (o: object) => {
  const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]);
  return p.size ? `?${p}` : '';
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: '/api',
    prepareHeaders: async (h) => { const t = await currentToken(); if (t) h.set('Authorization', `Bearer ${t}`); return h; },
  }),
  tagTypes: ['Stats', 'Failed'],
  endpoints: (b) => ({
    getMe: b.query<Me, void>({ query: () => '/me' }),
    getStats: b.query<Stats, void>({ query: () => '/audit/statistics', providesTags: ['Stats'] }),
    getFilters: b.query<{ eventTypes: string[]; services: string[] }, void>({ query: () => '/audit/filters' }),
    getEvents: b.query<{ items: AuditEvent[]; nextCursor: string | null }, Filters>({ query: (f) => `/audit/events${qs({ ...f, limit: 25 })}` }),
    getEvent: b.query<AuditEvent, string>({ query: (id) => `/audit/events/${id}` }),
    getTimeline: b.query<{ items: AuditEvent[] }, string>({ query: (id) => `/audit/correlation/${encodeURIComponent(id)}` }),
    getFailed: b.query<Failed[], void>({ query: () => '/failed-events', providesTags: ['Failed'] }),
    replay: b.mutation<Failed, string>({ query: (id) => ({ url: `/failed-events/${id}/replay`, method: 'POST' }), invalidatesTags: ['Failed'] }),
  }),
});
export const { useGetMeQuery, useGetStatsQuery, useGetFiltersQuery, useGetEventsQuery, useGetEventQuery, useGetTimelineQuery, useGetFailedQuery, useReplayMutation } = api;
