// Shader: an animated GPU effect (WebGL fragment shader) filling the layer's box. A few looks are built in;
// "Custom" takes any GLSL that sets gl_FragColor and may use u_time, u_res, u_a, u_b, u_c (the three colours).
// (Idea from ShaderPad, MIT, by misery.co; this is our own small player, no library.)
import { content } from "./box.js";

const HEAD = `precision mediump float;
uniform float u_time; uniform vec2 u_res; uniform vec3 u_a, u_b, u_c;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * n(p); p *= 2.0; a *= 0.5; } return v; }
`;

export const LOOKS = {
  aurora: ["Aurora", `void main() { vec2 uv = gl_FragCoord.xy / u_res; float t = u_time * 0.15;
  float f = fbm(vec2(uv.x * 3.0 + t, uv.y * 1.5 - t * 0.5) + fbm(uv * 2.0 - t));
  vec3 c = mix(u_a, u_b, smoothstep(0.2, 0.8, f)); c = mix(c, u_c, smoothstep(0.55, 0.95, f * uv.y + 0.2));
  gl_FragColor = vec4(c, 1.0); }`],
  plasma: ["Plasma", `void main() { vec2 uv = gl_FragCoord.xy / u_res.y; float t = u_time * 0.5;
  float v = sin(uv.x * 6.0 + t) + sin(uv.y * 5.0 - t * 1.3) + sin((uv.x + uv.y) * 4.0 + t * 0.7) + sin(length(uv - 0.8) * 8.0 - t);
  v = v * 0.25 + 0.5; vec3 c = v < 0.5 ? mix(u_a, u_b, v * 2.0) : mix(u_b, u_c, v * 2.0 - 1.0);
  gl_FragColor = vec4(c, 1.0); }`],
  glow: ["Pulse glow", `void main() { vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y; float d = length(uv);
  float p = 0.55 + 0.45 * sin(u_time * 1.6); float g = exp(-d * (3.5 - p)) ;
  vec3 c = mix(u_a, u_b, g) + u_c * pow(g, 4.0) * p; gl_FragColor = vec4(c, 1.0); }`],
  grid: ["Moving grid", `void main() { vec2 uv = gl_FragCoord.xy / u_res; vec2 p = (uv - vec2(0.5, 0.55)); float y = max(0.02, -p.y);
  vec2 g = vec2(p.x / y, 1.0 / y + u_time * 0.8); vec2 l = abs(fract(g * 0.5) - 0.5) / fwidth(g * 0.5);
  float line = (1.0 - min(min(l.x, l.y), 1.0)) * smoothstep(0.0, 0.25, -p.y); float sky = smoothstep(0.0, 0.5, p.y + 0.05);
  vec3 c = mix(u_a, u_b, uv.y) + u_c * line; c = mix(c, u_b, sky * 0.6); gl_FragColor = vec4(c, 1.0); }`],
  smoke: ["Smoke", `void main() { vec2 uv = gl_FragCoord.xy / u_res.y; float t = u_time * 0.1;
  vec2 q = vec2(fbm(uv + t), fbm(uv + vec2(5.2, 1.3) - t)); float f = fbm(uv * 1.5 + 2.0 * q);
  vec3 c = mix(u_a, u_b, clamp(f * f * 2.0, 0.0, 1.0)); c = mix(c, u_c, clamp(length(q) * 0.6 - 0.2, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0); }`],
};

const rgb = s => { const m = /^#?([0-9a-f]{6})$/i.exec(String(s || "").trim()); const v = m ? parseInt(m[1], 16) : 0xffffff; return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };

function program(gl, frag) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }"));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

export function shader(el, layer, ctx) {
  const scale = Math.min(1, +layer.quality || 0.5);   // (drawn at part size and stretched: soft looks need few pixels)
  const cv = document.createElement("canvas");
  cv.width = Math.max(2, Math.round((+layer.w || 600) * scale));
  cv.height = Math.max(2, Math.round((+layer.h || 400) * scale));
  cv.style.cssText = "width:100%;height:100%;display:block";
  el.appendChild(cv);
  const gl = cv.getContext("webgl", { premultipliedAlpha: false, alpha: true, preserveDrawingBuffer: false });
  if (!gl) return;
  gl.getExtension("OES_standard_derivatives");
  const look = LOOKS[layer.look] ? LOOKS[layer.look][1] : (layer.look === "custom" && layer.code ? layer.code : LOOKS.aurora[1]);
  let p;
  try {
    p = program(gl, (layer.look === "custom" && /GL_OES_standard_derivatives/.test(look) ? "" : "#extension GL_OES_standard_derivatives : enable\n") + HEAD + look);
  } catch (e) {
    el.title = "Shader error: " + e.message;
    return;
  }
  gl.useProgram(p);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(p, "p");
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const U = k => gl.getUniformLocation(p, k);
  const col = k => rgb(content(layer, k, ctx.values, ctx.resolve));
  gl.uniform3fv(U("u_a"), col("a")); gl.uniform3fv(U("u_b"), col("b")); gl.uniform3fv(U("u_c"), col("c"));
  gl.uniform2f(U("u_res"), cv.width, cv.height);
  const ut = U("u_time"), speed = +layer.speed > 0 ? +layer.speed : 1, t0 = performance.now();
  let seen = false;
  const frame = now => {
    if (!el.isConnected && (seen || now - t0 > 15000)) { gl.getExtension("WEBGL_lose_context")?.loseContext(); return; }
    else seen = true;
    gl.uniform1f(ut, (now - t0) / 1000 * speed);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
