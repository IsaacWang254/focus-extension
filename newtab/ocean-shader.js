/**
 * Ocean background shader for the new-tab page.
 *
 * Faithful port of afl_ext's "Ocean" (shadertoy MdXyzX, MIT License) for the
 * "classic" light-theme variant, plus a night-mode variant with stars and moon.
 *
 * The iteration counts are injected as `#define`s so each quality tier compiles
 * its own program with genuinely constant loop bounds — see gl-background.js
 * for why a runtime break was costing full price.
 */

import { createGlBackground } from './gl-background.js';

const buildFrag = ({
  ITERATIONS_RAYMARCH,
  ITERATIONS_NORMAL,
  RAYMARCH_STEPS,
  POWER_SAVE
}) => `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform int u_mode;

  #define PI 3.14159265359
  #define DRAG_MULT 0.38
  #define WATER_DEPTH 1.0
  #define CAMERA_HEIGHT 1.5
  #define ITERATIONS_RAYMARCH ${ITERATIONS_RAYMARCH}
  #define ITERATIONS_NORMAL ${ITERATIONS_NORMAL}
  #define RAYMARCH_STEPS ${RAYMARCH_STEPS}
  #define POWER_SAVE ${POWER_SAVE}

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

  // Two fixed-count variants instead of one parameterised loop: the raymarch
  // and the normal pass need different depths, and a shared "iters" argument
  // would force both to unroll to the larger of the two.
  float getwavesRaymarch(vec2 pos){
    float phaseShift = length(pos) * 0.1;
    float iter = 0.0, freq = 1.0, tm = 2.0, weight = 1.0;
    float sumV = 0.0, sumW = 0.0;
    for(int i=0;i<ITERATIONS_RAYMARCH;i++){
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

  float getwavesNormal(vec2 pos){
    float phaseShift = length(pos) * 0.1;
    float iter = 0.0, freq = 1.0, tm = 2.0, weight = 1.0;
    float sumV = 0.0, sumW = 0.0;
    for(int i=0;i<ITERATIONS_NORMAL;i++){
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
      float h = getwavesRaymarch(pos.xz)*depth - depth;
      if(h + 0.01 > pos.y) return distance(pos, cam);
      pos += dir * (pos.y - h);
    }
    return distance(start, cam);
  }

  vec3 normalAt(vec2 pos, float e, float depth){
    vec2 ex = vec2(e, 0.0);
    float H = getwavesNormal(pos)*depth;
    vec3 a = vec3(pos.x, H, pos.y);
    return normalize(cross(
      a - vec3(pos.x - e, getwavesNormal(pos - ex.xy)*depth, pos.y),
      a - vec3(pos.x, getwavesNormal(pos + ex.yx)*depth, pos.y + e)
    ));
  }

  vec3 getRay(vec2 frag){
    vec2 uv = ((frag / iResolution) * 2.0 - 1.0) * vec2(iResolution.x/iResolution.y, 1.0);
    vec3 proj = normalize(vec3(uv.x, uv.y, 1.5));
    // 0.14 tilt matches earendil's framing (more sky, gentler horizon)
    return rotAxis(vec3(1,0,0), 0.14) * proj;
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

  // Light mode keeps the same sun direction and atmospheric lighting, but
  // hides the visible solar disc from the sky itself.
  vec3 getClassicSky(vec3 d){ return getAtmosphere(d); }

  float stars(vec3 d){
    if(d.y < 0.02) return 0.0;
    float azim = atan(d.z, d.x) / (2.0 * PI) + 0.5;
    vec2 uv = vec2(azim, clamp(d.y, 0.0, 1.0));
    vec2 gridSize = vec2(300.0, 130.0);
    vec2 cell = floor(uv * gridSize);
    vec2 cellUv = fract(uv * gridSize);
    float r = hash21(cell);
    if (r < 0.88) return 0.0;
    vec2 starPos = vec2(0.2 + hash21(cell + 0.11) * 0.6,
                        0.2 + hash21(cell + 0.13) * 0.6);
    float dist = length(cellUv - starPos);
    float size = 0.06 + hash21(cell + 0.17) * 0.05;
    float core = smoothstep(size, 0.0, dist);
    float halo = smoothstep(size * 2.8, 0.0, dist) * 0.38;
    float brightness = mix(0.95, 1.28, hash21(cell + 0.23));
#if POWER_SAVE
    float flicker = 1.0;
#else
    float flicker = 0.85 + 0.15 * sin(iTime * (0.7 + hash21(cell + 0.29) * 1.3)
                                      + hash21(cell + 0.31) * 6.28);
#endif
    float horizonFade = smoothstep(0.02, 0.16, d.y);
    return (core + halo) * brightness * flicker * horizonFade;
  }

  vec3 getNightSky(vec3 d){
    // Flat grey sky — the time-of-day light source does NOT affect the sky,
    // only the water. Stars are the only sky feature.
    vec3 color = vec3(0.12);
    color += vec3(1.0) * stars(d) * 2.0;
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
    vec3 C;
    float starField = 0.0;
    if(ray.y >= 0.0){
      if(u_mode == 1){
        starField = stars(ray);
      }
      C = skyFor(ray);
    } else {
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

      if(u_mode == 1){
        // Water reflects the flat grey sky, plus a pinpointed specular
        // highlight toward the time-of-day direction (the "sun"). The
        // highlight is narrow — only a small glossy spot, not a full
        // horizon band.
        vec3 skyRefl = vec3(0.12);
        float spec = pow(max(0.0, dot(R, getSunDirection())), 96.0);
        vec3 reflection = skyRefl + vec3(1.4) * spec;
        vec3 scattering = vec3(0.04, 0.04, 0.045) * (0.2 + (hitPos.y + WATER_DEPTH) / WATER_DEPTH);
        C = fresnel * reflection + scattering;
      } else {
        vec3 reflection = getAtmosphere(R) + getSun(R);
        vec3 scattering = vec3(0.0293, 0.0698, 0.1717) * 0.1 * (0.2 + (hitPos.y + WATER_DEPTH) / WATER_DEPTH);
        C = fresnel * reflection + scattering;
      }
    }

    vec3 finalColor = acesTonemap(C * 2.0);

    if(u_mode == 1){
      // Film-grain post-process matching earendil: convert to grayscale,
      // add gaussian-ish noise, then remap to a dark→light palette.
      float gray = dot(finalColor, vec3(0.299, 0.587, 0.114));
#if !POWER_SAVE
      vec2 nuv = gl_FragCoord.xy / iResolution;
      float seed = dot(nuv * iResolution, vec2(12.9898, 78.233));
      float n = fract(sin(seed) * 43758.5453 + iTime * 1.5);
      float o = 0.36;
      n = (1.0 / (o * 2.5066)) * exp(-(n * n) / (2.0 * o * o));
      gray = clamp(gray + n * (1.0 - gray) * 0.065, 0.0, 1.0);
#endif
      gray = pow(gray, 1.6);
      finalColor = mix(vec3(0.01), vec3(0.42), gray);
      finalColor += vec3(1.0) * starField * 0.48;
    }

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

const FRAG_NORMAL = buildFrag({
  ITERATIONS_RAYMARCH: 8,
  ITERATIONS_NORMAL: 24,
  RAYMARCH_STEPS: 32,
  POWER_SAVE: 0
});

const FRAG_SAVER = buildFrag({
  ITERATIONS_RAYMARCH: 4,
  ITERATIONS_NORMAL: 10,
  RAYMARCH_STEPS: 14,
  POWER_SAVE: 1
});

const TIERS = {
  normal: { dpr: 2, scale: 0.55, fps: 0 },
  saver: { dpr: 1, scale: 0.4, fps: 24 }
};

export function initOceanShader(canvas, { mode = 0, powerSave = false } = {}) {
  return createGlBackground(canvas, {
    label: 'Ocean',
    fragNormal: FRAG_NORMAL,
    fragSaver: FRAG_SAVER,
    tiers: TIERS,
    mode,
    powerSave
  });
}
