import { safeExternalUrl } from './planner-model.js';

export function getMeetingUrl(event) {
  const candidates = [event.meetingLink, event.meetingUrl, event.hangoutLink, ...(event.conferenceData?.entryPoints || []).map(point => point.uri)];
  return candidates.map(safeExternalUrl).find(Boolean) || '';
}

export function normalizePlannerEventsPayload(payload, date) {
  if (Array.isArray(payload)) return { date, events: payload };
  return {
    date,
    events: payload?.events || [],
    stale: payload?.stale,
    partial: payload?.partial,
    disconnected: payload?.disconnected
  };
}
