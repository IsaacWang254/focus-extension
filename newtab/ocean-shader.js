/**
 * Ocean background shader for the new-tab page.
 *
 * Faithful port of afl_ext's "Ocean" (shadertoy MdXyzX, MIT License) for the
 * "classic" light-theme variant, plus a night-mode variant with stars and moon.
 */

const VERT_SRC = `attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG_SRC = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform int u_mode;

  #define PI 3.14159265359
  #define DRAG_MULT 0.38
  #define WATER_DEPTH 1.0
  #define CAMERA_HEIGHT 1.5
  #define ITERATIONS_RAYMARCH 8
  #define ITERATIONS_NORMAL 24
  #define RAYMARCH_STEPS 32

  float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  mat3 rotAxis(vec3 axis, float a){
    float s=sin(a), c=cos(a), oc=1.0-c;
    return mat3(
      oc*axis.x*axis.x+c, oc*axis.x*axis.y-axis.z*s, oc*axis.z*axis.x+axis.y*s,
      oc*axis.x*axis.y+axis.z*s, oc*axis.y*axis.y+c, oc*axis.y*axis.z-axis.x*s,
      oc*axis.z*axis.x-axis.y*s, oc*axis.y*axis.z+axis.x*s, oc*axis.z*axis.z+c
    );
  }

  vec2 wavedx(vec2 pos, vec2 dir, float f, float ts){
    float x = dot(dir, pos) * f + ts;
    float w = exp(sin(x) - 1.0);
    return vec2(w, -w * cos(x));
  }

  float getwaves(vec2 pos, int iters){
    float phaseShift = length(pos) * 0.1;
    float iter = 0.0, freq = 1.0, tm = 2.0, weight = 1.0;
    float sumV = 0.0, sumW = 0.0;
    for(int i=0;i<36;i++){
      if(i >= iters) break;
      vec2 p = vec2(sin(iter), cos(iter));
      vec2 r = wavedx(pos, p, freq, iTime*tm + phaseShift);
      pos += p * r.y * weight * DRAG_MULT;
      sumV += r.x * weight;
      sumW += weight;
      weight = mix(weight, 0.0, 0.2);
      freq *= 1.18;
      tm *= 1.07;
      iter += 1232.399963;
    }
    return sumV / sumW;
  }

  float raymarchwater(vec3 cam, vec3 start, vec3 end, float depth){
    vec3 pos = start;
    vec3 dir = normalize(end - start);
    for(int i=0;i<RAYMARCH_STEPS;i++){
      float h = getwaves(pos.xz, ITERATIONS_RAYMARCH)*depth - depth;
      if(h + 0.01 > pos.y) return distance(pos, cam);
      pos += dir * (pos.y - h);
    }
    return distance(start, cam);
  }

  vec3 normalAt(vec2 pos, float e, float depth){
    vec2 ex = vec2(e, 0.0);
    float H = getwaves(pos, ITERATIONS_NORMAL)*depth;
    vec3 a = vec3(pos.x, H, pos.y);
    return normalize(cross(
      a - vec3(pos.x - e, getwaves(pos - ex.xy, ITERATIONS_NORMAL)*depth, pos.y),
      a - vec3(pos.x, getwaves(pos + ex.yx, ITERATIONS_NORMAL)*depth, pos.y + e)
    ));
  }

  vec3 getRay(vec2 frag){
    vec2 uv = ((frag / iResolution) * 2.0 - 1.0) * vec2(iResolution.x/iResolution.y, 1.0);
    vec3 proj = normalize(vec3(uv.x, uv.y, 1.5));
    return rotAxis(vec3(1,0,0), 0.18) * proj;
  }

  float intersectPlane(vec3 o, vec3 d, vec3 p, vec3 n){
    return clamp(dot(p - o, n) / dot(d, n), -1.0, 9991999.0);
  }

  vec3 getSunDirection() {
    return normalize(vec3(-0.0773502691896258, 0.45, 0.5773502691896258));
  }

  vec3 extra_cheap_atmosphere(vec3 raydir, vec3 sundir) {
    float t1 = 1.0 / (raydir.y * 1.0 + 0.1);
    float t2 = 1.0 / (sundir.y * 11.0 + 1.0);
    float raysundt = pow(abs(dot(sundir, raydir)), 2.0);
    float sundt = pow(max(0.0, dot(sundir, raydir)), 8.0);
    float mymie = sundt * t1 * 0.2;
    vec3 suncolor = mix(vec3(1.0), max(vec3(0.0), vec3(1.0) - vec3(5.5, 13.0, 22.4) / 22.4), t2);
    vec3 bluesky = vec3(5.5, 13.0, 22.4) / 22.4 * suncolor;
    vec3 bluesky2 = max(vec3(0.0), bluesky - vec3(5.5, 13.0, 22.4) * 0.002 * (t1 + -6.0 * sundir.y * sundir.y));
    bluesky2 *= t1 * (0.24 + raysundt * 0.24);
    return bluesky2 * (1.0 + 1.0 * pow(1.0 - raydir.y, 3.0));
  }

  vec3 getAtmosphere(vec3 dir) { return extra_cheap_atmosphere(dir, getSunDirection()) * 0.5; }
  float getSun(vec3 dir) { return pow(max(0.0, dot(dir, getSunDirection())), 720.0) * 210.0; }

  vec3 getClassicSky(vec3 d){ return getAtmosphere(d) + getSun(d); }

  float stars(vec3 d){
    if(d.y < 0.04) return 0.0;
    float azim = atan(d.z, d.x) / (2.0 * PI) + 0.5;
    vec2 uv = vec2(azim, clamp(d.y, 0.0, 1.0));
    vec2 gridSize = vec2(260.0, 110.0);
    vec2 cell = floor(uv * gridSize);
    vec2 cellUv = fract(uv * gridSize);
    float r = hash21(cell);
    if (r < 0.94) return 0.0;
    vec2 starPos = vec2(0.25 + hash21(cell + 0.11) * 0.5,
                        0.25 + hash21(cell + 0.13) * 0.5);
    float dist = length(cellUv - starPos);
    float size = 0.045 + hash21(cell + 0.17) * 0.03;
    float core = smoothstep(size, 0.0, dist);
    float brightness = mix(0.5, 1.0, hash21(cell + 0.23));
    float flicker = 0.8 + 0.2 * sin(iTime * (0.7 + hash21(cell + 0.29) * 1.3)
                                   + hash21(cell + 0.31) * 6.28);
    float horizonFade = smoothstep(0.04, 0.22, d.y);
    return core * brightness * flicker * horizonFade;
  }

  vec3 getNightSky(vec3 d){
    vec3 topColor = vec3(0.012, 0.018, 0.048);
    vec3 botColor = vec3(0.03, 0.04, 0.075);
    vec3 color = mix(botColor, topColor, smoothstep(0.0, 0.5, d.y));
    color += vec3(0.92, 0.96, 1.0) * stars(d);
    vec3 moonDir = normalize(vec3(0.4, 0.35, 0.82));
    float moonDot = max(0.0, dot(d, moonDir));
    float moonDisc = smoothstep(0.9990, 0.9998, moonDot);
    float moonHalo = pow(moonDot, 220.0) * 0.3;
    color += vec3(0.88, 0.91, 0.96) * (moonDisc * 2.0 + moonHalo);
    float horizon = 1.0 - smoothstep(0.0, 0.15, d.y);
    color += vec3(0.06, 0.10, 0.18) * horizon * 0.3;
    return color;
  }

  vec3 skyFor(vec3 d){
    if(u_mode == 1) return getNightSky(d);
    return getClassicSky(d);
  }

  vec3 acesTonemap(vec3 c){
    mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
    mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
    vec3 v = m1 * c;
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.432951) + 0.238081;
    return pow(clamp(m2 * (a/b), 0.0, 1.0), vec3(1.0/2.2));
  }

  void main(){
    vec3 ray = getRay(gl_FragCoord.xy);
    if(ray.y >= 0.0){
      vec3 C = skyFor(ray);
      gl_FragColor = vec4(acesTonemap(C * 2.0), 1.0);
      return;
    }

    vec3 origin = vec3(iTime*0.2, CAMERA_HEIGHT, 1.0);
    float hiHit = intersectPlane(origin, ray, vec3(0), vec3(0,1,0));
    float loHit = intersectPlane(origin, ray, vec3(0,-WATER_DEPTH,0), vec3(0,1,0));
    vec3 hiPos = origin + ray*hiHit;
    vec3 loPos = origin + ray*loHit;

    float dist = raymarchwater(origin, hiPos, loPos, WATER_DEPTH);
    vec3 hitPos = origin + ray*dist;
    vec3 N = normalAt(hitPos.xz, 0.01, WATER_DEPTH);
    N = mix(N, vec3(0,1,0), 0.8 * min(1.0, sqrt(dist*0.01)*1.1));

    float fresnel = 0.04 + (1.0 - 0.04) * pow(1.0 - max(0.0, dot(-N, ray)), 5.0);
    vec3 R = normalize(reflect(ray, N));
    R.y = abs(R.y);

    vec3 C;
    if(u_mode == 1){
      vec3 reflection = getNightSky(R);
      vec3 scattering = vec3(0.015, 0.02, 0.035) * (0.2 + (hitPos.y + WATER_DEPTH) / WATER_DEPTH);
      vec3 moonDir = normalize(vec3(0.4, 0.35, 0.82));
      float spec = pow(max(0.0, dot(R, moonDir)), 24.0);
      C = fresnel * reflection + scattering + spec * vec3(0.85, 0.88, 0.95) * 0.3 * fresnel;
      float fogAmount = 1.0 - exp(-dist * 0.02);
      C = mix(C, vec3(0.03, 0.04, 0.07), fogAmount);
      C *= 1.7;
    } else {
      vec3 reflection = getAtmosphere(R) + getSun(R);
      vec3 scattering = vec3(0.0293, 0.0698, 0.1717) * 0.1 * (0.2 + (hitPos.y + WATER_DEPTH) / WATER_DEPTH);
      C = fresnel * reflection + scattering;
    }

    gl_FragColor = vec4(acesTonemap(C * 2.0), 1.0);
  }
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('Ocean shader compile error:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function initOceanShader(canvas, { mode = 0 } = {}) {
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (!gl) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Ocean shader link error:', gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'iResolution');
  const uTime = gl.getUniformLocation(prog, 'iTime');
  const uMode = gl.getUniformLocation(prog, 'u_mode');
  gl.uniform1i(uMode, mode);

  const state = {
    running: false,
    rafId: null,
    startMs: performance.now(),
    accumMs: 0,
    lastResumeMs: performance.now(),
    mode,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    scale: 0.55,
  };

  function resize() {
    const w = Math.max(1, Math.floor(canvas.clientWidth * state.dpr * state.scale));
    const h = Math.max(1, Math.floor(canvas.clientHeight * state.dpr * state.scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function frame() {
    if (!state.running) return;
    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    const elapsedSec = (state.accumMs + (performance.now() - state.lastResumeMs)) / 1000;
    gl.uniform1f(uTime, elapsedSec);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    state.rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (state.running) return;
    state.running = true;
    state.lastResumeMs = performance.now();
    state.rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (!state.running) return;
    state.accumMs += performance.now() - state.lastResumeMs;
    state.running = false;
    if (state.rafId != null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  }

  function setMode(m) {
    state.mode = m | 0;
    gl.useProgram(prog);
    gl.uniform1i(uMode, state.mode);
    if (!state.running) {
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      const elapsedSec = state.accumMs / 1000;
      gl.uniform1f(uTime, elapsedSec);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  const onResize = () => resize();
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
    gl.deleteProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  }

  start();

  return { setMode, start, stop, destroy };
}
