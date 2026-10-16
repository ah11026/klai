const socket = io();
const roomCode = new URLSearchParams(location.search).get("room");
const status = document.querySelector("#status");
const padStatus = document.querySelector("#padStatus");
const pad = document.querySelector("#pad");
const join = document.querySelector("#join");
const joinButton = document.querySelector("#joinButton");
const pressed = new Set();
let joined = false;

function send(button, down) {
  if (!joined) return;
  if (down) pressed.add(button);
  else pressed.delete(button);
  socket.emit("input", { button, pressed: down });
}

function releaseAll() {
  for (const button of [...pressed]) send(button, false);
  document.querySelectorAll("[data-button].pressed").forEach(button => button.classList.remove("pressed"));
}

function showJoin(message) {
  releaseAll();
  joined = false;
  pad.classList.remove("active");
  join.hidden = false;
  if (message) status.textContent = message;
}

joinButton.addEventListener("click", () => {
  if (!roomCode || !/^\d{6}$/.test(roomCode)) {
    status.textContent = "رابط الغرفة غير صالح";
    return;
  }
  if (!socket.connected) {
    status.textContent = "جارٍ الاتصال بالخادم...";
    return;
  }

  joinButton.disabled = true;
  socket.emit("room:join", {
    code: roomCode,
    name: document.querySelector("#name").value
  }, result => {
    joinButton.disabled = false;
    if (!result?.ok) {
      status.textContent = result?.error ?? "تعذر الانضمام";
      return;
    }
    joined = true;
    join.hidden = true;
    pad.classList.add("active");
    document.querySelector("#playerLabel").textContent = `اللاعب ${result.player}`;
    padStatus.textContent = "متصل بالغرفة";
  });
});

document.querySelector("#name").addEventListener("keydown", event => {
  if (event.key === "Enter") joinButton.click();
});

document.querySelectorAll("[data-button]").forEach(button => {
  const name = button.dataset.button;
  button.addEventListener("pointerdown", event => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    button.classList.add("pressed");
    send(name, true);
  });

  const release = event => {
    event.preventDefault();
    button.classList.remove("pressed");
    send(name, false);
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", () => {
    button.classList.remove("pressed");
    send(name, false);
  });
});

window.addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseAll();
});

socket.on("connect", () => {
  if (!joined) status.textContent = roomCode ? "أدخل اسمك للانضمام" : "رابط الغرفة غير صالح";
});

socket.on("disconnect", () => {
  showJoin("انقطع الاتصال؛ أعد الانضمام عند عودة الشبكة.");
});

socket.on("room:closed", () => showJoin("أغلق المضيف الغرفة."));