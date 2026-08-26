/**
 * Dither background shader for the new-tab page.
 *
 * A slow drifting value-noise field quantised through a 4x4 Bayer ordered
 * dither into a handful of tones — the 1-bit / early-Mac look. Deliberately
 * the cheap background: no raymarching, no per-pixel normals, roughly a dozen
 * ALU ops per fragment against the ocean's thousand-plus wave evaluations.
 *
 * It renders at a low internal scale and is upscaled with `image-rendering:
 * pixelated` (see .bg-dither in newtab.css). That is not only cheaper — the
 * dither pattern reads as deliberate texture at chunky pixel sizes, where
 * bilinear filtering would smear it into grey mush.
 */

import { createGlBackground } from './gl-background.js';

const buildFrag = ({ OCTAVES, WARP, LEVELS }) => `
  precision mediump float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform int u_mode;

  #define OCTAVES ${OCTAVES}
  #define WARP ${WARP}
  #define LEVELS ${LEVELS}.0

  float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  float vnoise(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i),                hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0,1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p){
    float sum = 0.0, amp = 0.5;
    for(int i=0;i<OCTAVES;i++){
      sum += vnoise(p) * amp;
      p = p * 2.03 + 17.3;
      amp *= 0.5;
    }
    return sum;
  }

  // 2x2 ordered dither, composed with itself for the 4x4 Bayer matrix.
  // Branchless and exact — cheaper than sampling a threshold texture.
  float bayer2(vec2 a){
    a = floor(a);
    return fract(a.x * 0.5 + a.y * a.y * 0.75);
  }
  float bayer4(vec2 p){
    return bayer2(p * 0.5) * 0.25 + bayer2(p);
  }

  void main(){
    vec2 uv = gl_FragCoord.xy / iResolution;
    // Aspect-corrected so the bands do not stretch on wide monitors.
    vec2 p = vec2(uv.x * (iResolution.x / iResolution.y), uv.y) * 2.6;

    float t = iTime * 0.06;

#if WARP
    // Domain warp gives the bands their slow curling drift rather than a
    // flat scroll. This is the single most expensive line here; the saver
    // tier drops it.
    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t * 0.7));
    float field = fbm(p + q * 0.9 + vec2(t * 0.5, -t * 0.3));
#else
    float field = fbm(p + vec2(t * 0.5, -t * 0.3));
#endif

    // Vertical ramp so the field reads as a horizon rather than pure noise.
    float grad = smoothstep(-0.15, 1.05, uv.y);
    float value = clamp(field * 0.85 + (1.0 - grad) * 0.42, 0.0, 1.0);
    value = pow(value, 1.25);

    // Ordered dither before quantising: the threshold offset is what turns
    // banding into a stipple pattern.
    float steps = LEVELS - 1.0;
    float dithered = floor(value * steps + bayer4(gl_FragCoord.xy)) / steps;

    vec3 lo, hi;
    if(u_mode == 1){
      lo = vec3(0.035, 0.039, 0.055);
      hi = vec3(0.40, 0.44, 0.52);
    } else {
      lo = vec3(0.36, 0.42, 0.52);
      hi = vec3(0.93, 0.95, 0.98);
    }

    gl_FragColor = vec4(mix(lo, hi, dithered), 1.0);
  }
`;

const FRAG_NORMAL = buildFrag({ OCTAVES: 3, WARP: 1, LEVELS: 4 });
const FRAG_SAVER = buildFrag({ OCTAVES: 2, WARP: 0, LEVELS: 3 });

// dpr is pinned to 1: the point of the effect is chunky pixels, so rendering
// above CSS resolution would only cost power to make the dither finer.
const TIERS = {
  normal: { dpr: 1, scale: 0.35, fps: 30 },
  saver: { dpr: 1, scale: 0.28, fps: 20 }
};

export function initDitherShader(canvas, { mode = 0, powerSave = false } = {}) {
  return createGlBackground(canvas, {
    label: 'Dither',
    fragNormal: FRAG_NORMAL,
    fragSaver: FRAG_SAVER,
    tiers: TIERS,
    mode,
    powerSave
  });
}
