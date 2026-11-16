// Camera: a guest's webcam through VDO.Ninja (the guest opens the push link, this views it).
// layer.cam: a camera's id or name, or live data that gives one ({{Roster!Player 1 name}} -> the camera named so).
// The camera's look (brightness, contrast, saturation, warmth) and framing (zoom, x, y, mirror) are set on the
// Cameras page, so every graphic showing it matches.
// Every viewer of a VDO.Ninja stream is another upload for the guest, so only outputs show the live picture;
// the Composer canvas and the Control monitors show a card instead.

// bitrate: what this viewer asks the guest for, in kbps (monitors and previews ask little: less upload for the guest)
export function viewUrl(cam, password, bitrate = 0) {
  if (cam.link) return cam.link + (bitrate && !/[?&](bitrate|videobitrate|vb)=/.test(cam.link) ? (cam.link.includes("?") ? "&" : "?") + "bitrate=" + bitrate : "");
  const q = new URLSearchParams({ view: cam.stream, label: cam.name });
  if (password) q.set("password", password);
  if (bitrate) q.set("bitrate", String(bitrate));
  return "https://vdo.ninja/?" + q.toString() + "&cleanoutput";
}

export function findCam(cams, want) {
  const w = String(want || "").trim().toLowerCase();
  return w ? (cams || []).find(c => c.id === w || (c.name || "").trim().toLowerCase() === w) : null;
}

// the look and framing on the iframe (and the warmth wash over it). box = {w, h, fit}: "cover" fills a frame of
// any shape with the 16:9 picture (the sides or top cropped, no black bars); otherwise the whole picture shows.
export function styleCam(frame, wash, cam, box) {
  const z = +cam.zoom || 1, x = +cam.x || 0, y = +cam.y || 0;
  let W = 100, H = 100, unit = "%";
  if (box && box.fit !== "contain" && box.w && box.h) {
    unit = "px";
    [W, H] = box.w / box.h < 16 / 9 ? [box.h * 16 / 9, box.h] : [box.w, box.w * 9 / 16];
  }
  const bw = unit === "px" ? box.w : 100, bh = unit === "px" ? box.h : 100;
  W *= z; H *= z;
  Object.assign(frame.style, {
    position: "absolute", border: "0", width: W + unit, height: H + unit,
    left: ((bw - W) / 2 + x / 100 * (W - bw) / 2) + unit, top: ((bh - H) / 2 + y / 100 * (H - bh) / 2) + unit,
    transform: cam.mirror ? "scaleX(-1)" : "", pointerEvents: "none",
    filter: `brightness(${cam.bright ?? 100}%) contrast(${cam.contrast ?? 100}%) saturate(${cam.sat ?? 100}%)`,
  });
  const w = +cam.warm || 0;
  Object.assign(wash.style, { position: "absolute", inset: "0", pointerEvents: "none", mixBlendMode: "soft-light",
    background: w > 0 ? "#ff8a2a" : "#2a7bff", opacity: String(Math.min(1, Math.abs(w) / 100 * 0.6)) });
}

export function camera(el, layer, ctx) {
  el.style.overflow = "hidden";
  const cam = findCam(ctx.cams, ctx.resolve(String(layer.cam || "")));
  if (!ctx.liveCams || !cam) {   // (a card: in the Composer and the monitors, or no such camera)
    if (!ctx.cardCams) return;
    Object.assign(el.style, { background: "repeating-linear-gradient(135deg, #1b1b1e 0 14px, #222226 14px 28px)", display: "flex",
      alignItems: "center", justifyContent: "center", color: "#9a9aa3", font: `600 ${Math.max(12, Math.min(layer.h / 6, 40))}px Inter, sans-serif` });
    el.textContent = cam ? cam.name : (layer.cam ? `No camera "${layer.cam}"` : "Camera");
    return;
  }
  el.style.background = layer.bg || "transparent";
  const frame = document.createElement("iframe");
  frame.setAttribute("allow", "autoplay");
  frame.src = viewUrl(cam, ctx.camPassword, ctx.camBitrate);
  const wash = document.createElement("div");
  styleCam(frame, wash, cam, { w: layer.w, h: layer.h, fit: layer.fit });
  el.append(frame, wash);
  el._keep = `${layer.id}|${frame.src}`;   // (kept when the graphic redraws: a new iframe would reconnect)
}
