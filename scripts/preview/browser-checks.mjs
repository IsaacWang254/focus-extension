#!/usr/bin/env node
/**
 * Browser checks for the new-tab homepage (Phase 2 grid/tasks redesign).
 *
 * Requires the preview server (npm run preview, http://localhost:4173) and
 * puppeteer-core — which must NOT be a project dependency. Install it into a
 * temp dir and point PUPPETEER_CORE at it:
 *
 *   mkdir /tmp/focus-checks && cd /tmp/focus-checks && npm i puppeteer-core
 *   PUPPETEER_CORE=/tmp/focus-checks/node_modules/puppeteer-core \
 *     node scripts/preview/browser-checks.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const requireModule = createRequire(import.meta.url);
const puppeteerSpec = process.env.PUPPETEER_CORE || 'puppeteer-core';
// puppeteer-core is CJS; an absolute path points at its install dir.
const puppeteer = /^[./]/.test(puppeteerSpec)
  ? requireModule(puppeteerSpec)
  : (await import(puppeteerSpec)).default;

const URL_BASE = 'http://localhost:4173/newtab/newtab.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 1600, height: 900 }
];

let passed = 0;
function check(name, fn) {
  try {
    const result = fn();
    assert.ok(result !== false, name);
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

const rect = sel => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.getBoundingClientRect().toJSON() : null; })()`;

async function snap(page) {
  return page.evaluate(`(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    pageScrollHeight: document.documentElement.scrollHeight,
    docW: document.documentElement.clientWidth,
    scrollW: document.documentElement.scrollWidth,
    gutter: 0,
    main: ${rect('.main')},
    clock: ${rect('#clock')},
    tasks: ${rect('#tasks-section')},
    cal: ${rect('#today-timeline-section')},
    viewport: ${rect('#timeline-viewport')},
    btn: ${rect('#back-to-now-btn')},
    sched: ${rect('#view-schedule-btn')}
  }))()`);
}

// Flags separator-like rules: visible elements with a painted top/bottom edge
// spanning most of the section. Control outlines on buttons don't count.
function horizBorders(sel) {
  return `(() => {
    const section = document.querySelector(${JSON.stringify(sel)});
    const span = section.getBoundingClientRect().width;
    return [...section.querySelectorAll('*')].filter(el => {
      const s = getComputedStyle(el);
      if (parseFloat(s.opacity) === 0 || s.visibility === 'hidden') return false;
      const w = el.getBoundingClientRect().width;
      if (w < span * 0.6) return false;
      return (s.borderTopWidth !== '0px' && s.borderTopStyle !== 'none' && s.borderTopColor !== 'rgba(0, 0, 0, 0)')
        || (s.borderBottomWidth !== '0px' && s.borderBottomStyle !== 'none' && s.borderBottomColor !== 'rgba(0, 0, 0, 0)');
    }).map(el => el.className || el.tagName);
  })()`;
}

// Flags modernist leftovers inside a modal panel: Hanken Grotesk or the old
// palette values (light + dark) on any visible element.
const DRAWER_SWEEP = `(() => {
  const banned = new Set([
    'rgb(36, 36, 32)', 'rgb(247, 245, 239)', 'rgb(203, 198, 186)',
    'rgb(101, 98, 89)', 'rgb(237, 233, 223)', 'rgb(113, 109, 99)',
    'rgb(36, 37, 33)', 'rgb(243, 240, 231)', 'rgb(185, 180, 166)',
    'rgb(83, 83, 71)', 'rgb(118, 117, 102)', 'rgb(49, 50, 44)',
    'rgb(170, 164, 149)', 'rgb(251, 249, 244)', 'rgb(44, 45, 40)'
  ]);
  const out = [];
  for (const el of document.querySelectorAll('.edit-modal-panel *')) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0) continue;
    const name = el.id || el.className || el.tagName;
    if (/Hanken/.test(s.fontFamily)) out.push(\`Hanken on \${name}\`);
    for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor']) {
      if (banned.has(s[prop])) out.push(\`\${prop}=\${s[prop]} on \${name}\`);
    }
  }
  return out;
})()`;

async function waitTasks(page) {
  await page.waitForFunction(
    `document.querySelectorAll('#task-list .planner-task-row').length === 3
     && document.querySelectorAll('#timeline-viewport .timeline-blk').length > 0`,
    { timeout: 10000 }
  );
}

for (const theme of ['light', 'dark']) {
  for (const { width, height } of SIZES) {
    const label = `${width}x${height} ${theme}`;
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      await page.goto(`${URL_BASE}?preview-theme=${theme}`, { waitUntil: 'networkidle0' });
      await waitTasks(page);
      console.log(`\n[${label}]`);

      const s0 = await snap(page);
      check('main column is 812px and centred', () => {
        assert.equal(Math.round(s0.main.width), 812, `main width ${s0.main.width}`);
        const left = s0.main.x;
        const right = s0.innerWidth - (s0.main.x + s0.main.width);
        assert.ok(Math.abs(left - right) < 2, `not centred: left ${left} right ${right}`);
        return true;
      });
      check('page does not scroll; timeline viewport fills remaining height', () => {
        assert.ok(s0.pageScrollHeight <= s0.innerHeight,
          `scrollHeight ${s0.pageScrollHeight} > innerHeight ${s0.innerHeight}`);
        const bottomGap = s0.innerHeight - (s0.viewport.y + s0.viewport.height);
        const expected = s0.innerHeight <= 800 ? 32 : 48;
        assert.ok(Math.abs(bottomGap - expected) <= 2, `viewport bottom gap ${bottomGap} vs ${expected}`);
        assert.ok(s0.viewport.height >= 160, `viewport height ${s0.viewport.height}`);
        return true;
      });
      const taskBorders = await page.evaluate(horizBorders('#tasks-section'));
      check('tasks section has no horizontal rules', () => {
        assert.deepEqual(taskBorders, [], `borders on ${taskBorders.join(', ')}`);
        return true;
      });
      const calBorders = await page.evaluate(horizBorders('#today-timeline-section'));
      check('calendar section has no horizontal rules (hour lines are backgrounds)', () => {
        assert.deepEqual(calBorders, [], `borders on ${calBorders.join(', ')}`);
        return true;
      });

      const weights = await page.evaluate(
        `[...document.querySelectorAll('#task-list .planner-row-title')].map(el => getComputedStyle(el).fontWeight)`
      );
      check('all task titles share weight 400', () => {
        weights.forEach(w => assert.equal(w, '400'));
        return true;
      });

      // Task row: ring + open button only — no current-task artifacts.
      const rowSel = '#task-list .planner-task-row:nth-child(2)';
      const rowClean = await page.evaluate(`(() => {
        const rows = [...document.querySelectorAll('#task-list .planner-task-row')];
        return {
          anyAriaCurrent: !!document.querySelector('[aria-current]'),
          anyCurrentName: !!document.querySelectorAll && [...document.querySelectorAll('#task-list [aria-label]')].some(el => /make current|current task/i.test(el.getAttribute('aria-label'))),
          hiddenHint: rows.some(r => r.querySelector('.visually-hidden')),
          secondRowChildren: [...rows[1].children].map(el => el.className)
        };
      })()`);
      check('no Make current / Current task / aria-current artifacts', () => {
        assert.equal(rowClean.anyAriaCurrent, false);
        assert.equal(rowClean.anyCurrentName, false);
        assert.equal(rowClean.hiddenHint, false);
        return true;
      });

      // Row highlight: hidden at rest; geometry snapshot for hover comparison.
      const rowParts = sels => `(() => {
        const row = document.querySelector(${JSON.stringify(rowSel)});
        const pick = s => row.querySelector(s)?.getBoundingClientRect().toJSON();
        const cs = getComputedStyle(row, '::before');
        return { row: row.getBoundingClientRect().toJSON(), parts: ${sels}, opacity: cs.opacity, bg: cs.backgroundColor, left: cs.left, right: cs.right, radius: cs.borderRadius };
      })()`;
      const partsExpr = `{ ring: pick('.planner-check'), title: pick('.planner-row-title'), meta: pick('.planner-row-meta'), open: pick('.task-open') }`;
      const washColor = theme === 'dark' ? 'rgb(30, 30, 30)' : 'rgb(241, 241, 241)';
      const rowRest = await page.evaluate(rowParts(partsExpr));
      check('task row has no highlight at rest', () => (assert.equal(rowRest.opacity, '0'), true));

      // Wash layer on hover: colour, symmetric inline bleed (−12/−12 — the
      // row's right action slot is gone, so both edges mirror), zero reflow.
      await page.hover(rowSel);
      await new Promise(r => setTimeout(r, 180)); // > 120ms wash fade
      const rowHover = await page.evaluate(rowParts(partsExpr));
      check('task row hover shows the wash, symmetric −12px bleed, no reflow', () => {
        assert.equal(rowHover.opacity, '1');
        assert.equal(rowHover.bg, washColor, `wash ${rowHover.bg}`);
        assert.ok(Math.abs(parseFloat(rowHover.left) + 12) <= 1, `left ${rowHover.left}`);
        assert.ok(Math.abs(parseFloat(rowHover.right) + 12) <= 1, `right ${rowHover.right}`);
        assert.equal(parseFloat(rowHover.radius), 8, `radius ${rowHover.radius}`);
        for (const part of ['ring', 'title', 'meta', 'open']) {
          for (const k of ['x', 'y', 'width', 'height']) {
            assert.ok(Math.abs(rowHover.parts[part][k] - rowRest.parts[part][k]) <= 0.5,
              `${part}.${k}: ${rowRest.parts[part][k]} → ${rowHover.parts[part][k]}`);
          }
        }
        return true;
      });
      // Visual-inset symmetry: ring edge ↔ wash left equals the open button's
      // right edge ↔ wash right.
      const washAlign = await page.evaluate(`(() => {
        const row = document.querySelector(${JSON.stringify(rowSel)});
        const rr = row.getBoundingClientRect();
        const pcs = getComputedStyle(row, '::before');
        const washL = rr.left + parseFloat(pcs.left);
        const washR = rr.right - parseFloat(pcs.right);
        const ring = row.querySelector('.planner-check').getBoundingClientRect();
        const open = row.querySelector('.task-open').getBoundingClientRect();
        return { insetL: washL - (ring.left - 12) , bleedL: washL - rr.left, bleedR: washR - rr.right,
          insetR: open.right - washR };
      })()`);
      check('wash visual insets are symmetric (12px both sides)', () => {
        assert.ok(Math.abs(-washAlign.bleedL - 12) <= 0.5, `left bleed ${-washAlign.bleedL}`);
        assert.ok(Math.abs(washAlign.bleedR - 12) <= 0.5, `right bleed ${washAlign.bleedR}`);
        assert.ok(Math.abs(washAlign.insetR + 12) <= 1, `right inset ${washAlign.insetR}`);
        return true;
      });
      const symPitch = await page.evaluate(`(() => {
        const r2 = document.querySelector('#task-list .planner-task-row:nth-child(2)');
        const r3 = document.querySelector('#task-list .planner-task-row:nth-child(3)');
        const row = r2.getBoundingClientRect();
        const title = r2.querySelector('.planner-row-title').getBoundingClientRect();
        const meta = r2.querySelector('.planner-row-meta').getBoundingClientRect();
        return {
          topGap: title.top - row.top,
          bottomGap: row.bottom - meta.bottom,
          pitch: r3.getBoundingClientRect().top - row.top,
          content: meta.bottom - title.top
        };
      })()`);
      check('wash is vertically balanced; row pitch unchanged (content + 24)', () => {
        assert.ok(Math.abs(symPitch.topGap - symPitch.bottomGap) <= 1,
          `top ${symPitch.topGap} vs bottom ${symPitch.bottomGap}`);
        assert.ok(Math.abs(symPitch.pitch - symPitch.content - 24) <= 1,
          `pitch ${symPitch.pitch} vs content ${symPitch.content} + 24`);
        return true;
      });
      await page.mouse.move(10, 10);

      // Row keyboard-focus wash
      await page.evaluate(`document.querySelector('#task-list .planner-task-row:nth-child(2) .task-open').focus({ focusVisible: true })`);
      await new Promise(r => setTimeout(r, 180)); // > 120ms wash fade
      const focusWash = await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(rowSel)}), '::before').opacity`);
      check('task row keyboard focus shows the wash', () => (assert.equal(focusWash, '1'), true));
      await page.evaluate(`document.activeElement.blur?.()`);

      // Open event reveal
      const openSel = '#timeline-viewport .timeline-blk .icon-action';
      const openRest = await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(openSel)})).opacity`);
      check('Open event concealed at rest', () => (assert.equal(openRest, '0'), true));
      await page.hover('#timeline-viewport .timeline-blk');
      await new Promise(r => setTimeout(r, 60));
      const openHover = await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(openSel)})).opacity`);
      check('Open event visible on block hover', () => (assert.equal(openHover, '1'), true));
      await page.mouse.move(10, 10);

      // Back to now — floating over the timeline, shown only when the user has
      // anchored AND the Now marker is outside the visible rect.
      const btnState = `(() => {
        const b = document.getElementById('back-to-now-btn');
        const br = b.getBoundingClientRect();
        const vp = document.getElementById('timeline-viewport').getBoundingClientRect();
        const mk = document.querySelector('#timeline-viewport [data-timeline-now="true"]')?.getBoundingClientRect();
        return { visibility: getComputedStyle(b).visibility, tabindex: b.tabIndex,
          cx: br.x + br.width / 2, vpCx: vp.x + vp.width / 2, gapFromBottom: vp.bottom - br.bottom,
          markerTop: mk?.top, vpTop: vp.top, vpBottom: vp.bottom,
          direction: b.dataset.direction,
          hasSvg: !!b.querySelector('svg') };
      })()`;
      const btnHidden = await page.evaluate(`(() => {
        const b = document.getElementById('back-to-now-btn');
        return { visibility: getComputedStyle(b).visibility, tabindex: b.tabIndex };
      })()`);
      check('Back to now hidden at rest and unfocusable', () => {
        assert.equal(btnHidden.visibility, 'hidden');
        assert.equal(btnHidden.tabindex, -1);
        return true;
      });
      const schedLast = await page.evaluate(`(() => {
        const actions = [...document.querySelectorAll('#today-timeline-section .icon-actions > *')];
        const last = actions.at(-1);
        const main = document.querySelector('.main').getBoundingClientRect().right;
        return last.id === 'view-schedule-btn' && Math.abs(last.getBoundingClientRect().right - main) < 0.5;
      })()`);
      check('Calendar link is the last (rightmost) calendar heading action', () => {
        assert.equal(schedLast, true);
        return true;
      });
      // Reset the scroll to the centred marker before exercising the button —
      // earlier checks may have moved the viewport.
      await page.evaluate(`(() => {
        const vp = document.getElementById('timeline-viewport');
        const mk = vp.querySelector('[data-timeline-now="true"]');
        vp.scrollTop = Math.max(0, mk.getBoundingClientRect().top - vp.getBoundingClientRect().top + vp.scrollTop - vp.clientHeight * 0.4);
      })()`);
      // A wheel that keeps Now visible does not offer the button.
      await page.hover('#timeline-viewport');
      await page.mouse.wheel({ deltaY: -60 });
      await new Promise(r => setTimeout(r, 150));
      const stillHidden = await page.evaluate(`getComputedStyle(document.getElementById('back-to-now-btn')).visibility`);
      check('Back to now stays hidden while Now is in view', () => (assert.equal(stillHidden, 'hidden'), true));
      // Scroll Now out of view upward -> up-pointing glyph, centred, 12px off the bottom.
      await page.mouse.wheel({ deltaY: 900 });
      await new Promise(r => setTimeout(r, 200));
      const upState = await page.evaluate(btnState);
      check('Back to now appears centred 12px above the viewport bottom (Now above -> up arrow)', () => {
        assert.equal(upState.visibility, 'visible');
        assert.ok(upState.markerTop < upState.vpTop, `marker ${upState.markerTop} should be above viewport ${upState.vpTop}`);
        assert.equal(upState.direction, 'up', 'expected up-pointing glyph');
        assert.equal(upState.hasSvg, true);
        assert.ok(Math.abs(upState.cx - upState.vpCx) <= 1, `centre ${upState.cx} vs ${upState.vpCx}`);
        assert.ok(Math.abs(upState.gapFromBottom - 12) < 0.5, `bottom gap ${upState.gapFromBottom}`);
        return true;
      });
      // Scroll Now out of view downward -> down-pointing glyph.
      await page.mouse.wheel({ deltaY: -1600 });
      await new Promise(r => setTimeout(r, 200));
      const downState = await page.evaluate(btnState);
      check('Back to now flips to a down arrow when Now is below the viewport', () => {
        assert.equal(downState.visibility, 'visible');
        assert.ok(downState.markerTop > downState.vpBottom, `marker ${downState.markerTop} should be below viewport ${downState.vpBottom}`);
        assert.equal(downState.direction, 'down', 'expected down-pointing glyph');
        assert.equal(downState.hasSvg, true);
        return true;
      });
      // Tooltip above the button (hover — programmatic focus isn't reliably
      // :focus-visible).
      await page.hover('#back-to-now-btn');
      await new Promise(r => setTimeout(r, 100));
      const backTip = await page.evaluate(`(() => {
        const t = document.getElementById('planner-tooltip');
        const b = document.getElementById('back-to-now-btn').getBoundingClientRect();
        const tr = t.getBoundingClientRect();
        return { visible: t.classList.contains('is-visible'), text: t.textContent, above: tr.bottom <= b.top + 0.5,
          inView: tr.top >= 0 && tr.left >= 0 && tr.right <= innerWidth };
      })()`);
      check('Back to now tooltip sits above the button, inside the viewport', () => {
        assert.equal(backTip.visible, true); assert.equal(backTip.text, 'Back to now');
        assert.equal(backTip.above, true); assert.equal(backTip.inView, true);
        return true;
      });
      await page.mouse.move(10, 10);
      const s1 = await snap(page);
      check('Back to now + Calendar link rects unchanged when revealed', () => {
        assert.deepEqual({ x: s1.btn.x, w: s1.btn.width }, { x: s0.btn.x, w: s0.btn.width });
        assert.deepEqual({ x: s1.sched.x, w: s1.sched.width }, { x: s0.sched.x, w: s0.sched.width });
        return true;
      });
      await page.click('#back-to-now-btn');
      await new Promise(r => setTimeout(r, 400)); // > 150ms visibility transition
      const afterClick = await page.evaluate(`(() => {
        const b = document.getElementById('back-to-now-btn');
        const vp = document.getElementById('timeline-viewport').getBoundingClientRect();
        const mk = document.querySelector('#timeline-viewport [data-timeline-now="true"]')?.getBoundingClientRect();
        return { vis: getComputedStyle(b).visibility, focus: document.activeElement?.id,
          markerPct: mk ? (mk.top - vp.top) / vp.height : null };
      })()`);
      check('Back to now click recenters Now (~40%), hides, focuses the viewport', () => {
        assert.equal(afterClick.vis, 'hidden');
        assert.equal(afterClick.focus, 'timeline-viewport', `focus on ${afterClick.focus}`);
        assert.ok(Math.abs(afterClick.markerPct - 0.4) < 0.05, `marker at ${afterClick.markerPct}`);
        return true;
      });
      const s2 = await snap(page);
      check('no x/width drift through Back to now', () => {
        for (const key of ['main', 'tasks', 'cal', 'viewport', 'btn', 'sched']) {
          assert.ok(Math.abs(s2[key].x - s0[key].x) <= 0.5, `${key} x moved ${s0[key].x} -> ${s2[key].x}`);
          assert.ok(Math.abs(s2[key].width - s0[key].width) <= 0.5, `${key} width moved`);
        }
        return true;
      });

      // Overlay transition stability — quick-add bar (via the toolbar button)
      // and the edit modal (via a row's copy button).
      const sDrawer = {};
      await page.click('#add-task-btn');
      await new Promise(r => setTimeout(r, 350));
      sDrawer.quickadd = await snap(page);
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 350));
      await page.evaluate(`document.querySelector('#task-list .planner-task-row:nth-child(2) .task-open').click()`);
      await new Promise(r => setTimeout(r, 350));
      sDrawer.edit = await snap(page);
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 350));
      const sAfter = await snap(page);
      check('no x/width drift through quick-add spotlight and edit modal', () => {
        for (const [mode, snap_] of Object.entries(sDrawer)) {
          for (const key of ['main', 'tasks', 'cal', 'viewport']) {
            assert.ok(Math.abs(snap_[key].x - s0[key].x) <= 0.5, `${mode}: ${key} x moved ${s0[key].x} -> ${snap_[key].x}`);
            assert.ok(Math.abs(snap_[key].width - s0[key].width) <= 0.5, `${mode}: ${key} width moved`);
          }
        }
        for (const key of ['main', 'tasks', 'cal', 'viewport']) {
          assert.ok(Math.abs(sAfter[key].x - s0[key].x) <= 0.5, `${key} x moved on overlay close`);
        }
        return true;
      });

      // No page horizontal overflow
      check('no horizontal page overflow', () => {
        assert.ok(s0.scrollW <= s0.docW + 1, `scrollWidth ${s0.scrollW} > ${s0.docW}`);
        return true;
      });

      // hover:none via touch emulation (emulateMediaFeatures lacks
      // hover/pointer support in this Chrome)
      const coarsePage = await browser.newPage();
      await coarsePage.setViewport({ width, height, hasTouch: true });
      const cdp = await coarsePage.createCDPSession();
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await coarsePage.goto(`${URL_BASE}?preview-theme=${theme}`, { waitUntil: 'networkidle0' });
      await waitTasks(coarsePage);
      // hover:none: the hover wash is gated behind the (hover:hover) and
      // (pointer:fine) media query; keyboard focus still highlights.
      const hoverCapable = await coarsePage.evaluate(`matchMedia('(hover: hover) and (pointer: fine)').matches`);
      await coarsePage.evaluate(`document.querySelector(${JSON.stringify(rowSel)}).querySelector('.planner-check').focus({ focusVisible: true })`);
      await new Promise(r => setTimeout(r, 200)); // > 120ms wash fade
      const coarseFocused = await coarsePage.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(rowSel)}), '::before').opacity`);
      const coarseWash = { hoverCapable, focused: coarseFocused };
      check('hover:none: hover wash media-gated off, keyboard focus still washes', () => {
        assert.equal(coarseWash.hoverCapable, false, 'media should not match');
        assert.equal(coarseWash.focused, '1', `focused ${coarseWash.focused}`);
        return true;
      });
      await coarsePage.close();

      await browser.close();
    } catch (err) {
      console.error(`  FAIL ${label}: ${err.message}`);
      process.exitCode = 1;
      await browser.close();
    }
  }
}

// 200% zoom at 720x450 CSS px
{
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 720, height: 450 });
    await page.goto(URL_BASE, { waitUntil: 'networkidle0' });
    await page.evaluate(`document.body.style.zoom = 2`);
    await new Promise(r => setTimeout(r, 200));
    const s = await snap(page);
    console.log('\n[720x450 @200% zoom]');
    check('no horizontal page overflow at 200% zoom', () => {
      assert.ok(s.scrollW <= s.docW + 1, `scrollWidth ${s.scrollW} > ${s.docW}`);
      return true;
    });
  } catch (err) {
    console.error(`  FAIL zoom: ${err.message}`);
    process.exitCode = 1;
  }
  await browser.close();
}

// ---------------------------------------------------------------------------
// Phase 3 — frozen-clock fixtures, Part-A polish, edit modal
// ---------------------------------------------------------------------------

const FROZEN_URL = `${URL_BASE}?preview-now=2026-09-30T10:42`;

async function newFrozenPage(browser, width, height, theme = 'light') {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.goto(`${FROZEN_URL}&preview-theme=${theme}`, { waitUntil: 'networkidle0' });
  await waitTasks(page);
  return page;
}

{
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  try {
    // ---- Part A polish at 1440 light ----
    const page = await newFrozenPage(browser, 1440, 900);
    console.log('\n[p3 1440 light — part A polish]');

    const paper = await page.evaluate(`getComputedStyle(document.documentElement).backgroundColor`);
    check('html background is newtab paper (gutters invisible)', () => {
      assert.equal(paper, 'rgb(250, 250, 250)');
      return true;
    });

    const clock = await page.evaluate(`(() => {
      const parts = [...document.querySelectorAll('#clock .clock-part, #clock .clock-separator')];
      return parts.map(el => ({ r: el.getBoundingClientRect().toJSON(), color: getComputedStyle(el).color }));
    })()`);
    check('clock renders 10:42 with no gaps and ink colon', () => {
      assert.equal(clock.length, 3);
      assert.ok(Math.abs(clock[0].r.right - clock[1].r.x) < 1, 'gap before colon');
      assert.ok(Math.abs(clock[1].r.right - clock[2].r.x) < 1, 'gap after colon');
      assert.equal(clock[1].color, clock[0].color, 'colon colour differs from digits');
      return true;
    });

    const weatherRects = await page.evaluate(`(() => {
      const ids = ['weather-icon', 'weather-temp', 'weather-desc', 'weather-highlow'];
      return ids.map(id => {
        const el = document.getElementById(id);
        return el && el.offsetParent !== null ? { t: el.textContent.trim(), r: el.getBoundingClientRect().toJSON() } : null;
      }).filter(Boolean);
    })()`);
    check('weather reads "21°  Partly cloudy · H 24° · L 16°"', () => {
      assert.equal(weatherRects.length, 4, JSON.stringify(weatherRects));
      assert.equal(weatherRects[1].t, '21°');
      assert.equal(weatherRects[2].t, 'Partly cloudy');
      assert.equal(weatherRects[3].t, '· H 24° · L 16°');
      return true;
    });
    const weatherGap = await page.evaluate(`(() => {
      const desc = document.getElementById('weather-desc');
      const hl = document.getElementById('weather-highlow');
      const descRange = document.createRange();
      descRange.selectNodeContents(desc.firstChild || desc);
      const descEnd = descRange.getBoundingClientRect().right;
      // Range over the leading '·' glyph
      const hlText = hl.firstChild;
      const dot = document.createRange();
      dot.setStart(hlText, 0); dot.setEnd(hlText, 1);
      const dotStart = dot.getBoundingClientRect().left;
      // A real rendered space as the reference: '· H 24°' → the space after 'H'
      const space = document.createRange();
      space.setStart(hlText, 3); space.setEnd(hlText, 4);
      const spaceW = space.getBoundingClientRect().width;
      return { gap: dotStart - descEnd, spaceW };
    })()`);
    check('gap before the weather "·" is ≤ one rendered space width', () => {
      assert.ok(weatherGap.spaceW > 1, `reference space width ${weatherGap.spaceW}`);
      assert.ok(weatherGap.gap <= weatherGap.spaceW + 0.5, `gap ${weatherGap.gap}px vs space ${weatherGap.spaceW}px`);
      return true;
    });

    const edges = await page.evaluate(`(() => {
      const main = document.querySelector('.main').getBoundingClientRect().right;
      const toolbar = document.querySelector('#tasks-section .icon-actions').getBoundingClientRect().right;
      const open = document.querySelector('#task-list .task-open').getBoundingClientRect().right;
      const cal = document.querySelector('#today-timeline-section .icon-actions').getBoundingClientRect().right;
      return { main, toolbar, open, cal };
    })()`);
    check('toolbar, task copy, and calendar actions all end at the column edge', () => {
      for (const [k, v] of Object.entries(edges)) {
        if (k === 'main') continue;
        assert.ok(Math.abs(v - edges.main) < 0.5, `${k} ends at ${v}, column at ${edges.main}`);
      }
      return true;
    });

    const geo = await page.evaluate(`(() => ({
      tools: document.querySelector('#tasks-section .icon-action').getBoundingClientRect().y,
      title1: document.querySelector('#task-list .planner-row-title').getBoundingClientRect().y
    }))()`);
    check('toolbar y ≈172 and first title y ≈229 (ring-clearance rhythm, ±4px)', () => {
      assert.ok(Math.abs(geo.tools - 172) <= 4, `toolbar ${geo.tools}`);
      assert.ok(Math.abs(geo.title1 - 229) <= 4, `title1 ${geo.title1}`);
      return true;
    });

    // ---- Toolbar links ---------------------------------------------------
    const links = await page.evaluate(`(() => {
      const pick = id => {
        const el = document.getElementById(id);
        return { tag: el.tagName, href: el.getAttribute('href'), target: el.target, rel: el.rel,
          label: el.getAttribute('aria-label'), tip: el.getAttribute('data-tooltip-label') };
      };
      return { todoist: pick('view-tasks-btn'), gcal: pick('view-schedule-btn'),
        add: { tag: document.getElementById('add-task-btn').tagName,
          label: document.getElementById('add-task-btn').getAttribute('aria-label') } };
    })()`);
    check('toolbar: Todoist + Google Calendar external links, Add task keeps ⌘K label', () => {
      assert.equal(links.todoist.tag, 'A');
      assert.equal(links.todoist.href, 'https://app.todoist.com/app/today');
      assert.equal(links.todoist.target, '_blank');
      assert.equal(links.todoist.rel, 'noreferrer');
      assert.equal(links.todoist.label, 'Open Todoist (opens in new tab)');
      assert.equal(links.gcal.tag, 'A');
      assert.equal(links.gcal.href, 'https://calendar.google.com/calendar/r/day');
      assert.equal(links.gcal.target, '_blank');
      assert.equal(links.gcal.rel, 'noreferrer');
      assert.equal(links.gcal.label, 'Open Google Calendar (opens in new tab)');
      assert.equal(links.add.tag, 'BUTTON');
      assert.match(links.add.label, /^Add task \((⌘K|Ctrl\+K)\)$/, links.add.label);
      return true;
    });

    // Block / all-day chip Open icons are real links to the event's htmlLink.
    const openLinks = await page.evaluate(`(() => {
      const block = document.querySelector('#timeline-viewport .timeline-blk .icon-action');
      const chip = document.querySelector('#timeline-all-day .timeline-ad .icon-action');
      const pick = a => a && { tag: a.tagName, href: a.getAttribute('href'), target: a.target,
        rel: a.rel, label: a.getAttribute('aria-label') };
      return { block: pick(block), chip: pick(chip) };
    })()`);
    check('block and all-day Open icons link to the event htmlLink', () => {
      for (const [name, link] of Object.entries(openLinks)) {
        assert.ok(link, `${name} link missing`);
        assert.equal(link.tag, 'A', name);
        assert.match(link.href, /^https:\/\/calendar\.google\.com\/calendar\/event\?eid=/, `${name} href ${link.href}`);
        assert.equal(link.target, '_blank', name);
        assert.equal(link.rel, 'noreferrer', name);
        assert.match(link.label, / in Google Calendar \(opens in new tab\)$/, `${name} label ${link.label}`);
      }
      return true;
    });

    // ---- Quick Add spotlight ----------------------------------------------
    console.log('\n[p3 1440 light — quick add spotlight]');
    const mainRest = await page.evaluate(`(() => ({
      rect: document.querySelector('.main').getBoundingClientRect().toJSON()
    }))()`);
    await page.click('#add-task-btn');
    await new Promise(r => setTimeout(r, 350));
    const qa = await page.evaluate(`(() => {
      const overlay = document.getElementById('quick-add');
      const panel = document.querySelector('.quick-add-panel').getBoundingClientRect().toJSON();
      const input = document.getElementById('quick-add-input');
      return {
        visible: !overlay.classList.contains('hidden'),
        panel,
        innerW: window.innerWidth,
        topPct: panel.top / window.innerHeight,
        focused: document.activeElement?.id,
        role: input.getAttribute('role'), expanded: input.getAttribute('aria-expanded'),
        controls: input.getAttribute('aria-controls'),
        placeholder: input.placeholder,
        hint: document.getElementById('quick-add-foot').textContent,
        spinnerHidden: document.getElementById('quick-add-spinner').hidden,
        spinnerVis: getComputedStyle(document.getElementById('quick-add-spinner')).visibility,
        noFlags: !document.querySelector('#quick-add .qa-flag'),
        modal: document.querySelector('.quick-add-panel').getAttribute('aria-modal'),
        glyph: !!document.querySelector('#quick-add-glyph svg')
      };
    })()`);
    check('spotlight opens centred at ~20vh with the input focused', () => {
      assert.equal(qa.visible, true);
      assert.equal(qa.modal, 'true');
      const cx = qa.panel.x + qa.panel.width / 2;
      const usableCx = mainRest.rect.x + mainRest.rect.width / 2; // column centre = usable-area centre
      assert.ok(Math.abs(cx - usableCx) <= 1, `panel centre ${cx} vs usable centre ${usableCx}`);
      assert.ok(Math.abs(qa.topPct - 0.2) <= 0.02, `top at ${qa.topPct} of viewport`);
      assert.equal(Math.round(qa.panel.width), 640, `panel width ${qa.panel.width}`);
      assert.equal(qa.focused, 'quick-add-input');
      assert.equal(qa.role, 'combobox');
      assert.equal(qa.glyph, true, 'leading plus glyph missing');
      assert.equal(qa.spinnerHidden, true);
      assert.equal(qa.spinnerVis, 'hidden', `spinner visible at rest: ${qa.spinnerVis}`);
      assert.equal(qa.noFlags, true, 'P1–P4 toggles must be gone from the spotlight');
      assert.ok(/#Work/.test(qa.placeholder), qa.placeholder);
      assert.match(qa.hint, /Enter to add · Esc to close/);
      return true;
    });
    const mainOpen = await page.evaluate(`document.querySelector('.main').getBoundingClientRect().toJSON()`);
    check('.main x/width unchanged with the spotlight open', () => {
      assert.ok(Math.abs(mainOpen.x - mainRest.rect.x) <= 0.5 && Math.abs(mainOpen.width - mainRest.rect.width) <= 0.5);
      return true;
    });

    // Autocomplete renders inside the panel; Enter accepts without submitting.
    await page.type('#quick-add-input', 'Write report tomorrow 4pm #Foc');
    await new Promise(r => setTimeout(r, 250));
    const sug = await page.evaluate(`(() => {
      const list = document.getElementById('quick-add-suggest');
      const panel = document.querySelector('.quick-add-panel');
      return {
        open: !!list && !list.hidden,
        inside: panel.contains(list),
        expanded: document.getElementById('quick-add-input').getAttribute('aria-expanded'),
        options: list ? [...list.querySelectorAll('[role="option"]')].map(o => o.textContent) : [],
        spinnerVis: getComputedStyle(document.getElementById('quick-add-spinner')).visibility
      };
    })()`);
    check('# autocomplete lists shim projects inside the panel', () => {
      assert.equal(sug.open, true);
      assert.equal(sug.inside, true, 'suggestion list not inside the panel');
      assert.equal(sug.expanded, 'true');
      assert.ok(sug.options.includes('Focus extension'), sug.options.join(', '));
      assert.ok(sug.options.includes('Focus extension / Side quests'), sug.options.join(', '));
      assert.equal(sug.spinnerVis, 'hidden', `spinner visible while typing: ${sug.spinnerVis}`);
      return true;
    });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 150));
    const afterPick = await page.evaluate(`(() => ({
      value: document.getElementById('quick-add-input').value,
      open: !document.getElementById('quick-add-suggest').hidden,
      foot: document.getElementById('quick-add-foot').textContent,
      overlay: !document.getElementById('quick-add').classList.contains('hidden')
    }))()`);
    check('ArrowDown+Enter inserts the raw project name without submitting', () => {
      assert.ok(afterPick.value.includes('#Focus extension '), afterPick.value);
      assert.ok(!afterPick.value.includes('\\'), `no escape backslashes in the input: ${afterPick.value}`);
      assert.equal(afterPick.open, false);
      assert.equal(afterPick.overlay, true);
      assert.ok(!/Added/.test(afterPick.foot), `foot: "${afterPick.foot}"`);
      return true;
    });
    // Escape order: suggestion list first, then the bar.
    await page.type('#quick-add-input', '@');
    await new Promise(r => setTimeout(r, 250));
    const listOpen = await page.evaluate(`!document.getElementById('quick-add-suggest').hidden`);
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 150));
    const esc1 = await page.evaluate(`(() => ({
      open: !document.getElementById('quick-add-suggest').hidden,
      overlay: !document.getElementById('quick-add').classList.contains('hidden')
    }))()`);
    check('Escape closes the suggestion list first, not the spotlight', () => {
      assert.equal(listOpen, true, 'list never opened for @');
      assert.equal(esc1.open, false);
      assert.equal(esc1.overlay, true);
      return true;
    });
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 250));
    const esc2 = await page.evaluate(`(() => ({
      overlay: !document.getElementById('quick-add').classList.contains('hidden'),
      focus: document.activeElement?.id
    }))()`);
    check('second Escape closes the spotlight and returns focus to the + button', () => {
      assert.equal(esc2.overlay, false);
      assert.equal(esc2.focus, 'add-task-btn');
      return true;
    });
    // Backdrop click closes.
    await page.click('#add-task-btn');
    await new Promise(r => setTimeout(r, 250));
    await page.click('#quick-add-backdrop');
    await new Promise(r => setTimeout(r, 250));
    const backdropClosed = await page.evaluate(`document.getElementById('quick-add').classList.contains('hidden')`);
    check('clicking the backdrop closes the spotlight', () => (assert.equal(backdropClosed, true), true));
    // ⌘K opens it too.
    await page.keyboard.down('Meta');
    await page.keyboard.press('k');
    await page.keyboard.up('Meta');
    await new Promise(r => setTimeout(r, 250));
    const viaKey = await page.evaluate(`(() => ({
      overlay: !document.getElementById('quick-add').classList.contains('hidden'),
      focus: document.activeElement?.id
    }))()`);
    check('⌘K opens the spotlight with the input focused', () => {
      assert.equal(viaKey.overlay, true);
      assert.equal(viaKey.focus, 'quick-add-input');
      return true;
    });
    // Submit via Enter: confirmation from the returned task + Todoist link.
    await page.type('#quick-add-input', 'Review PR tomorrow 4pm p2');
    // The submit handler shows the spinner synchronously before awaiting, so
    // a same-tick read always observes the pending state.
    const pendingSpin = await page.evaluate(`(() => {
      const s = document.getElementById('quick-add-spinner');
      document.getElementById('quick-add-form').requestSubmit();
      return { vis: getComputedStyle(s).visibility, hiddenAttr: s.hidden,
        busy: document.getElementById('quick-add-form').getAttribute('aria-busy'),
        disabled: document.getElementById('quick-add-input').disabled };
    })()`);
    check('spinner is visible only while the quick add is pending', () => {
      assert.equal(pendingSpin.busy, 'true', 'form never entered pending');
      assert.equal(pendingSpin.hiddenAttr, false, 'hidden attribute still set while pending');
      assert.equal(pendingSpin.vis, 'visible', `pending spinner ${pendingSpin.vis}`);
      assert.equal(pendingSpin.disabled, true, 'input not disabled while pending');
      return true;
    });
    await new Promise(r => setTimeout(r, 800));
    const added = await page.evaluate(`(() => {
      const foot = document.getElementById('quick-add-foot');
      const link = foot.querySelector('.quick-add-link');
      return {
        text: foot.textContent,
        linkText: link?.textContent, href: link?.href, target: link?.target, rel: link?.rel,
        value: document.getElementById('quick-add-input').value,
        focused: document.activeElement?.id,
        spinnerHidden: document.getElementById('quick-add-spinner').hidden,
        spinnerVis: getComputedStyle(document.getElementById('quick-add-spinner')).visibility
      };
    })()`);
    check('successful Quick Add confirms from the returned task with a Todoist link', () => {
      assert.ok(/Added "Review PR"/.test(added.text), added.text);
      assert.ok(/P2/.test(added.text), added.text);
      assert.equal(added.linkText, 'Open in Todoist');
      assert.match(added.href || '', /^https:\/\/app\.todoist\.com\/app\/task\//, added.href);
      assert.equal(added.target, '_blank');
      assert.equal(added.rel, 'noreferrer');
      assert.equal(added.value, '');
      assert.equal(added.focused, 'quick-add-input');
      assert.equal(added.spinnerHidden, true);
      assert.equal(added.spinnerVis, 'hidden', `spinner visible after success: ${added.spinnerVis}`);
      return true;
    });
    await new Promise(r => setTimeout(r, 900)); // ~1.7s post-submit
    const addedLater = await page.evaluate(`(() => ({
      text: document.getElementById('quick-add-foot').textContent,
      link: document.getElementById('quick-add-foot').querySelector('.quick-add-link')?.textContent
    }))()`);
    check('Quick Add confirmation persists past the task-data refresh', () => {
      assert.ok(/Added "Review PR"/.test(addedLater.text), addedLater.text);
      assert.equal(addedLater.link, 'Open in Todoist');
      return true;
    });
    // Typing again restores the hint.
    await page.type('#quick-add-input', 'x');
    await new Promise(r => setTimeout(r, 150));
    const hintBack = await page.evaluate(`document.getElementById('quick-add-foot').textContent`);
    check('typing again restores the hint line', () => {
      assert.match(hintBack, /Enter to add · Esc to close/, hintBack);
      return true;
    });
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 250));
    const mainAfter = await page.evaluate(`document.querySelector('.main').getBoundingClientRect().toJSON()`);
    check('.main x/width unchanged after the spotlight closes', () => {
      assert.ok(Math.abs(mainAfter.x - mainRest.rect.x) <= 0.5 && Math.abs(mainAfter.width - mainRest.rect.width) <= 0.5);
      return true;
    });

    // ---- Edit modal from a home row's copy area ---------------------------
    console.log('\n[p3 1440 light — edit modal]');
    const rowTask = await page.evaluate(`(() => {
      const row = [...document.querySelectorAll('#task-list .planner-task-row')]
        .find(r => r.querySelector('.planner-row-title')?.textContent === 'Finish the blocked-page restyle');
      return { id: row?.dataset.taskId, hasOpen: !!row?.querySelector('.task-open') };
    })()`);
    // Real pointer click → the modal records a mouse open (focus returns
    // without a :focus-visible ring on close).
    await page.click(`#task-list .planner-task-row[data-task-id="${rowTask.id}"] .task-open`);
    await new Promise(r => setTimeout(r, 500));
    const edit = await page.evaluate(`(() => ({
      hidden: document.getElementById('edit-modal').classList.contains('hidden'),
      title: document.getElementById('edit-modal-title').textContent,
      submitText: document.querySelector('#edit-modal-body .edit-save')?.textContent.trim(),
      submitDisabled: document.querySelector('#edit-modal-body .edit-save')?.disabled,
      panel: (() => { const p = document.querySelector('.edit-modal-panel').getBoundingClientRect();
        return { x: p.x, y: p.y, w: p.width, h: p.height, cx: p.x + p.width / 2, cy: p.y + p.height / 2,
          vw: innerWidth, vh: innerHeight }; })(),
      glyphGone: !document.querySelector('#edit-modal-body .task-submit'),
      content: document.getElementById('planner-edit-title')?.value,
      descRows: document.getElementById('planner-edit-desc')?.rows,
      due: document.getElementById('planner-edit-due')?.value,
      flags: [...document.querySelectorAll('#edit-modal-body .qa-flag')].map(b => b.getAttribute('aria-pressed')),
      project: document.getElementById('planner-edit-project')?.value,
      projectOptions: [...(document.getElementById('planner-edit-project')?.options || [])].map(o => o.textContent),
      labels: [...document.querySelectorAll('#edit-modal-body .qa-label-chip')].map(c => ({ text: c.textContent, pressed: c.getAttribute('aria-pressed') })),
      oldWording: [...document.querySelectorAll('#edit-modal-body option')].some(o => /Normal|Medium|High|Urgent/.test(o.textContent)),
      openName: (() => { const b = [...document.querySelectorAll('#task-list .task-open')]; return b.length && b[0].getAttribute('aria-label'); })()
    }))()`);
    check('row copy is a named button that opens the centred edit modal', () => {
      assert.equal(rowTask.hasOpen, true);
      assert.equal(edit.hidden, false, 'modal did not open');
      assert.equal(edit.title, 'Edit task');
      assert.ok(edit.openName.length > 0, 'row button has no accessible name');
      return true;
    });
    check('edit modal is centred (±1px), 560px panel, Save disabled until dirty', () => {
      assert.ok(Math.abs(edit.panel.cx - edit.panel.vw / 2) <= 1, `cx ${edit.panel.cx} vs ${edit.panel.vw / 2}`);
      assert.ok(Math.abs(edit.panel.cy - edit.panel.vh / 2) <= 1, `cy ${edit.panel.cy} vs ${edit.panel.vh / 2}`);
      assert.equal(edit.panel.w, 560);
      assert.equal(edit.submitText, 'Save');
      assert.equal(edit.submitDisabled, true, 'Save should be disabled before any change');
      return true;
    });
    check('edit form prefills content, description, due.string, priority, project, labels', () => {
      assert.equal(edit.content, 'Finish the blocked-page restyle');
      assert.equal(edit.descRows, 3);
      assert.equal(edit.due, 'today');
      assert.deepEqual(edit.flags, ['true', 'false', 'false', 'false'], 'priority 4 → P1 pressed');
      assert.equal(edit.project, 'p2');
      assert.ok(edit.projectOptions.includes('Focus extension / Side quests'), edit.projectOptions.join(', '));
      assert.equal(edit.labels.find(l => l.text === 'deep-work')?.pressed, 'true');
      assert.equal(edit.labels.find(l => l.text === 'quick')?.pressed, 'false');
      return true;
    });
    const editSweep = await page.evaluate(DRAWER_SWEEP);
    check('edit modal: no Hanken/modernist palette leftovers', () => {
      assert.deepEqual(editSweep, [], editSweep.join('; '));
      return true;
    });
    // Focused modal field keeps the 2px ink ring (no modernist red glow).
    await page.evaluate(`document.getElementById('planner-edit-title').focus()`);
    await new Promise(r => setTimeout(r, 250));
    const fieldRing = await page.evaluate(`(() => {
      const cs = getComputedStyle(document.getElementById('planner-edit-title'));
      return { border: cs.borderColor, shadow: cs.boxShadow, ow: cs.outlineWidth, oc: cs.outlineColor,
        fv: document.getElementById('planner-edit-title').matches(':focus-visible') };
    })()`);
    check('focused modal field: ink border + 2px ink ring, no red glow', () => {
      assert.equal(fieldRing.border, 'rgb(31, 31, 31)', `border ${fieldRing.border}`);
      assert.equal(fieldRing.shadow, 'none', `shadow ${fieldRing.shadow}`);
      if (fieldRing.fv) {
        assert.equal(fieldRing.ow, '2px');
        assert.equal(fieldRing.oc, 'rgb(31, 31, 31)');
      }
      return true;
    });
    // Round-trip: change description, due (NLP), priority, project, label.
    await page.evaluate(`(() => {
      const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      set(document.getElementById('planner-edit-desc'), 'Ship it this week');
      set(document.getElementById('planner-edit-due'), 'today 6pm');
      [...document.querySelectorAll('#edit-modal-body .qa-flag')][2].click();
      [...document.querySelectorAll('#edit-modal-body .qa-label-chip')].find(c => c.textContent === 'quick').click();
      const project = document.getElementById('planner-edit-project');
      project.value = 'p3';
      project.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const editPending = await page.evaluate(`(() => {
      const s = document.querySelector('#edit-modal-body .edit-save');
      s.click();
      return { disabledDuring: s.disabled,
        text: s.textContent.trim(),
        spinner: !!s.querySelector('.planner-spinner'),
        busy: document.querySelector('.edit-modal-panel')?.getAttribute('aria-busy'),
        inert: document.getElementById('edit-modal-body').inert };
    })()`);
    check('edit submit: spinner + "Saving…", fields inert, panel aria-busy', () => {
      assert.equal(editPending.disabledDuring, true);
      assert.equal(editPending.text, 'Saving…');
      assert.equal(editPending.spinner, true);
      assert.equal(editPending.busy, 'true');
      assert.equal(editPending.inert, true);
      return true;
    });
    await new Promise(r => setTimeout(r, 700));
    const afterSave = await page.evaluate(`(() => {
      const row = [...document.querySelectorAll('#task-list .planner-task-row')]
        .find(r => r.dataset.taskId === ${JSON.stringify(rowTask.id)});
      return {
        hidden: document.getElementById('edit-modal').classList.contains('hidden'),
        focusClass: document.activeElement?.className || '',
        focusTaskId: document.activeElement?.closest?.('.planner-task-row')?.dataset?.taskId || '',
        focusVisible: document.activeElement?.matches?.(':focus-visible') ?? null,
        washRing: row ? getComputedStyle(row, '::before').boxShadow : '',
        toast: document.getElementById('nt-toast')?.textContent.trim(),
        toastHidden: document.getElementById('nt-toast')?.classList.contains('hidden'),
        flashed: row?.classList.contains('is-flash') ? row.dataset.taskId : ''
      };
    })()`);
    check('save closes the modal, returns focus, shows toast + row flash', () => {
      assert.equal(afterSave.hidden, true, 'modal still open after save');
      assert.equal(afterSave.focusTaskId, rowTask.id, `focus task ${afterSave.focusTaskId} vs ${rowTask.id}`);
      assert.ok(/task-open/.test(afterSave.focusClass), `focused ${afterSave.focusClass}`);
      assert.equal(afterSave.toast, 'Task updated', `toast ${afterSave.toast}`);
      assert.equal(afterSave.toastHidden, false);
      assert.equal(afterSave.flashed, rowTask.id, `flashed ${afterSave.flashed}`);
      return true;
    });
    check('mouse-initiated save lands focus without the visible ring', () => {
      assert.equal(afterSave.focusVisible, false, 'focus-visible set after mouse save');
      assert.ok(!/inset.*2px/.test(afterSave.washRing), `wash ring ${afterSave.washRing}`);
      return true;
    });
    // Reopen by title to verify the round-trip through the shim.
    await page.evaluate(`(() => {
      const row = [...document.querySelectorAll('#task-list .planner-task-row')]
        .find(r => r.querySelector('.planner-row-title')?.textContent === 'Finish the blocked-page restyle');
      row.querySelector('.task-open').click();
    })()`);
    await new Promise(r => setTimeout(r, 500));
    const rt = await page.evaluate(`(() => ({
      desc: document.getElementById('planner-edit-desc')?.value,
      due: document.getElementById('planner-edit-due')?.value,
      flags: [...document.querySelectorAll('#edit-modal-body .qa-flag')].map(b => b.getAttribute('aria-pressed')),
      project: document.getElementById('planner-edit-project')?.value,
      labels: [...document.querySelectorAll('#edit-modal-body .qa-label-chip')].map(c => ({ text: c.textContent, pressed: c.getAttribute('aria-pressed') }))
    }))()`);
    check('due_string/description/priority/labels/project round-trip through the shim', () => {
      assert.equal(rt.desc, 'Ship it this week');
      assert.equal(rt.due, 'today 6pm', 'due_string echoed back via due.string');
      assert.deepEqual(rt.flags, ['false', 'false', 'true', 'false'], 'P3 → api priority 2');
      assert.equal(rt.project, 'p3', 'moveTask applied');
      assert.equal(rt.labels.find(l => l.text === 'quick')?.pressed, 'true');
      assert.equal(rt.labels.find(l => l.text === 'deep-work')?.pressed, 'true');
      return true;
    });
    // Keyboard-initiated save (Enter in the Task field) restores the row's
    // :focus-visible state — rendered as the wash + 2px ink ring on the
    // wash edge, not an outline hugging the text.
    await page.evaluate(`document.getElementById('planner-edit-title').focus()`);
    await page.evaluate(`(() => {
      const t = document.getElementById('planner-edit-title');
      t.value = 'Finish the blocked-page restyle — keyboard edit';
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 800));
    const kbdSave = await page.evaluate(`(() => {
      const row = [...document.querySelectorAll('#task-list .planner-task-row')]
        .find(r => r.dataset.taskId === ${JSON.stringify(rowTask.id)});
      const open = document.activeElement;
      return {
        hidden: document.getElementById('edit-modal').classList.contains('hidden'),
        isTaskOpen: open?.classList?.contains('task-open') && open.closest('.planner-task-row')?.dataset.taskId === ${JSON.stringify(rowTask.id)},
        focusVisible: open?.matches?.(':focus-visible') ?? null,
        washRing: row ? getComputedStyle(row, '::before').boxShadow : '',
        outline: open ? getComputedStyle(open).outlineWidth + ' ' + getComputedStyle(open).outlineStyle : ''
      };
    })()`);
    check('keyboard save: focus-visible ring = wash edge (inset 2px ink), no text outline', () => {
      assert.equal(kbdSave.hidden, true, 'modal still open');
      assert.equal(kbdSave.isTaskOpen, true, `focused ${kbdSave.isTaskOpen}`);
      assert.equal(kbdSave.focusVisible, true, 'no :focus-visible after Enter save');
      assert.match(kbdSave.washRing, /inset/, `wash ring ${kbdSave.washRing}`);
      assert.match(kbdSave.washRing, /rgb\(31, 31, 31\)/, `ring colour ${kbdSave.washRing}`);
      assert.match(kbdSave.outline, /none$/, `button outline ${kbdSave.outline}`);
      return true;
    });
    // Reopen for the due-clearing save.
    await page.evaluate(`(() => {
      const row = [...document.querySelectorAll('#task-list .planner-task-row')]
        .find(r => r.dataset.taskId === ${JSON.stringify(rowTask.id)});
      row.querySelector('.task-open').click();
    })()`);
    await new Promise(r => setTimeout(r, 500));
    // Clearing the due field sends "no date" — and when the row leaves the
    // home list, focus falls back to the Add button.
    await page.evaluate(`(() => {
      const el = document.getElementById('planner-edit-due');
      el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#edit-modal-body .edit-save').click();
    })()`);
    await new Promise(r => setTimeout(r, 900));
    const clearedFocus = await page.evaluate(`(() => {
      const row = [...document.querySelectorAll('#task-list .planner-task-row')]
        .find(r => r.dataset.taskId === ${JSON.stringify(rowTask.id)});
      return {
        hidden: document.getElementById('edit-modal').classList.contains('hidden'),
        rowGone: !row,
        focusId: document.activeElement?.id || '',
        focusTaskId: document.activeElement?.closest?.('.planner-task-row')?.dataset?.taskId || ''
      };
    })()`);
    check('save closes the modal; missing row falls back to the Add button', () => {
      assert.equal(clearedFocus.hidden, true, 'modal still open');
      if (clearedFocus.rowGone) assert.equal(clearedFocus.focusId, 'add-task-btn', `focused ${clearedFocus.focusId}`);
      else assert.equal(clearedFocus.focusTaskId, rowTask.id, `focus task ${clearedFocus.focusTaskId}`);
      return true;
    });

    // ---- Dirty-state lifecycle: change → Save on; revert → Save off ----
    await page.evaluate(`document.querySelector('#task-list .planner-task-row .task-open').click()`);
    await new Promise(r => setTimeout(r, 500));
    const dirty = await page.evaluate(`(() => {
      const save = () => document.querySelector('#edit-modal-body .edit-save').disabled;
      const title = document.getElementById('planner-edit-title');
      const input = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      const original = title.value;
      const before = save();
      input(title, original + ' x');
      const changed = save();
      input(title, original);
      const reverted = save();
      return { before, changed, reverted };
    })()`);
    check('Save disabled pristine → enabled on change → disabled on revert', () => {
      assert.equal(dirty.before, true);
      assert.equal(dirty.changed, false);
      assert.equal(dirty.reverted, true);
      return true;
    });

    // Focus trap: Tab on the last focusable wraps to the first.
    const trap = await page.evaluate(`(() => {
      const scope = document.querySelector('.edit-modal-panel');
      const focusable = [...scope.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')]
        .filter(el => el.getBoundingClientRect().width > 0);
      const last = focusable.at(-1);
      last.focus();
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      // The document-level handler wraps focus.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      return { active: document.activeElement === focusable[0], n: focusable.length };
    })()`);
    check('edit modal focus trap wraps from last to first', () => {
      assert.ok(trap.n > 3, `only ${trap.n} focusable`);
      assert.equal(trap.active, true);
      return true;
    });

    // Escape discards the edit and closes.
    const escDiscard = await page.evaluate(`(() => {
      const title = document.getElementById('planner-edit-title');
      const original = title.value;
      title.value = original + ' (discarded)';
      title.dispatchEvent(new Event('input', { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { hidden: document.getElementById('edit-modal').classList.contains('hidden'),
        savedContent: [...document.querySelectorAll('#task-list .planner-row-title')].map(t => t.textContent).join('|') };
    })()`);
    check('Escape discards edits and closes the modal', () => {
      assert.equal(escDiscard.hidden, true, 'modal still open after Escape');
      assert.ok(!/discarded/.test(escDiscard.savedContent), 'discard leaked into list');
      return true;
    });

    // ⌘Enter saves from inside the modal.
    await page.evaluate(`document.querySelector('#task-list .planner-task-row .task-open').click()`);
    await new Promise(r => setTimeout(r, 500));
    const cmdSave = await page.evaluate(`(() => {
      const title = document.getElementById('planner-edit-title');
      title.value = title.value + ' (cmd)';
      title.dispatchEvent(new Event('input', { bubbles: true }));
      title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
      return { pending: document.querySelector('#edit-modal-body .edit-save').textContent.trim() };
    })()`);
    check('⌘Enter inside the modal triggers save', () => {
      assert.equal(cmdSave.pending, 'Saving…', `save text ${cmdSave.pending}`);
      return true;
    });
    await new Promise(r => setTimeout(r, 800));
    const cmdResult = await page.evaluate(`(() => ({
      hidden: document.getElementById('edit-modal').classList.contains('hidden'),
      saved: [...document.querySelectorAll('#task-list .planner-row-title')].some(t => /\\(cmd\\)/.test(t.textContent))
    }))()`);
    check('⌘Enter save persisted via the shim', () => {
      assert.equal(cmdResult.hidden, true, 'modal still open');
      assert.equal(cmdResult.saved, true, 'edited title missing');
      return true;
    });
    await page.close();

    // ---- Failure: mutation-fail fixture keeps the modal open with values ----
    const failPage = await browser.newPage();
    await failPage.setViewport({ width: 1440, height: 900 });
    await failPage.goto(`${URL_BASE}?preview-now=2026-09-30T10:42&preview-fixture=mutation-fail`, { waitUntil: 'networkidle0' });
    await waitTasks(failPage);
    console.log('\n[p3 1440 light — edit save failure]');
    await failPage.evaluate(`document.querySelector('#task-list .planner-task-row .task-open').click()`);
    await new Promise(r => setTimeout(r, 500));
    await failPage.evaluate(`(() => {
      const title = document.getElementById('planner-edit-title');
      title.value = title.value + ' (unsaved)';
      title.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#edit-modal-body .edit-save').click();
    })()`);
    await new Promise(r => setTimeout(r, 800));
    const failState = await failPage.evaluate(`(() => ({
      hidden: document.getElementById('edit-modal').classList.contains('hidden'),
      kept: /\\(unsaved\\)/.test(document.getElementById('planner-edit-title')?.value || ''),
      error: document.getElementById('edit-modal-error')?.textContent.trim(),
      errorHidden: document.getElementById('edit-modal-error')?.hidden,
      saveDisabled: document.querySelector('#edit-modal-body .edit-save')?.disabled
    }))()`);
    check('save failure keeps the modal, values, and error text', () => {
      assert.equal(failState.hidden, false, 'modal closed on failure');
      assert.equal(failState.kept, true, 'edited value lost');
      assert.equal(failState.errorHidden, false);
      assert.equal(failState.error, "Couldn't save — check your connection and try again.");
      assert.equal(failState.saveDisabled, false, 'Save not re-enabled');
      return true;
    });
    await failPage.close();

    // ---- Focus-return modality: open by mouse vs keyboard ------------------
    const modPage = await browser.newPage();
    await modPage.setViewport({ width: 1440, height: 900 });
    await modPage.goto(`${URL_BASE}?preview-now=2026-09-30T10:42`, { waitUntil: 'networkidle0' });
    await waitTasks(modPage);
    console.log('\n[p3 1440 light — focus-return modality]');
    const focusState = `(() => {
      const open = document.activeElement;
      const row = open?.closest?.('.planner-task-row');
      return {
        id: open?.id || '',
        isTaskOpen: open?.classList?.contains('task-open') || false,
        focusVisible: open?.matches?.(':focus-visible') ?? null,
        washRing: row ? getComputedStyle(row, '::before').boxShadow : '',
        washOpacity: row ? getComputedStyle(row, '::before').opacity : '',
        flashLeft: !!document.querySelector('#task-list .is-flash'),
        modalHidden: document.getElementById('edit-modal').classList.contains('hidden')
      };
    })()`;
    for (const viaKeyboard of [false, true]) {
      for (const closeVia of ['cancel', 'close-x', 'escape', 'backdrop']) {
        if (viaKeyboard) {
          await modPage.evaluate(`document.querySelector('#task-list .planner-task-row .task-open').focus()`);
          await modPage.keyboard.press('Enter');
        } else {
          await modPage.click('#task-list .planner-task-row .task-open');
        }
        await new Promise(r => setTimeout(r, 450));
        if (closeVia === 'cancel') await modPage.click('#edit-modal-body .edit-cancel');
        else if (closeVia === 'close-x') await modPage.click('#edit-modal-close');
        else if (closeVia === 'escape') await modPage.keyboard.press('Escape');
        else await modPage.mouse.click(60, 60); // backdrop: a point outside the centred panel
        await modPage.mouse.move(0, 0); // hover must not contaminate the wash assert
        await new Promise(r => setTimeout(r, 350));
        const st = await modPage.evaluate(focusState);
        check(`edit modal ${viaKeyboard ? 'keyboard' : 'mouse'}-open + ${closeVia}: focus ${viaKeyboard ? 'with' : 'without'} ring`, () => {
          assert.equal(st.modalHidden, true, 'modal still open');
          assert.equal(st.isTaskOpen, true, `focus on ${st.isTaskOpen ? 'task-open' : st.id || '?'}`);
          assert.equal(st.focusVisible, viaKeyboard, `focus-visible ${st.focusVisible}`);
          if (viaKeyboard) {
            assert.match(st.washRing, /inset/, `no wash ring: ${st.washRing}`);
            assert.equal(st.washOpacity, '1', `wash opacity ${st.washOpacity}`);
          } else {
            assert.ok(!/inset/.test(st.washRing), `ring shown: ${st.washRing}`);
            assert.equal(st.washOpacity, '0', `wash still on: ${st.washOpacity}`);
          }
          assert.equal(st.flashLeft, false, 'stale .is-flash after close');
          return true;
        });
      }
    }
    // Spotlight focus-return modality.
    await modPage.click('#add-task-btn');
    await new Promise(r => setTimeout(r, 350));
    await modPage.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 350));
    const spotMouse = await modPage.evaluate(`({
      id: document.activeElement?.id,
      fv: document.activeElement?.matches?.(':focus-visible') ?? null
    })`);
    check('spotlight mouse-open: focus returns to + without ring', () => {
      assert.equal(spotMouse.id, 'add-task-btn');
      assert.equal(spotMouse.fv, false);
      return true;
    });
    await modPage.keyboard.down('Meta');
    await modPage.keyboard.press('k');
    await modPage.keyboard.up('Meta');
    await new Promise(r => setTimeout(r, 350));
    await modPage.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 350));
    const spotKbd = await modPage.evaluate(`({
      id: document.activeElement?.id,
      fv: document.activeElement?.matches?.(':focus-visible') ?? null
    })`);
    check('spotlight ⌘K-open: focus returns to + with the ring', () => {
      assert.equal(spotKbd.id, 'add-task-btn');
      assert.equal(spotKbd.fv, true);
      return true;
    });
    await modPage.close();
    const p1366 = await newFrozenPage(browser, 1366, 768);
    console.log('\n[p3 1366 light]');
    const geo1366 = await p1366.evaluate(`(() => ({
      tools: document.querySelector('#tasks-section .icon-action').getBoundingClientRect().y,
      title1: document.querySelector('#task-list .planner-row-title').getBoundingClientRect().y,
      paper: getComputedStyle(document.documentElement).backgroundColor
    }))()`);
    check('toolbar y ≈140 and first title y ≈197 at 1366 (±4px)', () => {
      assert.ok(Math.abs(geo1366.tools - 140) <= 4, `toolbar ${geo1366.tools}`);
      assert.ok(Math.abs(geo1366.title1 - 197) <= 4, `title1 ${geo1366.title1}`);
      return true;
    });
    check('paper gutter colour matches at 1366', () => {
      assert.equal(geo1366.paper, 'rgb(250, 250, 250)');
      return true;
    });
    await p1366.close();

    // ---- dark theme sanity ----
    const pDark = await newFrozenPage(browser, 1440, 900, 'dark');
    console.log('\n[p3 1440 dark]');
    const dark = await pDark.evaluate(`(() => ({
      paper: getComputedStyle(document.documentElement).backgroundColor,
      colon: getComputedStyle(document.querySelector('#clock .clock-separator')).color,
      digits: getComputedStyle(document.querySelector('#clock .clock-part')).color
    }))()`);
    check('dark theme gutters use dark paper', () => {
      assert.equal(dark.paper, 'rgb(20, 20, 20)');
      return true;
    });
    check('dark theme colon matches digits', () => {
      assert.equal(dark.colon, dark.digits);
      return true;
    });
    // Dark spotlight: paper panel, muted foot.
    await pDark.click('#add-task-btn');
    await new Promise(r => setTimeout(r, 350));
    const darkSpot = await pDark.evaluate(`(() => ({
      panelBg: getComputedStyle(document.querySelector('.quick-add-panel')).backgroundColor,
      foot: getComputedStyle(document.getElementById('quick-add-foot')).color,
      input: getComputedStyle(document.getElementById('quick-add-input')).color
    }))()`);
    check('dark spotlight: dark paper panel, muted hint, ink input', () => {
      assert.equal(darkSpot.panelBg, 'rgb(20, 20, 20)', `panel ${darkSpot.panelBg}`);
      assert.equal(darkSpot.foot, 'rgb(154, 154, 154)', `foot ${darkSpot.foot}`);
      assert.equal(darkSpot.input, 'rgb(237, 237, 237)', `input ${darkSpot.input}`);
      return true;
    });
    await pDark.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));
    // Dark floating Back to now: paper surface, rule border, ink glyph.
    await pDark.hover('#timeline-viewport');
    await pDark.mouse.wheel({ deltaY: 900 });
    await new Promise(r => setTimeout(r, 250));
    const darkBtn = await pDark.evaluate(`(() => {
      const b = document.getElementById('back-to-now-btn');
      const cs = getComputedStyle(b);
      return { vis: cs.visibility, bg: cs.backgroundColor, border: cs.borderTopColor, ink: cs.color,
        br: cs.borderTopWidth + '/' + cs.borderRadius, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height };
    })()`);
    check('dark Back to now: paper surface, rule border, ink glyph', () => {
      assert.equal(darkBtn.vis, 'visible');
      assert.equal(darkBtn.bg, 'rgb(20, 20, 20)', `bg ${darkBtn.bg}`);
      assert.equal(darkBtn.border, 'rgb(51, 51, 51)', `border ${darkBtn.border}`);
      assert.equal(darkBtn.ink, 'rgb(237, 237, 237)', `ink ${darkBtn.ink}`);
      assert.equal(Math.round(darkBtn.w), 36); assert.equal(Math.round(darkBtn.h), 36);
      assert.equal(darkBtn.br, '1px/8px', `border ${darkBtn.br}`);
      return true;
    });
    await pDark.close();

    await browser.close();
  } catch (err) {
    console.error(`  FAIL phase-3 block: ${err.message}`);
    process.exitCode = 1;
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Phase 4 — fixture matrix verification
// ---------------------------------------------------------------------------

async function loadFixture(browser, fixture, extra = '') {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${FROZEN_URL}&preview-fixture=${fixture}${extra}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#timeline-viewport .timeline-canvas', { timeout: 5000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 700));
  return page;
}

const BLOCKS_JS = `[...document.querySelectorAll('#timeline-viewport .timeline-blk')].map(b => ({
  title: b.querySelector('.t')?.textContent || '', time: b.querySelector('.tm')?.textContent || '',
  sr: b.querySelector('.blk-sr')?.textContent || '', inline: b.classList.contains('inline'),
  tiny: b.classList.contains('tiny'), noTime: b.classList.contains('no-time'),
  h: parseFloat(b.style.height), hasBtn: !!b.querySelector('.icon-action'),
  rect: b.getBoundingClientRect().toJSON()
}))`;

function contrast(fg, bg) {
  const lum = ([r, g, b]) => {
    const c = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  return (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
}

{
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  try {
    // ---- tiny ------------------------------------------------------------
    let page = await loadFixture(browser, 'tiny');
    console.log('\n[p4 fixture: tiny]');
    const tiny = await page.evaluate(BLOCKS_JS);
    check('every block height = duration × 64/60 (±0.5px)', () => {
      assert.equal(tiny.length, 6, JSON.stringify(tiny.map(b => b.title)));
      // Textless blocks carry no title — match by chronological position.
      const ordered = [...tiny].sort((a, b) => a.rect.y - b.rect.y);
      const expected = [1, 5, 15, 30, 45, 90];
      ordered.forEach((b, i) => {
        const want = expected[i] * 64 / 60;
        assert.ok(Math.abs(b.h - want) <= 0.5, `${b.title || `block ${i}`}: ${b.h} vs ${want}`);
      });
      return true;
    });
    check('<22px blocks carry no visible text/button but keep an sr description', () => {
      for (const b of tiny.filter(b => b.h < 22)) {
        assert.equal(b.title, ''); assert.equal(b.time, '');
        assert.equal(b.hasBtn, false);
        assert.ok(b.sr.length > 5, `${b.title || 'block'} missing sr text`);
      }
      return true;
    });
    check('22–44px is inline, >44px is two-line', () => {
      const half = tiny.find(b => b.title === 'Half hour stand');
      const fortyfive = tiny.find(b => b.title.startsWith('Forty five'));
      assert.equal(half.inline, true); assert.ok(half.title && half.time);
      assert.equal(fortyfive.inline, false); assert.ok(fortyfive.title && fortyfive.time);
      return true;
    });
    const noFallbackText = await page.evaluate(`!/short|too small|unlabeled|hidden events/i.test(document.body.innerText)`);
    check('no fallback wording leaks onto the page', () => {
      assert.equal(noFallbackText, true);
      return true;
    });
    await page.close();

    // ---- dense -----------------------------------------------------------
    console.log('\n[p4 fixture: dense]');
    page = await loadFixture(browser, 'dense');
    const denseA = await page.evaluate(BLOCKS_JS);
    const p2 = await loadFixture(browser, 'dense', '&preview-order=reverse');
    const denseB = await p2.evaluate(BLOCKS_JS);
    await p2.close();
    const geom = list => list.map(b => [b.title, Math.round(b.rect.x), Math.round(b.rect.y), Math.round(b.rect.width), Math.round(b.rect.height)]);
    check('lane layout identical regardless of provider order', () => {
      assert.deepEqual(geom(denseA), geom(denseB));
      return true;
    });
    const overlap = (a, b) => a.rect.x < b.rect.x + b.rect.width - 0.5 && b.rect.x < a.rect.x + a.rect.width - 0.5
      && a.rect.y < b.rect.y + b.rect.height - 0.5 && b.rect.y < a.rect.y + a.rect.height - 0.5;
    check('no two blocks overlap', () => {
      for (let i = 0; i < denseA.length; i++) for (let j = i + 1; j < denseA.length; j++)
        assert.ok(!overlap(denseA[i], denseA[j]), `${denseA[i].title} ∩ ${denseA[j].title}`);
      return true;
    });
    const noBtnOverlap = await page.evaluate(`(() => {
      const blks = [...document.querySelectorAll('#timeline-viewport .timeline-blk')];
      const rects = blks.map(b => b.getBoundingClientRect());
      for (let i = 0; i < blks.length; i++) {
        const btn = blks[i].querySelector('.icon-action');
        if (!btn || btn.offsetParent === null) continue;
        const br = btn.getBoundingClientRect();
        for (let j = 0; j < rects.length; j++) {
          if (i === j) continue;
          const r = rects[j];
          if (br.x < r.right - 0.5 && r.x < br.right - 0.5 && br.y < r.bottom - 0.5 && r.y < br.bottom - 0.5) return false;
        }
      }
      return true;
    })()`);
    check('no Open button rect intersects another block', () => {
      assert.equal(noBtnOverlap, true);
      return true;
    });
    check('back-to-back intervals stack vertically in the same lane', () => {
      const a = denseA.find(b => b.title === 'Touch first');
      const c = denseA.find(b => b.title === 'Touch second');
      assert.ok(Math.abs(a.rect.x - c.rect.x) < 1, 'not the same lane');
      assert.ok(Math.abs(a.rect.bottom - c.rect.y) < 2, 'not vertically touching');
      return true;
    });
    check('block DOM order is chronological (top non-decreasing)', () => {
      const tops = denseA.map(b => b.rect.y);
      assert.deepEqual([...tops].sort((a, b) => a - b), tops);
      return true;
    });
    await page.close();

    // ---- contrast, both themes ------------------------------------------
    console.log('\n[p4 contrast]');
    for (const theme of ['light', 'dark']) {
      page = await loadFixture(browser, '', `&preview-theme=${theme}`);
      const pairs = await page.evaluate(`[...document.querySelectorAll('#timeline-viewport .timeline-blk')].map(b => {
        const cs = getComputedStyle(b);
        const parse = s => s.match(/[\\d.]+/g).map(Number);
        const fade = parseFloat(b.style.getPropertyValue('--blk-fade')) || 1;
        const bg = parse(cs.backgroundColor), fg = parse(cs.color);
        const mixed = fg.map((v, i) => Math.round(v * fade + bg[i] * (1 - fade)));
        return { t: b.querySelector('.t').textContent, fg: mixed, bg };
      })`);
      check(`every block's text is ≥4.5:1 against its background (${theme}, opacity-aware)`, () => {
        for (const { t, fg, bg } of pairs) assert.ok(contrast(fg, bg) >= 4.5, `${t}: ${contrast(fg, bg).toFixed(2)}`);
        return pairs.length > 0;
      });
      await page.close();
    }

    // ---- allday-many -----------------------------------------------------
    console.log('\n[p4 fixture: allday-many]');
    page = await loadFixture(browser, 'allday-many');
    const ad1 = await page.evaluate(`(() => {
      const chips = document.querySelectorAll('#timeline-all-day .timeline-ad').length;
      const more = document.querySelector('#timeline-all-day .timeline-ad-more');
      return { chips, expanded: more?.getAttribute('aria-expanded'), controls: more?.getAttribute('aria-controls'), controlsOk: !!(more && document.getElementById(more.getAttribute('aria-controls'))) };
    })()`);
    check('all-day row shows 3 chips + disclosure with valid aria', () => {
      assert.equal(ad1.chips, 3);
      assert.equal(ad1.expanded, 'false');
      assert.equal(ad1.controlsOk, true, 'aria-controls must resolve');
      return true;
    });
    await page.click('#timeline-all-day .timeline-ad-more');
    await new Promise(r => setTimeout(r, 300));
    const ad2 = await page.evaluate(`(() => ({
      chips: document.querySelectorAll('#timeline-all-day .timeline-ad').length,
      expanded: document.querySelector('#timeline-all-day .timeline-ad-more').getAttribute('aria-expanded')
    }))()`);
    check('disclosure expands to all 6 events', () => {
      assert.equal(ad2.chips, 6);
      assert.equal(ad2.expanded, 'true');
      return true;
    });
    await page.close();

    // ---- invalid ---------------------------------------------------------
    console.log('\n[p4 fixture: invalid]');
    page = await loadFixture(browser, 'invalid');
    const inv = await page.evaluate(`(() => ({
      unav: [...document.querySelectorAll('.timeline-unavailable-row')].map(r => r.querySelector('.unav-title').textContent),
      blocks: [...document.querySelectorAll('#timeline-viewport .timeline-blk')].map(b => ({ t: b.querySelector('.t').textContent, bar: getComputedStyle(b).borderLeftColor }))
    }))()`);
    check('malformed intervals land in Time unavailable, not the grid', () => {
      assert.deepEqual(inv.unav.sort(), ['Backwards meeting', 'Garbage timestamps', 'No times at all', 'Zero length sync'].sort());
      assert.deepEqual(inv.blocks.map(b => b.t).sort(), ['Bad colour event', 'Normal event']);
      return true;
    });
    check('malformed colour renders the neutral bar', () => {
      const bad = inv.blocks.find(b => b.t === 'Bad colour event');
      assert.equal(bad.bar, 'rgb(115, 115, 108)', `neutral bar expected, got ${bad.bar}`);
      return true;
    });
    await page.close();

    // ---- long ------------------------------------------------------------
    console.log('\n[p4 fixture: long]');
    page = await loadFixture(browser, 'long');
    const long = await page.evaluate(`(() => {
      const blks = [...document.querySelectorAll('#timeline-viewport .timeline-blk')];
      const get = t => blks.find(b => b.getAttribute('aria-label')?.includes(t));
      const prev = get('Late deploy'), next = get('Midnight maintenance'), marathon = get('Quarterly planning');
      const v = document.getElementById('timeline-viewport');
      // scroll the marathon block's top above the viewport
      v.scrollTop += marathon.getBoundingClientRect().top - v.getBoundingClientRect().top + 60;
      const t = marathon.querySelector('.t').getBoundingClientRect();
      const btn = marathon.querySelector('.icon-action').getBoundingClientRect();
      const vr = v.getBoundingClientRect();
      return {
        contBefore: prev?.classList.contains('cont-before'), contAfter: next?.classList.contains('cont-after'),
        titleInView: t.top >= vr.top + 20 && t.top < vr.top + 60,
        btnInView: btn.top >= vr.top + 20 && btn.top < vr.top + 60
      };
    })()`);
    check('cross-midnight events carry continuation edges', () => {
      assert.equal(long.contBefore, true); assert.equal(long.contAfter, true);
      return true;
    });
    check('long block keeps title + Open visible when scrolled past its top (sticky)', () => {
      assert.equal(long.titleInView, true);
      assert.equal(long.btnInView, true);
      return true;
    });
    await page.close();

    // ---- now positions ---------------------------------------------------
    console.log('\n[p4 now positions]');
    for (const t of ['00:01', '06:00', '21:00', '23:59']) {
      const np = await browser.newPage();
      await np.setViewport({ width: 1440, height: 900 });
      await np.goto(`http://localhost:4173/newtab/newtab.html?preview-now=2026-09-30T${t}`, { waitUntil: 'networkidle0' });
      await np.waitForSelector('#timeline-viewport .timeline-canvas', { timeout: 5000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 700));
      const res = await np.evaluate(`(() => {
        const v = document.getElementById('timeline-viewport');
        const m = v.querySelector('[data-timeline-now="true"]');
        const vr = v.getBoundingClientRect(), mr = m?.getBoundingClientRect();
        const hours = [...v.querySelectorAll('.timeline-hour')];
        const labels = [...v.querySelectorAll('.timeline-hour-label')].map(l => l.textContent);
        const ticks = hours.map(l => parseFloat(l.style.top)).sort((a, b) => a - b);
        return { has: !!m, pct: m ? (mr.top - vr.top) / v.clientHeight : null, vis: m ? mr.top >= vr.top - 1 && mr.top <= vr.bottom + 1 : false,
          ticks, labels, scrollTop: v.scrollTop, max: v.scrollHeight - v.clientHeight };
      })()`);
      check(`Now at ${t} is visible and as close to 40% as clamping allows`, () => {
        assert.equal(res.has, true); assert.equal(res.vis, true);
        // marker at ~40% unless the scroll is clamped at either end
        if (res.scrollTop <= 1) assert.ok(res.pct <= 0.41, `top-clamped pct ${res.pct}`);
        else if (Math.abs(res.scrollTop - res.max) <= 1) assert.ok(res.pct >= 0.39, `bottom-clamped pct ${res.pct}`);
        else assert.ok(Math.abs(res.pct - 0.4) < 0.02, `pct ${res.pct}`);
        return true;
      });
      if (t === '00:01') check('canvas covers the full day (12 AM … 11 PM ticks)', () => {
        // A label adjacent to the Now marker is suppressed, so assert on the
        // tick positions: 24 ticks spanning 0 → 23h × 64px on the canvas.
        assert.equal(res.ticks.length, 24, `${res.ticks.length} ticks`);
        const pad = res.ticks[0];
        assert.ok(Math.abs(res.ticks.at(-1) - pad - 23 * 64) < 0.5, `last tick ${res.ticks.at(-1)}`);
        assert.ok(res.labels.includes('11 PM'), 'last hour label missing');
        return true;
      });
      await np.close();
    }

    // ---- DST via emulated timezone ---------------------------------------
    console.log('\n[p4 DST day view]');
    for (const [nowParam, want] of [['2026-11-01T09:00', { ticks: 25, dupLabel: '1 AM', absent: null }], ['2026-03-08T09:00', { ticks: 23, dupLabel: null, absent: '2 AM' }]]) {
      const dp = await browser.newPage();
      await dp.setViewport({ width: 1440, height: 900 });
      await dp.emulateTimezone('America/New_York');
      await dp.goto(`http://localhost:4173/newtab/newtab.html?preview-now=${nowParam}`, { waitUntil: 'networkidle0' });
      await dp.waitForSelector('#timeline-viewport .timeline-canvas', { timeout: 5000 }).catch(() => {});
      const res = await dp.evaluate(`(() => {
        const v = document.querySelector('#timeline-viewport');
        const labels = [...v.querySelectorAll('.timeline-hour-label')].map(l => l.childNodes[0].textContent.trim());
        const canvas = v.querySelector('.timeline-canvas');
        return { labels, canvasH: parseFloat(canvas.style.height), viewH: v.clientHeight };
      })()`);
      check(`DST ${nowParam}: ${want.ticks} hour ticks, expected duplicate/absent labels`, () => {
        // The 9 AM label may be suppressed because the Now marker owns that
        // stretch of the rail, so allow ticks-1 … ticks labels.
        assert.ok(res.labels.length >= want.ticks - 1 && res.labels.length <= want.ticks, `${res.labels.length} labels`);
        if (want.dupLabel) assert.equal(res.labels.filter(l => l === want.dupLabel).length, 2, `expected two ${want.dupLabel}`);
        if (want.absent) assert.ok(!res.labels.includes(want.absent), `should have no ${want.absent}`);
        const gridH = res.canvasH - res.viewH; // pad top 40% + bottom 60% = 1 viewport
        const wantMin = want.ticks === 25 ? 1500 : 1380;
        assert.ok(Math.abs(gridH - wantMin * 64 / 60) < 2, `grid height ${gridH} vs ${wantMin * 64 / 60}`);
        return true;
      });
      await dp.close();
    }

    // ---- status fixtures -------------------------------------------------
    console.log('\n[p4 status fixtures]');
    const healthy = await loadFixture(browser, '');
    const healthyRects = await healthy.evaluate(`(() => ({
      main: document.querySelector('.main').getBoundingClientRect().toJSON(),
      tasks: document.getElementById('tasks-section').getBoundingClientRect().toJSON(),
      cal: document.getElementById('today-timeline-section').getBoundingClientRect().toJSON()
    }))()`);
    for (const [fx, sel, needle, actionSel] of [
      ['cal-disconnected', '#calendar-status', 'Connect Google Calendar', '#calendar-connect-btn'],
      ['cal-expired', '#calendar-status', 'connection expired', '#calendar-connect-btn'],
      ['cal-error', '#calendar-status', 'unavailable', null],
      ['todoist-disconnected', '#tasks-status', 'Connect Todoist', '#todos-connect-btn'],
      ['todoist-error', '#tasks-status', 'unavailable', null]
    ]) {
      const sp = await loadFixture(browser, fx);
      const res = await sp.evaluate(`(() => ({
        status: document.querySelector('${sel}')?.textContent || '',
        actionVisible: ${actionSel ? `!!document.querySelector('${actionSel}') && getComputedStyle(document.querySelector('${actionSel}')).visibility !== 'hidden'` : 'null'},
        other: '${sel}'.includes('calendar') ? document.querySelectorAll('#task-list .planner-task-row').length : document.querySelectorAll('#timeline-viewport .timeline-blk').length,
        main: document.querySelector('.main').getBoundingClientRect().toJSON(),
        tasks: document.getElementById('tasks-section').getBoundingClientRect().toJSON(),
        cal: document.getElementById('today-timeline-section').getBoundingClientRect().toJSON()
      }))()`);
      check(`${fx}: status in its own section, other section + geometry intact`, () => {
        assert.ok(res.status.toLowerCase().includes(needle.toLowerCase()), `status: "${res.status}"`);
        if (actionSel) assert.equal(res.actionVisible, true, 'icon action missing');
        assert.ok(res.other > 0, 'other section empty');
        for (const key of ['main', 'tasks', 'cal'])
          assert.ok(Math.abs(res[key].x - healthyRects[key].x) < 0.5 && Math.abs(res[key].width - healthyRects[key].width) < 0.5, `${key} drifted`);
        return true;
      });
      if (actionSel) {
        await sp.click(actionSel);
        await new Promise(r => setTimeout(r, 1200));
        const rec = await sp.evaluate(`(() => ({ status: document.querySelector('${sel}').textContent, rows: document.querySelectorAll('#task-list .planner-task-row, #timeline-viewport .timeline-blk').length }))()`);
        check(`${fx}: connect/retry recovers and clears the status`, () => {
          assert.equal(res.status !== '' && rec.status === '', true, `status after: "${rec.status}"`);
          assert.ok(rec.rows > 0);
          return true;
        });
      }
      await sp.close();
    }
    await healthy.close();

    // ---- mutation-fail ---------------------------------------------------
    console.log('\n[p4 fixture: mutation-fail]');
    page = await loadFixture(browser, 'mutation-fail');
    const mut1 = await page.evaluate(`(() => {
      const ring = document.querySelector('#task-list .planner-check');
      const before = ring.getBoundingClientRect().toJSON();
      ring.click();
      return before;
    })()`);
    await new Promise(r => setTimeout(r, 1000));
    const mut2 = await page.evaluate(`(() => {
      const ring = document.querySelector('#task-list .planner-check');
      return { exists: !!ring, pending: ring?.classList.contains('is-pending'), disabled: ring?.disabled, after: ring?.getBoundingClientRect().toJSON(), rowCount: document.querySelectorAll('#task-list .planner-task-row').length };
    })()`);
    check('failed complete restores the ring and keeps the row', () => {
      assert.equal(mut2.exists, true); assert.equal(mut2.pending, false); assert.equal(mut2.disabled, false);
      assert.ok(Math.abs(mut1.width - mut2.after.width) < 0.5, 'button resized while pending');
      assert.equal(mut2.rowCount, 3);
      return true;
    });
    await page.click('#add-task-btn');
    await new Promise(r => setTimeout(r, 400));
    await page.type('#quick-add-input', 'Failing create probe');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1000));
    const mut3 = await page.evaluate(`(() => ({
      value: document.getElementById('quick-add-input').value,
      status: document.getElementById('quick-add-foot').textContent,
      mode: document.getElementById('quick-add-foot').dataset.mode,
      overlayOpen: !document.getElementById('quick-add').classList.contains('hidden'),
      spinnerVis: getComputedStyle(document.getElementById('quick-add-spinner')).visibility
    }))()`);
    check('failed Quick Add keeps text, shows the error, stays open', () => {
      assert.equal(mut3.value, 'Failing create probe');
      assert.equal(mut3.mode, 'error');
      assert.ok(mut3.status.length > 3, `status: "${mut3.status}"`);
      assert.equal(mut3.overlayOpen, true);
      assert.equal(mut3.spinnerVis, 'hidden', `spinner still visible after failure: ${mut3.spinnerVis}`);
      return true;
    });
    await page.keyboard.press('Escape');
    await page.close();

    // ---- recurring: due.string editable via NLP ---------------------------
    console.log('\n[p4 fixture: recurring]');
    page = await loadFixture(browser, 'recurring');
    const openEditFor = async title => {
      await page.evaluate(`[...document.querySelectorAll('#task-list .planner-task-row')]
        .find(r => r.querySelector('.planner-row-title')?.textContent === ${JSON.stringify(title)})
        ?.querySelector('.task-open')?.click()`);
      await new Promise(r => setTimeout(r, 500));
    };
    await openEditFor('Weekly review ritual');
    const rec = await page.evaluate(`(() => {
      const due = document.getElementById('planner-edit-due');
      return { value: due?.value, disabled: due?.disabled, readonly: due?.readOnly, hint: document.querySelector('#edit-modal-body .qa-hint')?.textContent };
    })()`);
    check('recurring task: due.string editable in the text field with NLP hint', () => {
      assert.equal(rec.value, 'every Friday');
      assert.equal(rec.disabled, false);
      assert.equal(rec.readonly, false);
      assert.ok(/Natural language/.test(rec.hint), rec.hint);
      return true;
    });
    // The project select must always display the task's project — even when
    // the id is missing from the loaded list (Inbox / shared project).
    const projectCases = [
      ['Weekly review ritual', 'Inbox'],
      ['Plain one-off task', 'Focus extension / Side quests'],
      ['Shared-space task', 'Current project']
    ];
    const projectLabels = [];
    for (const [title] of projectCases) {
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 300));
      await openEditFor(title);
      projectLabels.push(await page.evaluate(`document.getElementById('planner-edit-project')?.selectedOptions[0]?.textContent || ''`));
    }
    check('edit project select shows Inbox / nested path / unknown project', () => {
      assert.deepEqual(projectLabels, projectCases.map(c => c[1]), JSON.stringify(projectLabels));
      return true;
    });
    await page.close();

    // ---- suggest / future-only -------------------------------------------
    console.log('\n[p4 fixtures: suggest, future-only]');
    page = await loadFixture(browser, 'suggest');
    const sug = await page.evaluate(`[...document.querySelectorAll('#task-list .planner-task-row')].map(r => ({
      t: r.querySelector('.planner-row-title').textContent,
      w: getComputedStyle(r.querySelector('.planner-row-title')).fontWeight,
      meta: r.querySelector('.planner-row-meta')?.textContent || ''
    }))`);
    check('suggest order: deadline-first (timed before same-day date-only), uniform weight', () => {
      assert.equal(sug[0].t, 'Timed deadline at 15:00');
      assert.equal(sug[0].w, '400');
      assert.equal(sug[1].t, 'Later high-priority review');
      assert.equal(sug[2].t, 'Earlier low-priority errand');
      return true;
    });
    const noCurrent = await page.evaluate(`(() => ({
      aria: !!document.querySelector('[aria-current]'),
      name: [...document.querySelectorAll('[aria-label]')].some(el => /make current|current task/i.test(el.getAttribute('aria-label'))),
      hint: [...document.querySelectorAll('#task-list .visually-hidden')].length
    }))()`);
    check('no Make current / Current task / aria-current on the new tab', () => {
      assert.equal(noCurrent.aria, false, 'aria-current present');
      assert.equal(noCurrent.name, false, 'current-task accessible name present');
      assert.equal(noCurrent.hint, 0, 'hidden hint present');
      return true;
    });
    await page.close();
    page = await loadFixture(browser, 'future-only');
    const fut = await page.evaluate(`[...document.querySelectorAll('#task-list .planner-task-row')].map(r => ({
      t: r.querySelector('.planner-row-title').textContent,
      w: getComputedStyle(r.querySelector('.planner-row-title')).fontWeight,
      meta: r.querySelector('.planner-row-meta')?.textContent || ''
    }))`);
    check('future-only: deadline-first order, uniform weight, dates shown', () => {
      assert.equal(fut[0].t, 'Tomorrow morning review');
      assert.equal(fut[0].w, '400');
      assert.ok(!/today/i.test(fut[0].meta) && fut[0].meta.length > 0, fut[0].meta);
      assert.equal(fut[2].t, 'Undated someday item');
      return true;
    });
    await page.close();

    // ---- keyboard sweep ---------------------------------------------------
    console.log('\n[p4 keyboard sweep]');
    page = await loadFixture(browser, '');
    const focusLog = [];
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(`(() => {
        const el = document.activeElement;
        const cs = getComputedStyle(el);
        const main = document.querySelector('.main').contains(el);
        const vpOpen = !!el.closest('#timeline-viewport') && el.classList.contains('icon-action');
        return { tag: el.tagName, label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30), outline: cs.outlineWidth, inMain: main, vpOpen };
      })()`);
      focusLog.push(info);
      if (focusLog.length > 3 && focusLog.at(-1).label === focusLog[0].label && focusLog.at(-1).tag === focusLog[0].tag) break;
    }
    check('every focused control has a name and ≥2px focus outline', () => {
      const inMain = focusLog.filter(f => f.inMain);
      assert.ok(inMain.length >= 6, `too few focusables: ${JSON.stringify(focusLog)}`);
      for (const f of inMain) {
        assert.ok(f.label.length > 0, 'unnamed control');
        assert.ok(parseFloat(f.outline) >= 2, `${f.label}: outline ${f.outline}`);
      }
      return true;
    });
    check('tab order reaches task rows then calendar actions then blocks', () => {
      const inViewport = focusLog.map(f => f.vpOpen);
      const rowIdx = focusLog.findIndex(f => /Complete /.test(f.label));
      const calIdx = focusLog.findIndex(f => f.label === 'Open Google Calendar (opens in new tab)');
      const blkIdx = inViewport.findIndex(Boolean);
      assert.ok(rowIdx > -1 && calIdx > rowIdx && blkIdx > calIdx, JSON.stringify(focusLog.map(f => f.label)));
      return true;
    });
    await page.close();
    await browser.close();
  } catch (err) {
    console.error(`  FAIL phase-4 block: ${err.stack || err.message}`);
    process.exitCode = 1;
    await browser.close();
  }
}

// ===========================================================================
// Settings page + stripped surfaces
// ===========================================================================

{
  const browser = await puppeteer.launch({ executablePath: CHROME });
  const OPTIONS = 'http://localhost:4173/options/options.html';
  try {
    console.log('\n[removed-feature residue]');
    const nt = await browser.newPage();
    await nt.setViewport({ width: 1440, height: 900 });
    await nt.goto(URL_BASE, { waitUntil: 'networkidle0' });
    const residue = await nt.evaluate(`(() => ({
      shaders: document.querySelectorAll('canvas.bg-shader, #bg-ocean, #bg-dither').length,
      bedtime: document.querySelectorAll('#bedtime-reminder, .bedtime-reminder').length,
      bgImage: document.body.style.backgroundImage || '',
      canvases: document.querySelectorAll('canvas').length
    }))()`);
    check('no shader canvases, bedtime reminder, or background image remain', () => {
      assert.equal(residue.shaders, 0);
      assert.equal(residue.bedtime, 0);
      assert.equal(residue.canvases, 0);
      assert.equal(residue.bgImage, '');
      return true;
    });

    // -----------------------------------------------------------------------
    console.log('\n[settings: layout]');
    const st = await browser.newPage();
    await st.setViewport({ width: 1440, height: 900 });
    await st.goto(OPTIONS, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 300));
    const layout = await st.evaluate(`(() => {
      const main = document.querySelector('.settings').getBoundingClientRect();
      const title = document.querySelector('.settings-title');
      const cs = getComputedStyle(title);
      const t = title.getBoundingClientRect();
      const label = getComputedStyle(document.querySelector('.st-label'));
      const saved = [...document.querySelectorAll('.st-saved')].map(s => s.getAttribute('aria-live'));
      return {
        width: main.width, left: main.left, viewport: document.documentElement.clientWidth,
        topGap: t.top - main.top,
        font: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight,
        labelSize: label.fontSize, labelWeight: label.fontWeight, labelColor: label.color,
        saved
      };
    })()`);
    check('settings column is 640px, centred, 96px top offset', () => {
      assert.equal(layout.width, 640);
      assert.ok(Math.abs(layout.left - (layout.viewport - 640) / 2) < 1, `left ${layout.left}`);
      assert.equal(Math.round(layout.topGap), 96);
      return true;
    });
    check('title is 28px Inter 500; labels match the homepage Calendar label', () => {
      assert.ok(/Inter/.test(layout.font), layout.font);
      assert.equal(layout.size, '28px');
      assert.equal(layout.weight, '500');
      assert.equal(layout.labelSize, '13px');
      assert.equal(layout.labelWeight, '500');
      assert.deepEqual(layout.saved, ['polite', 'polite', 'polite', 'polite']);
      return true;
    });
    const stBorders = await st.evaluate(horizBorders('main.settings'));
    check('settings page has no horizontal rules', () => {
      assert.deepEqual(stBorders, []);
      return true;
    });

    // -----------------------------------------------------------------------
    console.log('\n[settings: new-tab switches propagate]');
    const sw = await st.evaluate(`(() => {
      const s = document.getElementById('show-calendar');
      const cs = getComputedStyle(s);
      const r = s.getBoundingClientRect();
      return { role: s.getAttribute('role'), type: s.type, w: r.width, h: r.height,
        off: cs.backgroundColor, checked: s.checked };
    })()`);
    check('switches are real checkbox role=switch, 36x20 track', () => {
      assert.equal(sw.type, 'checkbox');
      assert.equal(sw.role, 'switch');
      assert.equal(sw.w, 36); assert.equal(sw.h, 20);
      assert.equal(sw.checked, true);
      return true;
    });
    await st.click('#show-calendar');
    await new Promise(r => setTimeout(r, 400));
    const ntAfterHide = await nt.evaluate(`(() => ({
      hidden: document.getElementById('today-timeline-section').classList.contains('hidden'),
      setting: null
    }))()`);
    check('hiding the calendar in Settings updates the open new tab', () => {
      assert.equal(ntAfterHide.hidden, true, 'calendar section still visible');
      return true;
    });
    const savedShown = await st.evaluate(`document.getElementById('newtab-saved').textContent`);
    check('per-section "Saved" indicator fires', () => {
      assert.equal(savedShown, 'Saved');
      return true;
    });
    await st.click('#show-calendar');
    await new Promise(r => setTimeout(r, 400));
    const ntRestored = await nt.evaluate(`!document.getElementById('today-timeline-section').classList.contains('hidden')`);
    check('re-enabling restores the new-tab calendar', () => ntRestored);

    // Temperature unit → weather re-render on the new tab. Widget refreshes
    // are deferred while the tab is hidden, so bring it forward first.
    await st.click('.seg-btn[data-unit="F"]');
    await new Promise(r => setTimeout(r, 400));
    await nt.bringToFront();
    await new Promise(r => setTimeout(r, 800));
    const tempF = await nt.evaluate(`document.getElementById('weather-temp').textContent`);
    await st.bringToFront();
    check('°F selection updates the new-tab weather reading', () => {
      assert.equal(tempF, '71°', `got ${tempF}`);
      return true;
    });

    // -----------------------------------------------------------------------
    console.log('\n[settings: theme segment applies to both pages]');
    await st.click('.seg-btn[data-theme-option="dark"]');
    await new Promise(r => setTimeout(r, 500));
    const themes = await Promise.all([st, nt].map(p => p.evaluate(`document.documentElement.getAttribute('data-theme')`)));
    check('Dark applies to Settings and the open new tab', () => {
      assert.ok(themes.every(t => /dark$/.test(t)), JSON.stringify(themes));
      return true;
    });
    await st.click('.seg-btn[data-theme-option="light"]');
    await new Promise(r => setTimeout(r, 500));
    const themes2 = await Promise.all([st, nt].map(p => p.evaluate(`document.documentElement.getAttribute('data-theme')`)));
    check('Light restores both pages', () => themes2.every(t => /light$/.test(t)));

    // -----------------------------------------------------------------------
    console.log('\n[settings: connections]');
    const todoist0 = await st.evaluate(`document.getElementById('todoist-status').textContent`);
    check('todoist shows Connected with the shim token', () => todoist0 === 'Connected');
    await st.click('#todoist-btn');
    await new Promise(r => setTimeout(r, 400));
    const todoist1 = await st.evaluate(`document.getElementById('todoist-status').textContent + '|' + document.getElementById('todoist-btn').textContent`);
    check('todoist disconnect updates status and button', () => todoist1 === 'Not connected|Connect');
    await st.click('#todoist-btn');
    await new Promise(r => setTimeout(r, 600));
    const todoist2 = await st.evaluate(`document.getElementById('todoist-status').textContent`);
    check('todoist connect completes the shim OAuth flow', () => todoist2 === 'Connected');

    const calRows = await st.evaluate(`(() => ({
      status: document.getElementById('calendar-status').textContent,
      rows: [...document.querySelectorAll('#calendar-list-items .st-cal')].map(l => ({
        name: l.querySelector('.st-cal-name').textContent,
        color: l.querySelector('.st-cal-dot').style.background,
        checked: l.querySelector('input').checked
      }))
    }))()`);
    check('calendar connected, lists calendars with colour dots + checkboxes', () => {
      assert.ok(/Connected/.test(calRows.status), calRows.status);
      assert.equal(calRows.rows.length, 3);
      assert.ok(calRows.rows.every(r => r.color && r.checked));
      return true;
    });
    const cbStyle = await st.evaluate(`(() => {
      const cb = document.querySelector('#calendar-list-items input[type="checkbox"]');
      const cs = getComputedStyle(cb);
      const r = cb.getBoundingClientRect();
      const before = getComputedStyle(cb, '::before');
      return { w: r.width, h: r.height, border: cs.borderWidth, radius: cs.borderRadius,
        bg: cs.backgroundColor, checkScale: before.transform, checkColor: before.backgroundColor };
    })()`);
    check('calendar checkboxes are styled 18px ink-fill nt controls', () => {
      assert.equal(cbStyle.w, 18); assert.equal(cbStyle.h, 18);
      assert.equal(cbStyle.border, '1px');
      assert.equal(cbStyle.radius, '4px');
      assert.equal(cbStyle.bg, 'rgb(31, 31, 31)', `checked fill should be --nt-ink: ${cbStyle.bg}`);
      assert.ok(/matrix/.test(cbStyle.checkScale) && !cbStyle.checkScale.includes('(0, 0'), `check visible: ${cbStyle.checkScale}`);
      assert.equal(cbStyle.checkColor, 'rgb(250, 250, 250)', `paper check: ${cbStyle.checkColor}`);
      return true;
    });
    await st.evaluate(`document.querySelectorAll('#calendar-list-items input[type="checkbox"]')[1].click()`);
    await new Promise(r => setTimeout(r, 400));
    const selAfter = await st.evaluate(`chrome.storage.local.get('calendarSettings').then(s => s.calendarSettings.selectedCalendars)`);
    check('unchecking a calendar autosaves selectedCalendars', () => {
      assert.deepEqual(selAfter.sort(), ['primary', 'work'].sort(), JSON.stringify(selAfter));
      return true;
    });
    await st.click('#calendar-btn');
    await new Promise(r => setTimeout(r, 400));
    const calOff = await st.evaluate(`(() => ({
      status: document.getElementById('calendar-status').textContent,
      listHidden: document.getElementById('calendar-list').hidden
    }))()`);
    check('calendar disconnect hides the list and updates status', () => {
      assert.equal(calOff.status, 'Not connected');
      assert.equal(calOff.listHidden, true);
      return true;
    });
    await st.click('#calendar-btn');
    await new Promise(r => setTimeout(r, 500));
    const calOn = await st.evaluate(`(() => ({
      status: document.getElementById('calendar-status').textContent,
      listHidden: document.getElementById('calendar-list').hidden
    }))()`);
    check('calendar reconnect restores status and list', () => {
      assert.ok(/Connected/.test(calOn.status));
      assert.equal(calOn.listHidden, false);
      return true;
    });

    // Keyboard: Tab reaches a named control with a visible focus ring.
    let focus = null;
    for (let i = 0; i < 8; i++) {
      await st.keyboard.press('Tab');
      focus = await st.evaluate(`(() => {
        const el = document.activeElement;
        if (!el || el === document.body || !el.closest('.settings')) return null;
        const cs = getComputedStyle(el);
        return { label: el.getAttribute('aria-label') || el.labels?.[0]?.textContent.trim() || el.textContent.trim(), outline: cs.outlineWidth, tag: el.tagName };
      })()`);
      if (focus) break;
    }
    check('settings keyboard focus lands on a named control with a ≥2px ring', () => {
      assert.ok(focus, 'no .settings control reached after 8 Tabs');
      assert.ok(focus.label.length > 0, 'unnamed control focused');
      assert.ok(parseFloat(focus.outline) >= 2, `${focus.label}: outline ${focus.outline}`);
      return true;
    });

    // Dark-mode visual check on the settings page itself.
    await st.click('.seg-btn[data-theme-option="dark"]');
    await new Promise(r => setTimeout(r, 400));
    const darkCss = await st.evaluate(`(() => ({
      paper: getComputedStyle(document.body).backgroundColor,
      ink: getComputedStyle(document.querySelector('.settings-title')).color
    }))()`);
    check('settings dark theme paints dark paper + light ink', () => {
      assert.equal(darkCss.paper, 'rgb(20, 20, 20)');
      assert.equal(darkCss.ink, 'rgb(237, 237, 237)');
      return true;
    });

    await st.close();
    await nt.close();

    // -----------------------------------------------------------------------
    // Interactive-paint clearance: no hover/focus paint (ring = box + 4px)
    // may touch a neighbouring surface (wash = the row's ::before, which
    // matches the row's block box vertically).
    console.log('\n[interactive paint clearance]');
    for (const size of SIZES) {
      for (const theme of ['light', 'dark']) {
        const cp = await browser.newPage();
        await cp.setViewport({ width: size.width, height: size.height });
        await cp.goto(`${URL_BASE}?preview-theme=${theme}`, { waitUntil: 'networkidle0' });
        await new Promise(r => setTimeout(r, 400));
        const g = await cp.evaluate(`(() => {
          const q = s => document.querySelector(s)?.getBoundingClientRect().toJSON();
          const rows = [...document.querySelectorAll('#task-list .planner-task-row')];
          const washTop = el => el.getBoundingClientRect().top;
          const washBottom = el => el.getBoundingClientRect().bottom;
          const chips = [...document.querySelectorAll('#timeline-all-day a, #timeline-all-day button, #timeline-all-day .chip, #timeline-all-day *')].filter(el => el.getBoundingClientRect().height > 0);
          return {
            weatherBottom: q('.weather-section').bottom,
            addBtn: q('#add-task-btn'),
            firstWashTop: washTop(rows[0]),
            lastWashBottom: washBottom(rows.at(-1)),
            calBtn: q('#view-schedule-btn'),
            chipRects: chips.map(el => el.getBoundingClientRect().toJSON()),
            viewportTop: q('#timeline-viewport').top,
            viewportLeft: q('#timeline-viewport').left,
            viewportRight: q('#timeline-viewport').right,
            firstWash: { top: washTop(rows[0]), bottom: washBottom(rows[0]), left: rows[0].getBoundingClientRect().left, right: rows[0].getBoundingClientRect().right }
          };
        })()`);
        const tag = `${size.width} ${theme}`;
        check(`clearance: weather ↔ toolbar ring ≥12 (${tag})`, () => {
          assert.ok(g.addBtn.top - 4 - g.weatherBottom >= 11.5, `gap ${g.addBtn.top - 4 - g.weatherBottom}`);
          return true;
        });
        check(`clearance: toolbar ring ↔ first-row wash ≥8 (${tag})`, () => {
          const gap = g.firstWashTop - (g.addBtn.bottom + 4);
          assert.ok(gap >= 7.5, `gap ${gap}`);
          return true;
        });
        check(`clearance: last-row wash ↔ calendar ring ≥8 (${tag})`, () => {
          const gap = (g.calBtn.top - 4) - g.lastWashBottom;
          assert.ok(gap >= 7.5, `gap ${gap}`);
          return true;
        });
        check(`clearance: calendar ring ↔ viewport/chips ≥8 (${tag})`, () => {
          const ringBottom = g.calBtn.bottom + 4;
          const ringTop = g.calBtn.top - 4;
          assert.ok(g.viewportTop - ringBottom >= 7.5, `viewport gap ${g.viewportTop - ringBottom}`);
          for (const chip of g.chipRects) {
            // Horizontal separation (same line) or vertical separation (wrapped).
            const hGap = Math.max(chip.left - (g.calBtn.right + 4), (g.calBtn.left - 4) - chip.right);
            const vGap = Math.max(chip.top - ringBottom, ringTop - chip.bottom);
            assert.ok(hGap >= 7.5 || vGap >= 7.5, `chip gap h=${hGap} v=${vGap}`);
          }
          return true;
        });
        await cp.close();
      }
    }

  } catch (err) {
    console.error(`  FAIL settings block: ${err.stack || err.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures)' : ''}`);
