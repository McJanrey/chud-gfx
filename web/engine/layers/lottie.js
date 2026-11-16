// Lottie: an After Effects animation exported as JSON (Bodymovin), drawn with lottie-web (web/vendor, MIT).
import { content } from "./box.js";

let loading = null;
function lib() {
  if (window.lottie) return Promise.resolve(window.lottie);
  return loading || (loading = new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = new URL("../../vendor/lottie_light.min.js", import.meta.url).href;
    s.onload = () => ok(window.lottie);
    s.onerror = fail;
    document.head.appendChild(s);
  }));
}

export function lottie(el, layer, ctx) {
  const src = content(layer, "src", ctx.values, ctx.resolve);
  if (!src) return;
  lib().then(L => {
    const anim = L.loadAnimation({ container: el, renderer: "svg", loop: layer.loop !== false, autoplay: true, path: ctx.url(src),
      rendererSettings: { preserveAspectRatio: layer.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet" } });
    if (+layer.speed > 0) anim.setSpeed(+layer.speed);
    const watch = setInterval(() => { if (!el.isConnected && el._seen) { clearInterval(watch); anim.destroy(); } el._seen = el._seen || el.isConnected; }, 1000);
  }, () => {});
}
