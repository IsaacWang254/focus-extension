import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  buildDayTimeline,
  layoutDayGrid,
  parseTaskDeadline
} from '../newtab/planner-model.js';
import { contrastRatio, eventColors } from '../newtab/planner-color.js';

const DATE = '2026-09-29';
const SCALE = 64 / 60; // 64px per hour
const at = time => `${DATE}T${time}:00`;
const timed = (id, start, end, extra = {}) => ({ id, calendarId: 'cal', title: id, start: `${DATE}T${start}:00`, end: `${DATE}T${end}:00`, ...extra });
const gridFor = (events, now = new Date(at('10:30')), scale = SCALE) =>
  layoutDayGrid(buildDayTimeline(events, DATE, now), { pxPerMinute: scale });

const TZ_CASE = process.env.PLANNER_GRID_TZ || '';

if (TZ_CASE) {
  runTimezoneCase(TZ_CASE);
} else {
  runLocalTests();
  for (const tz of ['UTC', 'America/New_York', 'Australia/Lord_Howe', 'Asia/Kolkata']) {
    execFileSync(process.execPath, [new URL(import.meta.url).pathname], {
      env: { ...process.env, TZ: tz, PLANNER_GRID_TZ: tz },
      stdio: 'inherit'
    });
    console.log(`  ${tz}: ok`);
  }
  console.log('planner grid tests passed');
}

