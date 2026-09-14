/**
 * Shared WebGL scaffolding for the new-tab animated backgrounds.
 *
 * Each background supplies fragment sources for its quality tiers; this module
 * owns context creation, the fullscreen triangle pair, the rAF loop (with
 * virtual time so speed changes never jump), resizing, and visibility pausing.
 *
 * Quality tiers are separate *programs*, not a uniform. GLSL ES 1.00 requires
 * constant loop bounds, so a runtime `if (i >= iters) break;` still forces the
 * compiler to unroll the maximum count — a battery-saver uniform saved almost
 * nothing. Baking the counts in as `#define`s is what actually cuts the work.
 */

const VERT_SRC = `attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(`${label} shader compile error:`, gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function buildProgram(gl, fragSrc, label) {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC, label);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc, label);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  // Shaders stay referenced by the program until it is deleted.
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(`${label} program link error:`, gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }

  return {
    prog,
    aPos: gl.getAttribLocation(prog, 'a_pos'),
    uRes: gl.getUniformLocation(prog, 'iResolution'),
    uTime: gl.getUniformLocation(prog, 'iTime'),
    uMode: gl.getUniformLocation(prog, 'u_mode')
  };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object}   opts
 * @param {string}   opts.label       Name used in console diagnostics.
 * @param {string}   opts.fragNormal  Fragment source for the full-quality tier.
 * @param {string}   opts.fragSaver   Fragment source for the battery-saver tier.
 * @param {object}   opts.tiers       `{ normal, saver }`, each `{ dpr, scale, fps }`.
 *                                    `fps` of 0 means uncapped.
 * @param {number}   [opts.mode]      Initial `u_mode` value.
 * @param {boolean}  [opts.powerSave] Start on the saver tier.
 */
export function createGlBackground(canvas, {
  label,
  fragNormal,
  fragSaver,
  tiers,
  mode = 0,
  powerSave = false
} = {}) {
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (!gl) return null;

  const programs = { normal: null, saver: null };

  function getProgram(name) {
    if (!programs[name]) {
      programs[name] = buildProgram(
        gl,
        name === 'saver' ? fragSaver : fragNormal,
        `${label} (${name})`
      );
    }
    return programs[name];
  }

  const initialTier = powerSave ? 'saver' : 'normal';
  if (!getProgram(initialTier)) {
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return null;
  }

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);

  const state = {
    running: false,
    rafId: null,
    virtualMs: 0,
    lastTickMs: 0,
    mode: mode | 0,
    speed: 1,
    powerSave: !!powerSave,
    needsResize: true,
    // Tracks the last size uploaded to iResolution so the uniform is only
    // re-sent when the canvas actually changed size.
    uploadedW: -1,
    uploadedH: -1
  };

  let active = getProgram(state.powerSave ? 'saver' : 'normal');
  let tier = state.powerSave ? tiers.saver : tiers.normal;

  function useActiveProgram() {
    gl.useProgram(active.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(active.aPos);
    gl.vertexAttribPointer(active.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(active.uMode, state.mode);
    // Uniforms are per-program, so the cached size no longer applies.
    state.uploadedW = -1;
    state.uploadedH = -1;
  }

  // Buffer dimensions snap to a multiple of this. Two reasons: a drag-resize
  // fires continuously and every distinct size means a fresh GPU allocation,
  // and the dither's 4x4 Bayer tile is keyed to gl_FragCoord — an unaligned
  // width re-phases the stipple across the whole screen, which reads as
  // sparkle. Snapping keeps the tile phase-locked and cuts reallocations.
  const SIZE_QUANTUM = 4;

  function snap(px) {
    return Math.max(SIZE_QUANTUM, Math.round(px / SIZE_QUANTUM) * SIZE_QUANTUM);
  }

  function resize() {
    state.needsResize = false;
    const dpr = Math.min(window.devicePixelRatio || 1, tier.dpr);
    const w = snap(canvas.clientWidth * dpr * tier.scale);
    const h = snap(canvas.clientHeight * dpr * tier.scale);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function renderOnce() {
    // Resizing and drawing must stay in the same task: assigning canvas.width
    // clears the drawing buffer, so any gap between the two lets the compositor
    // show an empty canvas.
    if (state.needsResize || state.uploadedW < 0 || state.uploadedH < 0) {
      resize();
    }
    if (canvas.width !== state.uploadedW || canvas.height !== state.uploadedH) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(active.uRes, canvas.width, canvas.height);
      state.uploadedW = canvas.width;
      state.uploadedH = canvas.height;
    }
    gl.uniform1f(active.uTime, state.virtualMs / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function frame() {
    if (!state.running) return;
    state.rafId = requestAnimationFrame(frame);

    const now = performance.now();
    const elapsed = now - state.lastTickMs;
    // A pending resize always renders, whatever the frame cap says — see
    // onResize for why skipping it would show a cleared buffer.
    if (!state.needsResize && tier.fps > 0 && elapsed < 1000 / tier.fps) return;

    // Clamped so a backgrounded tab does not lurch forward on return.
    state.virtualMs += Math.min(elapsed, 100) * state.speed;
    state.lastTickMs = now;
    renderOnce();
  }

  function start() {
    if (state.running) return;
    if (document.visibilityState === 'hidden') return;
    state.needsResize = true;
    state.running = true;
    state.lastTickMs = performance.now();
    state.rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (!state.running) return;
    state.running = false;
    if (state.rafId != null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  }

  function setMode(m) {
    state.mode = m | 0;
    gl.useProgram(active.prog);
    gl.uniform1i(active.uMode, state.mode);
    if (!state.running) renderOnce();
  }

  function setSpeed(s) {
    state.speed = Math.max(0, Math.min(3, Number.isFinite(s) ? s : 1));
  }

  function setBatterySaver(enabled) {
    const next = !!enabled;
    if (next === state.powerSave) return;
    const program = getProgram(next ? 'saver' : 'normal');
    if (!program) return;
    state.powerSave = next;
    active = program;
    tier = next ? tiers.saver : tiers.normal;
    useActiveProgram();
    if (state.running) state.lastTickMs = performance.now();
    else renderOnce();
  }

  // Resizing here directly would clear the drawing buffer and then wait up to a
  // whole capped frame (50ms at the dither tier's 20fps) before redrawing —
  // that gap is the flicker. Instead flag it and let the render loop do the
  // resize and the draw back to back. A stopped shader still has to redraw
  // itself, since nothing else will.
  const onResize = () => {
    state.needsResize = true;
    if (!state.running) renderOnce();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') stop();
    else start();
  };

  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);

  function destroy() {
    stop();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    gl.deleteBuffer(buf);
    if (programs.normal) gl.deleteProgram(programs.normal.prog);
    if (programs.saver) gl.deleteProgram(programs.saver.prog);
    // Frees the context immediately rather than waiting for GC, so switching
    // backgrounds cannot pile up contexts against the browser's hard limit.
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  }

  useActiveProgram();
  start();

  return { setMode, setSpeed, setBatterySaver, start, stop, destroy };
}
