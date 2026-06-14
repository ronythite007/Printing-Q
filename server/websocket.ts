import { WebSocketServer } from "ws";
import { state } from "./state.js";
import { logger } from "./logger.js";

let wss: WebSocketServer | null = null;

export function createWebSocketServer(server: import("http").Server) {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket) => {
    logger.info("New WebSocket client connected", { clientCount: wss?.clients.size });
    socket.send(JSON.stringify({ type: "status", status: state.status, qr: state.qr }));
    socket.send(JSON.stringify({ type: "queue", queue: state.queue }));
    for (const document of state.documents.slice(0, 10)) {
      socket.send(JSON.stringify({ type: "document", document }));
    }
  });

  return wss;
}

export function broadcast(payload: unknown) {
  const message = JSON.stringify(payload);
  if (!wss) return;
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}
