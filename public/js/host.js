const socket = io();
const qr = document.querySelector("#qr");
const qrWrap = document.querySelector(".qr-wrap");
const roomCode = document.querySelector("#roomCode");
const joinUrl = document.querySelector("#joinUrl");
const qrStatus = document.querySelector("#qrStatus");
const players = document.querySelector("#players");
const playerCount = document.querySelector("#playerCount");
const playerTotal = document.querySelector("#playerTotal");
const connection = document.querySelector(".connection");
const connectionLabel = document.querySelector("#connectionLabel");
const inputReadout = document.querySelector("#inputReadout");
const gameStatus = document.querySelector("#gameStatus");
const toast = document.querySelector("#toast");
const libraryList = document.querySelector("#libraryList");
const libraryStatus = document.querySelector("#libraryStatus");
const libraryKey = document.querySelector("#libraryKey");
const emulatorFrame = document.querySelector("#emulatorFrame");
let hostToken = "";
let toastTimeout;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 1800);
}

async function loadQr(code) {
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(code)}/qr`, {
      headers: { Authorization: `Bearer ${hostToken}` }
    });
    if (!response.ok) throw new Error("QR request failed");
    const data = await response.json();
    qr.src = data.qr;
    joinUrl.textContent = data.url;
    qrWrap.classList.add("has-qr");
    qrStatus.textContent = "امسح الرمز بكاميرا جوالك";
  } catch {
    qrStatus.textContent = "تعذر تجهيز الرمز؛ تحقق من عنوان الشبكة.";
    joinUrl.textContent = "";
  }
}

function renderPlayers(list) {
  playerCount.textContent = String(list.length);
  playerTotal.textContent = String(list.length);
  players.replaceChildren();
  if (!list.length) {
    const empty = document.createElement("li");
    empty.className = "empty-player";
    empty.innerHTML = '<span class="empty-plus">+</span><span>أول لاعب له مكان هنا</span>';
    players.append(empty);
    return;
  }

  for (const player of list) {
    const item = document.createElement("li");
    const avatar = document.createElement("span");
    avatar.className = `player-avatar p${player.player}`;
    avatar.textContent = `P${player.player}`;
    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.name;
    const number = document.createElement("span");
    number.className = "player-number";
    number.textContent = `P${player.player}`;
    item.append(avatar, name, number);
    players.append(item);
  }
}

function renderLibrary(data) {
  libraryList.replaceChildren();
  if (!data.enabled) {
    const empty = document.createElement("li");
    empty.className = "library-empty";
    empty.textContent = "مكتبة GitHub غير مهيأة على الخادم.";
    libraryList.append(empty);
    return;
  }
  if (!data.games.length) {
    const empty = document.createElement("li");
    empty.className = "library-empty";
    empty.textContent = "لا توجد ألعاب محفوظة في المستودع بعد.";
    libraryList.append(empty);
    return;
  }

  for (const game of data.games) {
    const item = document.createElement("li");
    item.className = "library-game";
    const details = document.createElement("div");
    details.className = "library-game-details";
    const title = document.createElement("strong");
    title.textContent = game.name;
    const metadata = document.createElement("span");
    metadata.textContent = `${game.system.toUpperCase()} · ${game.license}`;
    details.append(title, metadata);

    const download = document.createElement("a");
    download.className = "download-game";
    download.href = game.downloadUrl;
    download.target = "_blank";
    download.rel = "noopener noreferrer";
    download.textContent = "تنزيل";
    download.setAttribute("aria-label", `تنزيل ${game.name}`);

    const actions = document.createElement("div");
    actions.className = "library-game-actions";
    const play = document.createElement("button");
    play.className = "play-game";
    play.type = "button";
    play.textContent = "تشغيل";
    play.addEventListener("click", () => launchGame(game));
    actions.append(play, download);
    item.append(details, actions);
    libraryList.append(item);
  }
}

function launchGame(game) {
  if (!/^public\/games\/(nes|snes|n64|psx)\//.test(game.path)) {
    libraryStatus.textContent = "مسار اللعبة أو نظامها غير مدعوم.";
    return;
  }
  const url = new URL("/emulator.html", location.origin);
  url.searchParams.set("system", game.system);
  url.searchParams.set("path", game.path);
  document.querySelector("#gameScreen .screen-content").hidden = true;
  emulatorFrame.hidden = false;
  emulatorFrame.src = url.toString();
  gameStatus.textContent = `جارٍ تشغيل ${game.name} عبر EmulatorJS...`;
}

async function refreshLibrary() {
  try {
    const response = await fetch("/api/games");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "تعذر تحميل المكتبة");
    renderLibrary(result);
  } catch (error) {
    libraryList.replaceChildren();
    const empty = document.createElement("li");
    empty.className = "library-empty error";
    empty.textContent = error.message;
    libraryList.append(empty);
  }
}

function readGameMetadata() {
  return {
    name: document.querySelector("#gameName").value.trim(),
    system: document.querySelector("#gameSystem").value,
    license: document.querySelector("#gameLicense").value.trim(),
    licenseUrl: document.querySelector("#gameLicenseUrl").value.trim()
  };
}

async function sendLibraryRequest(url, options, button) {
  if (!libraryKey.value) {
    libraryStatus.textContent = "أدخل مفتاح إدارة المكتبة أولاً.";
    return;
  }
  button.disabled = true;
  libraryStatus.textContent = "جارٍ حفظ اللعبة في GitHub...";
  try {
    const response = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${libraryKey.value}` }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "تعذر حفظ اللعبة");
    libraryStatus.textContent = `حُفظت «${result.game.name}» في مستودعك.`;
    await refreshLibrary();
  } catch (error) {
    libraryStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

document.querySelector("#uploadGame").addEventListener("click", event => {
  const file = document.querySelector("#gameFile").files[0];
  if (!file) {
    libraryStatus.textContent = "اختر ملف اللعبة أولاً.";
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    libraryStatus.textContent = "حجم الملف يتجاوز الحد الأقصى البالغ 15 ميغابايت.";
    return;
  }
  const query = new URLSearchParams({ ...readGameMetadata(), filename: file.name });
  sendLibraryRequest(`/api/games/upload?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file
  }, event.currentTarget);
});

document.querySelector("#importGame").addEventListener("click", event => {
  const payload = {
    ...readGameMetadata(),
    repository: document.querySelector("#sourceRepository").value.trim(),
    branch: document.querySelector("#sourceBranch").value.trim(),
    filePath: document.querySelector("#sourcePath").value.trim()
  };
  sendLibraryRequest("/api/games/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, event.currentTarget);
});

document.querySelector("#refreshLibrary").addEventListener("click", refreshLibrary);
document.querySelectorAll("[data-library-mode]").forEach(button => {
  button.addEventListener("click", () => {
    const activeButton = document.querySelector("[data-library-mode].active");
    activeButton?.classList.remove("active");
    activeButton?.setAttribute("aria-pressed", "false");
    button.classList.add("active");
    button.setAttribute("aria-pressed", "true");
    document.querySelector("#uploadPanel").hidden = button.dataset.libraryMode !== "upload";
    document.querySelector("#importPanel").hidden = button.dataset.libraryMode !== "import";
  });
});

socket.on("connect", () => {
  connection.classList.add("connected");
  connectionLabel.textContent = "متصل بالخادم";
  socket.emit("room:create", async result => {
    if (!result?.ok) {
      qrStatus.textContent = result?.error ?? "تعذر إنشاء الغرفة";
      return;
    }
    hostToken = result.hostToken;
    roomCode.textContent = result.code;
    await loadQr(result.code);
  });
});

socket.on("disconnect", () => {
  connection.classList.remove("connected");
  connectionLabel.textContent = "انقطع الاتصال";
  qrStatus.textContent = "انقطع الاتصال بالخادم";
});

socket.on("room:state", state => renderPlayers(state.players));

socket.on("game:input", event => {
  const action = event.pressed ? "ضغط" : "أفلت";
  inputReadout.textContent = `P${event.player} · ${action} ${event.button}`;
  window.dispatchEvent(new CustomEvent("remote-game-input", { detail: event }));
  emulatorFrame.contentWindow?.postMessage({ type: "remote-game-input", detail: event }, location.origin);
});

socket.on("room:closed", () => {
  qrStatus.textContent = "أغلق المضيف الغرفة";
  renderPlayers([]);
});

document.querySelectorAll("[data-system]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelector(".system-item.selected")?.classList.remove("selected");
    button.classList.add("selected");
    document.querySelector("#gameSystem").value = button.dataset.core;
    gameStatus.textContent = `تم اختيار ${button.dataset.system}. اختر لعبة من المكتبة واضغط «تشغيل».`;
  });
});

document.querySelector("#copyLink").addEventListener("click", async () => {
  const value = joinUrl.textContent;
  if (!value.startsWith("http")) return;
  try {
    await navigator.clipboard.writeText(value);
    showToast("تم نسخ رابط الانضمام");
  } catch {
    showToast("تعذر نسخ الرابط من هذا المتصفح");
  }
});

refreshLibrary();