import { configureStore, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { api } from './api';

export interface LiveEvent { id: string; eventType: string; severity: string; service: string; actorEmail: string | null; occurredAt: string; correlationId: string | null }

const live = createSlice({
  name: 'live',
  initialState: { events: [] as LiveEvent[], connected: false },
  reducers: {
    push: (s, a: PayloadAction<LiveEvent>) => { s.events.unshift(a.payload); s.events.length = Math.min(s.events.length, 100); },
    setConnected: (s, a: PayloadAction<boolean>) => { s.connected = a.payload; },
  },
});
export const { push, setConnected } = live.actions;

export const store = configureStore({
  reducer: { [api.reducerPath]: api.reducer, live: live.reducer },
  middleware: (gdm) => gdm().concat(api.middleware),
});
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