function runLocalTests() {
  // --- geometry & clipping ---
  const basic = gridFor([
    timed('nine-to-ten', '09:00', '10:00'),
    timed('one-minute', '12:00', '12:01'),
    { id: 'from-yesterday', calendarId: 'cal', start: '2026-09-28T22:00:00', end: at('01:00') },
    { id: 'to-tomorrow', calendarId: 'cal', start: at('23:00'), end: '2026-09-30T01:30:00' }
  ]);
  const nine = basic.events.find(e => e.id === 'nine-to-ten');
  assert.equal(nine.topMinutes, 540);
  assert.equal(nine.top, 576);
  assert.equal(nine.durationMinutes, 60);
  assert.equal(nine.height, 64);
  const minute = basic.events.find(e => e.id === 'one-minute');
  assert.equal(minute.durationMinutes, 1, 'a one-minute event keeps true duration');
  assert.equal(minute.height, SCALE, 'a one-minute event keeps true height');
  const fromYesterday = basic.events.find(e => e.id === 'from-yesterday');
  assert.equal(fromYesterday.top, 0);
  assert.equal(fromYesterday.continuesBefore, true);
  assert.equal(fromYesterday.continuesAfter, false);
  const toTomorrow = basic.events.find(e => e.id === 'to-tomorrow');
  assert.equal(toTomorrow.continuesAfter, true);
  assert.equal(toTomorrow.top, 23 * 64);
  assert.equal(toTomorrow.clippedEndMs, basic.dayEndMs);
  assert.equal(basic.durationMinutes, (basic.dayEndMs - basic.dayStartMs) / 60000, 'day length is measured, never assumed');
  assert.equal(basic.height, basic.durationMinutes * SCALE);

  // events ending exactly at dayStart are excluded upstream
  const boundary = gridFor([{ id: 'ends-at-midnight', start: '2026-09-28T23:00:00', end: '2026-09-29T00:00:00' }]);
  assert.equal(boundary.events.length, 0, 'an event ending at day start does not appear');

  // --- lane assignment ---
  const overlapping = gridFor([
    timed('a', '09:00', '10:00'),
    timed('b', '09:30', '11:00'),
    timed('c', '10:30', '12:00') // transitive: a∩b, b∩c, a∥c
  ]);
  assert.equal(overlapping.groups.length, 1, 'transitive overlaps share one group');
  assert.equal(overlapping.groups[0].laneCount, 2);
  const lanes = Object.fromEntries(overlapping.events.map(e => [e.id, e.lane]));
  assert.deepEqual(lanes, { a: 0, b: 1, c: 0 }, 'the lowest free lane is reused');
  assert.equal(overlapping.events.find(e => e.id === 'a').overlapGroup, overlapping.groups[0].id);

  const nested = gridFor([
    timed('outer', '09:00', '12:00'),
    timed('inner', '09:30', '10:00'),
    timed('inner2', '10:00', '10:30')
  ]);
  assert.equal(nested.groups[0].laneCount, 2);
  assert.equal(nested.events.find(e => e.id === 'inner2').lane, 1, 'a lane frees up at its end');
  assert.equal(nested.events.find(e => e.id === 'outer').laneSpan, 1, 'an overlapping lane blocks expansion');
  assert.equal(nested.events.find(e => e.id === 'inner').laneSpan, 1, 'no free lanes beyond the last used lane');

  const spanStops = gridFor([
    timed('x', '09:00', '09:30'),
    timed('y', '09:00', '09:25'),
    timed('z', '09:15', '09:50'),
    timed('w', '09:30', '10:00')
  ]);
  // sorted (start, end): y→lane0, x→lane1, z→lane2, w→lane0 (freed at 09:25)
  assert.equal(spanStops.groups[0].laneCount, 3);
  const w = spanStops.events.find(e => e.id === 'w');
  assert.equal(w.lane, 0);
  assert.equal(w.laneSpan, 2, 'a block expands rightward across lanes empty during its interval, stopping at the first conflict');
  assert.equal(spanStops.events.find(e => e.id === 'x').laneSpan, 1, 'expansion stops at an occupied lane');
  assert.equal(spanStops.events.find(e => e.id === 'y').laneSpan, 1);

  const touching = gridFor([timed('first', '09:00', '10:00'), timed('second', '10:00', '11:00')]);
  assert.equal(touching.groups.length, 2, 'touching intervals do not overlap');
  assert.equal(touching.events[0].laneCount, 1);
  assert.equal(touching.events[1].laneCount, 1);

  // deterministic under shuffled input
  const packEvents = [
    timed('p1', '09:00', '10:30'),
    timed('p2', '09:15', '09:45'),
    timed('p3', '10:00', '11:00'),
    timed('p4', '09:30', '11:30')
  ];
  const reference = gridFor(packEvents).events.map(e => `${e.key}:${e.lane}/${e.laneSpan}/${e.laneCount}`);
  for (const order of [[...packEvents].reverse(), [packEvents[2], packEvents[0], packEvents[3], packEvents[1]]]) {
    assert.deepEqual(gridFor(order).events.map(e => `${e.key}:${e.lane}/${e.laneSpan}/${e.laneCount}`), reference, 'packing is identical for shuffled input');
  }

  // --- marker ---
  const marked = gridFor([], new Date(at('10:30')));
  assert.equal(marked.marker.minutes, 630);
  assert.equal(marked.marker.top, 630 * SCALE);
  assert.match(marked.marker.label, /^Now · /);
  assert.equal(gridFor([], new Date('2026-09-28T10:30:00')).marker, null, 'no marker outside the day');
  assert.equal(gridFor([], new Date('2026-09-30T00:00:00')).marker, null, 'day end is exclusive');

  // --- event colors ---
  const hex = /^#[0-9a-f]{6}$/;
  for (const color of ['#dc4c3e', '#246fe0', '#059669', '#eb8909', '#ffff00', '#000000', 'not-a-color', 'rgb(1,2,3)']) {
    for (const theme of ['light', 'dark']) {
      for (const fade of [1, 0.85]) {
        const { bar, background, text } = eventColors(color, theme, { fade });
        for (const value of [bar, background, text]) assert.match(value, hex, `${color}/${theme}: colors are #rrggbb`);
        const blended = blend(text, background, fade);
        assert.ok(contrastRatio(blended, background) >= 4.5, `${color} @ ${theme} fade=${fade} reaches 4.5:1 (got ${contrastRatio(blended, background).toFixed(2)})`);
      }
    }
  }
  assert.equal(eventColors('javascript:alert(1)', 'light').bar, '#73736c', 'invalid colors fall back to neutral');
  assert.equal(eventColors('#A4BDFC', 'light').bar, '#A4BDFC', 'valid provider colors pass through');
  assert.notEqual(eventColors('#246fe0', 'light').background, eventColors('#246fe0', 'dark').background, 'themes tint differently');
}

