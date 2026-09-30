import assert from 'node:assert/strict';
import { normalizePlannerEventsPayload } from '../newtab/planner-calendar.js';

const date = '2026-09-29';
const event = { id: 'event-1', title: 'Standup' };

assert.deepEqual(
  normalizePlannerEventsPayload({ events: [], disconnected: true, status: 401 }, date),
  { date, events: [], stale: undefined, partial: undefined, disconnected: true },
  'Calendar disconnected state must reach the planner loader so it can render reconnect UI'
);

assert.deepEqual(
  normalizePlannerEventsPayload([event], date),
  { date, events: [event] },
  'Legacy array event payloads remain supported'
);

console.log('planner calendar tests passed');
