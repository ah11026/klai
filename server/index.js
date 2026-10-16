import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import QRCode from "qrcode";
import { RoomStore } from "./rooms.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 16 * 1024,
  pingInterval: 10000,
  pingTimeout: 20000
});
const rooms = new RoomStore();
const inputTimes = new Map();

app.use(express.static(path.join(directory, "../public")));
app.get("/", (_request, response) => response.redirect(302, "/host.html"));
app.get("/health", (_request, response) => response.status(200).json({ ok: true }));

app.get("/api/rooms/:code/qr", async (request, response) => {
  const { code } = request.params;
  const authorization = request.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!rooms.authenticateHost(code, token)) {
    return response.status(403).json({ error: "غير مصرح" });
  }

  const configuredBase = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  let baseUrl;
  try {
    baseUrl = new URL(configuredBase || `${request.protocol}://${request.get("host")}`);
    if (!["http:", "https:"].includes(baseUrl.protocol)) throw new Error("Invalid protocol");
  } catch {
    return response.status(500).json({ error: "عنوان الخادم العام غير صالح" });
  }

  const joinUrl = new URL("/controller.html", baseUrl);
  joinUrl.searchParams.set("room", code);

  try {
    response.json({ url: joinUrl.toString(), qr: await QRCode.toDataURL(joinUrl.toString()) });
  } catch {
    response.status(500).json({ error: "تعذر إنشاء رمز QR" });
  }
});

io.on("connection", socket => {
  socket.on("room:create", ack => {
    const room = rooms.create(socket.id);
    if (!room) return ack?.({ ok: false, error: "لديك غرفة نشطة بالفعل" });
    socket.join(room.code);
    ack?.({ ok: true, ...room });
  });

  socket.on("room:join", (payload, ack) => {
    const result = rooms.join(payload?.code, socket.id, payload?.name);
    if (!result.ok) return ack?.(result);
    socket.join(result.code);
    ack?.({ ok: true, player: result.player, code: result.code });
    io.to(rooms.rooms.get(result.code).hostId).emit("room:state", result.state);
  });

  socket.on("input", (payload, ack) => {
    const now = Date.now();
    const recent = (inputTimes.get(socket.id) ?? []).filter(time => now - time < 1000);
    if (recent.length >= 120) {
      inputTimes.set(socket.id, recent);
      return ack?.({ ok: false, error: "تجاوزت معدل الإدخال المسموح" });
    }
    recent.push(now);
    inputTimes.set(socket.id, recent);

    const result = rooms.input(socket.id, payload);
    if (!result.ok) return ack?.(result);
    if (result.changed) io.to(result.hostId).emit("game:input", result.event);
    ack?.({ ok: true });
  });

  socket.on("disconnect", () => {
    inputTimes.delete(socket.id);
    const result = rooms.leave(socket.id);
    if (!result) return;

    if (result.type === "closed") {
      for (const playerId of result.playerIds) {
        io.to(playerId).emit("room:closed");
      }
      io.in(result.code).socketsLeave(result.code);
      return;
    }

    for (const event of result.released) io.to(result.hostId).emit("game:input", event);
    io.to(result.hostId).emit("room:state", result.state);
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, "0.0.0.0", () => {
  console.log(`Klai party play listening on port ${port}`);
});