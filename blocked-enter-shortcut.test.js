import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const blockedSource = fs.readFileSync(new URL('./blocked/blocked.js', import.meta.url), 'utf8');

assert.match(
  blockedSource,
  /document\.addEventListener\('keydown', handleEnterToUnblock\);/,
  'blocked page should register a global Enter shortcut for unblocking'
);

assert.match(
  blockedSource,
  /function shouldSubmitUnblockOnEnter\(event\)[\s\S]*event\.key !== 'Enter'/,
  'Enter shortcut should only react to Enter key presses'
);

assert.match(
  blockedSource,
  /target\.closest\('#whitelist-link-action'\)/,
  'Enter shortcut should not intercept whitelist-link text entry'
);

assert.match(
  blockedSource,
  /hint\.textContent = 'Select your time limit and press Enter or click to continue';/,
  'unlock hint should advertise Enter as a shortcut'
);

const shortcutSlice = (() => {
  const start = blockedSource.indexOf('function shouldSubmitUnblockOnEnter');
  const end = blockedSource.indexOf('function setupEventListeners');
  assert.ok(start > 0 && end > start, 'could not locate the Enter shortcut helpers');
  return blockedSource.slice(start, end);
})();

function makeShortcutHarness({ buttonDisabled = false, navigating = false } = {}) {
  const unblockButton = {
    id: 'unblock-button',
    disabled: buttonDisabled,
    dataset: { navigating: String(navigating) },
    clicks: 0,
    click() { this.clicks += 1; }
  };

  const context = vm.createContext({
    document: { getElementById: (id) => (id === 'unblock-button' ? unblockButton : null) },
    Element: class Element {}
  });
  vm.runInContext(shortcutSlice, context);
  return { context, unblockButton };
}

const enterEvent = (overrides = {}) => ({
  key: 'Enter',
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  repeat: false,
  isComposing: false,
  target: {},
  prevented: false,
  preventDefault() { this.prevented = true; },
  ...overrides
});

{
  const { context, unblockButton } = makeShortcutHarness();
  const event = enterEvent();
  context.handleEnterToUnblock(event);
  assert.equal(unblockButton.clicks, 1, 'plain Enter clicks the enabled unblock button');
  assert.equal(event.prevented, true, 'a handled Enter is default-prevented');
}

{
  const { context, unblockButton } = makeShortcutHarness();
  for (const event of [
    enterEvent({ key: ' ' }),
    enterEvent({ repeat: true }),
    enterEvent({ isComposing: true }),
    enterEvent({ ctrlKey: true }),
    enterEvent({ metaKey: true }),
    enterEvent({ shiftKey: true }),
    enterEvent({ altKey: true })
  ]) {
    context.handleEnterToUnblock(event);
  }
  assert.equal(unblockButton.clicks, 0, 'non-Enter, repeat, composing and modified presses are ignored');
}

{
  const { context, unblockButton } = makeShortcutHarness({ buttonDisabled: true });
  context.handleEnterToUnblock(enterEvent());
  const { context: c2, unblockButton: b2 } = makeShortcutHarness({ navigating: true });
  c2.handleEnterToUnblock(enterEvent());
  assert.equal(unblockButton.clicks, 0, 'disabled button ignores Enter');
  assert.equal(b2.clicks, 0, 'in-flight navigation ignores Enter');
}

{
  const { context, unblockButton } = makeShortcutHarness();
  const makeTarget = (closest) => {
    const target = new context.Element();
    target.closest = closest;
    return target;
  };

  context.handleEnterToUnblock(enterEvent({
    target: makeTarget((sel) => (sel === '#whitelist-link-action' ? {} : null))
  }));
  assert.equal(unblockButton.clicks, 0, 'Enter inside the whitelist link field is left alone');

  context.handleEnterToUnblock(enterEvent({
    target: makeTarget((sel) => (sel === '#whitelist-link-action' ? null : { id: 'other-button' }))
  }));
  assert.equal(unblockButton.clicks, 0, 'Enter on unrelated controls is not hijacked');

  context.handleEnterToUnblock(enterEvent({
    target: makeTarget((sel) => (sel === '#whitelist-link-action' ? null : { id: 'unblock-button' }))
  }));
  assert.equal(unblockButton.clicks, 1, 'Enter on the unblock button itself still submits');
}

console.log('blocked enter shortcut tests passed');
