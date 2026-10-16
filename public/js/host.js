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
});

socket.on("room:closed", () => {
  qrStatus.textContent = "أغلق المضيف الغرفة";
  renderPlayers([]);
});

document.querySelectorAll("[data-system]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelector(".system-item.selected")?.classList.remove("selected");
    button.classList.add("selected");
    gameStatus.textContent = `تم اختيار ${button.dataset.system}. أضف نواة المحاكي وملف اللعبة لبدء التشغيل.`;
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