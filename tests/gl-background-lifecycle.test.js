import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../newtab/gl-background.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '');

function harness({ visibility = 'visible', failLinks = [], failFrag = false } = {}) {
  const counts = { compile: 0, link: 0, deleteProgram: 0, deleteShader: 0, clientWidthReads: 0, draws: 0 };
  let linkSeq = 0;
  const linkOrder = new Map();

  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLES: 8,
    createShader: (type) => ({ type }),
    shaderSource() {},
    compileShader() { counts.compile++; },
    getShaderParameter: (sh) => !(failFrag && sh.type === 2),
    getShaderInfoLog: () => '',
    deleteShader() { counts.deleteShader++; },
    createProgram: () => ({}),
    attachShader() {},
    linkProgram(prog) { counts.link++; linkSeq++; linkOrder.set(prog, linkSeq); },
    getProgramParameter: (prog) => !failLinks.includes(linkOrder.get(prog)),
    getProgramInfoLog: () => 'link failed',
    deleteProgram() { counts.deleteProgram++; },
    createBuffer: () => ({}),
    bindBuffer() {}, bufferData() {},
    enableVertexAttribArray() {}, vertexAttribPointer() {},
    useProgram() {}, uniform1i() {}, uniform1f() {}, uniform2f() {},
    getAttribLocation: () => 0, getUniformLocation: () => ({}),
    viewport() {},
    drawArrays() { counts.draws++; },
    deleteBuffer() {},
    getExtension: () => ({ loseContext() {} })
  };

  const canvas = {
    width: 0, height: 0,
    get clientWidth() { counts.clientWidthReads++; return 800; },
    get clientHeight() { counts.clientHeightReads = (counts.clientHeightReads || 0) + 1; return 600; },
    getContext: () => gl
  };

  let visibilityState = visibility;
  const rafQueue = [];
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: {
      get visibilityState() { return visibilityState; },
      addEventListener() {}, removeEventListener() {}
    },
    window: { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} },
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
    cancelAnimationFrame() {},
    performance: { now: () => performance.now() }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nthis.createGlBackground = createGlBackground;`, sandbox);

  return {
    counts,
    create: (opts) => sandbox.createGlBackground(canvas, opts),
    setVisibility(v) { visibilityState = v; },
    pumpFrames(n = 1) {
      for (let i = 0; i < n; i++) {
        const batch = rafQueue.splice(0);
        for (const fn of batch) fn();
      }
    },
    rafPending: () => rafQueue.length
  };
}

const OPTS = {
  label: 'fixture',
  fragNormal: 'void main(){}',
  fragSaver: 'void main(){}',
  tiers: { normal: { dpr: 2, scale: 1, fps: 0 }, saver: { dpr: 1, scale: 0.5, fps: 20 } }
};

{
  const h = harness();
  const bg = h.create(OPTS);
  assert.ok(bg, 'background should initialize');
  assert.equal(h.counts.link, 1, 'startup must compile exactly one program, not both');
  bg.destroy();
}

{
  const h = harness();
  const bg = h.create(OPTS);
  bg.setBatterySaver(true);
  assert.equal(h.counts.link, 2, 'first saver selection compiles the saver program');
  bg.setBatterySaver(false);
  bg.setBatterySaver(true);
  assert.equal(h.counts.link, 2, 'switching back and forth reuses compiled programs');
  bg.destroy();
}

{
  const h = harness({ visibility: 'hidden' });
  const bg = h.create(OPTS);
  assert.ok(bg);
  assert.equal(h.rafPending(), 0, 'no animation frames for a hidden page');
  h.pumpFrames(3);
  assert.equal(h.counts.draws, 0, 'and no draws either');
  bg.destroy();
}

{
  const h = harness();
  const bg = h.create(OPTS);
  h.pumpFrames(1);
  const readsAfterInit = h.counts.clientWidthReads;
  assert.ok(readsAfterInit > 0, 'the first render must size the buffer');
  h.pumpFrames(5);
  assert.equal(h.counts.clientWidthReads, readsAfterInit,
    'steady frames must not read clientWidth (layout) every frame');
  assert.ok(h.counts.draws >= 5, 'frames still draw');
  bg.destroy();
}

{
  const h = harness();
  const bg = h.create(OPTS);
  bg.destroy();
  assert.equal(h.counts.deleteProgram, 1, 'only the compiled program is deleted');
}

{
  const h = harness({ failLinks: [2] });
  const bg = h.create({ ...OPTS, powerSave: true });
  assert.ok(bg);
  assert.equal(h.counts.link, 1);
  bg.setBatterySaver(false);
  assert.equal(h.counts.link, 2);
  bg.setMode(2);
  h.pumpFrames(1);
  assert.ok(h.counts.draws > 0, 'the working program keeps rendering');
  bg.destroy();
}

{
  const h = harness({ failLinks: [1] });
  const bg = h.create(OPTS);
  assert.equal(bg, null, 'a failed initial program yields no background');
  assert.equal(h.counts.deleteProgram, 1, 'the failed program is deleted before the context is lost');
}

{
  const h = harness({ failFrag: true });
  const bg = h.create(OPTS);
  assert.equal(bg, null, 'a failed fragment compile yields no background');
  assert.equal(h.counts.compile, 2, 'both shaders were attempted');
  assert.equal(h.counts.deleteShader, 2, 'the surviving vertex shader is deleted too');
}

console.log('gl-background-lifecycle tests passed');