function blend(foreground, background, alpha) {
  const ch = i => Math.round(parseInt(background.slice(i, i + 2), 16) + (parseInt(foreground.slice(i, i + 2), 16) - parseInt(background.slice(i, i + 2), 16)) * alpha);
  return `#${[1, 3, 5].map(i => ch(i).toString(16).padStart(2, '0')).join('')}`;
}

function runTimezoneCase(tz) {
  const grid = (date, events = [], now = null) =>
    layoutDayGrid(buildDayTimeline(events, date, now ? new Date(now) : null), { pxPerMinute: SCALE });
  const tickLabels = g => g.ticks.map(t => t.label);

  if (tz === 'UTC') {
    const g = grid('2026-03-08');
    assert.equal(g.durationMinutes, 1440, 'UTC days are exactly 24h');
    assert.equal(g.ticks.length, 24);
    assert.equal(g.ticks[9].label, '9 AM');
    assert.ok(g.ticks.every(t => t.offsetLabel === ''), 'no repeated hours in UTC');
  }

  if (tz === 'America/New_York') {
    const spring = grid('2026-03-08');
    assert.equal(spring.durationMinutes, 1380, 'spring-forward day is 23 real hours');
    assert.equal(spring.ticks.length, 23, 'the skipped hour has no tick');
    assert.ok(!tickLabels(spring).includes('2 AM'), '2 AM does not exist on 2026-03-08');
    assert.deepEqual(tickLabels(spring).slice(0, 4), ['12 AM', '1 AM', '3 AM', '4 AM']);

    const fall = grid('2026-11-01');
    assert.equal(fall.durationMinutes, 1500, 'fall-back day is 25 real hours');
    assert.equal(fall.ticks.length, 25);
    const oneAm = fall.ticks.filter(t => t.label === '1 AM');
    assert.equal(oneAm.length, 2, '1 AM occurs twice');
    assert.ok(oneAm[0].offsetLabel && oneAm[1].offsetLabel && oneAm[0].offsetLabel !== oneAm[1].offsetLabel, 'repeated hours carry distinct offset labels');
    assert.ok(fall.ticks.every(t => t.offsetLabel === '' || t.label === '1 AM'), 'only repeated hours carry offset labels');
    assert.equal(oneAm[1].ms - oneAm[0].ms, 3600000, 'repeated hours are one real hour apart');

    // floating deadlines inside the DST gap are rejected; repeated times pick the earlier occurrence
    assert.deepEqual(parseTaskDeadline({ due: { date: '2026-03-08T02:30:00' } }), { kind: 'none' }, 'a nonexistent local time is unusable');
    const repeated = parseTaskDeadline({ due: { date: '2026-11-01T01:30:00' } });
    assert.equal(repeated.kind, 'timed');
    assert.equal(new Date(repeated.instantMs).toISOString(), '2026-11-01T05:30:00.000Z', 'a repeated local time resolves to its earlier occurrence');
  }

  if (tz === 'Australia/Lord_Howe') {
    const end = grid('2026-04-05');
    assert.equal(end.durationMinutes, 1470, 'Lord Howe DST end adds 30 minutes');
    const start = grid('2026-10-04');
    assert.equal(start.durationMinutes, 1410, 'Lord Howe DST start drops 30 minutes');
    assert.ok(start.ticks.length === 23 || start.ticks.length === 24, 'half-hour shifts never fabricate ticks');
    assert.ok(start.ticks.every(t => new Date(t.ms).getMinutes() === 0), 'ticks stay on local top-of-hour instants');
    assert.ok(end.ticks.every(t => new Date(t.ms).getMinutes() === 0), 'ticks stay on local top-of-hour instants');
  }

  if (tz === 'Asia/Kolkata') {
    const g = grid('2026-06-15');
    assert.equal(g.durationMinutes, 1440);
    assert.equal(g.ticks.length, 24);
    assert.ok(g.ticks.every(t => new Date(t.ms).getMinutes() === 0 && new Date(t.ms).getSeconds() === 0), 'non-whole-hour zones still tick on local :00');
    assert.equal(g.ticks[5].label, '5 AM');
  }
}
