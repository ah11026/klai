import { RemoteInputState } from "/js/emulator-controls.js";

const cores = new Set(["nes", "snes", "n64", "psx"]);
const params = new URLSearchParams(location.search);
const system = params.get("system");
const filePath = params.get("path");
const status = document.querySelector("#status");
const remoteInputs = new RemoteInputState();
const pendingInputs = new Map();

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
    window.EJS_onGameStart = () => {
      status.textContent = "";
      for (const command of pendingInputs.values()) applyInput(command);
      pendingInputs.clear();
      window.parent.postMessage({ type: "emulator-ready" }, location.origin);
    };
    window.EJS_onLoad = () => { status.textContent = "تم تحميل المحاكي."; };

    const loader = document.createElement("script");
    loader.src = `${window.EJS_pathtodata}loader.js`;
    loader.onerror = () => fail("تعذر تحميل EmulatorJS من CDN. تحقق من الاتصال ثم أعد المحاولة.");
    document.body.append(loader);
  }
}

function applyInput(command) {
  const simulateInput = window.EJS_emulator?.gameManager?.simulateInput;
  if (typeof simulateInput !== "function") return false;
  window.EJS_emulator.gameManager.simulateInput(command.player, command.index, command.value);
  return true;
}

window.addEventListener("message", event => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  if (event.data?.type === "remote-input-release-all") {
    for (const command of remoteInputs.releaseAll()) {
      const key = `${command.player}:${command.index}`;
      if (!applyInput(command)) pendingInputs.set(key, command);
      else pendingInputs.delete(key);
    }
    return;
  }
  if (event.data?.type !== "remote-game-input") return;
  for (const command of remoteInputs.apply(event.data.detail)) {
    const key = `${command.player}:${command.index}`;
    if (applyInput(command)) pendingInputs.delete(key);
    else pendingInputs.set(key, command);
  }
});