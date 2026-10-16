const cores = new Set(["nes", "snes", "n64", "psx"]);
const params = new URLSearchParams(location.search);
const system = params.get("system");
const filePath = params.get("path");
const status = document.querySelector("#status");

function fail(message) {
  status.textContent = message;
}

if (!cores.has(system) || !filePath?.startsWith(`public/games/${system}/`)) {
  fail("نظام اللعبة أو مسارها غير صالح.");
} else {
  const gameUrl = new URL(`/${filePath.slice("public/".length)}`, location.origin);
  if (gameUrl.origin !== location.origin) {
    fail("يجب أن يكون ملف اللعبة ضمن مكتبة هذا الموقع.");
  } else {
    window.EJS_player = "#game";
    window.EJS_core = system;
    window.EJS_gameUrl = gameUrl.href;
    window.EJS_pathtodata = "https://cdn.emulatorjs.org/stable/data/";
    window.EJS_startOnLoaded = true;
    window.EJS_backgroundColor = "#000000";
    window.EJS_onGameStart = () => { status.textContent = ""; };
    window.EJS_onLoad = () => { status.textContent = "تم تحميل المحاكي."; };

    const loader = document.createElement("script");
    loader.src = `${window.EJS_pathtodata}loader.js`;
    loader.onerror = () => fail("تعذر تحميل EmulatorJS من CDN. تحقق من الاتصال ثم أعد المحاولة.");
    document.body.append(loader);
  }
}

const keys = {
  up: ["ArrowUp", "ArrowUp", 38],
  down: ["ArrowDown", "ArrowDown", 40],
  left: ["ArrowLeft", "ArrowLeft", 37],
  right: ["ArrowRight", "ArrowRight", 39],
  a: ["x", "KeyX", 88],
  b: ["z", "KeyZ", 90],
  x: ["s", "KeyS", 83],
  y: ["a", "KeyA", 65],
  start: ["Enter", "Enter", 13],
  select: ["Shift", "ShiftLeft", 16],
  l1: ["q", "KeyQ", 81],
  r1: ["w", "KeyW", 87]
};

window.addEventListener("message", event => {
  if (event.origin !== location.origin || event.data?.type !== "remote-game-input") return;
  const input = event.data.detail;
  if (input?.player !== 1) return;
  const [key, code, keyCode] = keys[input.button] ?? [];
  if (!key) return;
  const type = input.pressed ? "keydown" : "keyup";
  document.dispatchEvent(new KeyboardEvent(type, {
    key,
    code,
    keyCode,
    which: keyCode,
    bubbles: true,
    cancelable: true
  }));
});