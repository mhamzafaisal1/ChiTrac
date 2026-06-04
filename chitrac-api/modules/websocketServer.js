const { randomUUID } = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");

const DEFAULT_WS_PORT = 50001;

function createSessionId() {
  if (typeof randomUUID === "function") return randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureClientSessionState(server) {
  if (!Array.isArray(server.clientSessions)) server.clientSessions = [];
  if (!(server.clientSessionLookup instanceof Map)) {
    server.clientSessionLookup = new Map();
  }
}

function safeServerInfo(server) {
  return {
    config: server.config,
    defaults: server.defaults,
    cache: server.cache
      ? {
          today: server.cache.today,
          currentShift: server.cache.currentShift,
        }
      : undefined,
    clientSessions: Array.isArray(server.clientSessions)
      ? server.clientSessions.map((session) => ({
          sessionId: session.sessionId,
          connectedAt: session.connectedAt,
          remoteAddress: session.remoteAddress,
          readyState: session.ws?.readyState,
        }))
      : [],
    scheduledJobs: server.scheduledJobs
      ? Object.keys(server.scheduledJobs)
      : [],
    appRoot: server.appRoot ? String(server.appRoot) : undefined,
  };
}

function safeJson(payload) {
  return JSON.stringify(payload, (_key, value) => {
    if (value instanceof Map) return Object.fromEntries(value);
    if (typeof value === "function") return undefined;
    return value;
  });
}

async function writeWsLog(server, collectionName, payload) {
  try {
    if (!server.logDb) return;
    await server.logDb.collection(collectionName).insertOne({
      ...payload,
      timestamp: new Date(),
    });
  } catch (error) {
    if (server.logger) {
      server.logger.warn(`[websocket] Failed to write ${collectionName}: ${error.message}`);
    }
  }
}

function sendJson(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(safeJson(payload));
  return true;
}

function removeClientSession(server, sessionId) {
  const index = server.clientSessions.findIndex((session) => session.sessionId === sessionId);
  if (index >= 0) {
    server.clientSessions.splice(index, 1);
  }
  server.clientSessionLookup.delete(sessionId);
}

function attachSessionHelpers(server) {
  server.sendToClientSession = function sendToClientSession(sessionId, payload) {
    const session = server.clientSessionLookup.get(sessionId);
    if (!session) return false;
    return sendJson(session.ws, payload);
  };

  server.broadcastToClientSessions = function broadcastToClientSessions(payload) {
    let sent = 0;
    for (const session of server.clientSessions) {
      if (sendJson(session.ws, payload)) sent += 1;
    }
    return sent;
  };
}

function startWebSocketServer(server, options = {}) {
  ensureClientSessionState(server);
  attachSessionHelpers(server);

  const port = Number(options.port || server.config?.websocketPort || DEFAULT_WS_PORT);
  const wss = new WebSocketServer({ port });
  server.websocketServer = wss;

  wss.on("connection", (ws, req) => {
    const sessionId = createSessionId();
    ws.sessionId = sessionId;

    const session = {
      sessionId,
      ws,
      connectedAt: new Date(),
      remoteAddress: req.socket?.remoteAddress,
      userAgent: req.headers?.["user-agent"],
    };

    server.clientSessions.push(session);
    server.clientSessionLookup.set(sessionId, session);

    if (server.logger) {
      server.logger.info(`[websocket] Client connected: ${sessionId}`);
    }
    writeWsLog(server, "ws-log", {
      event: "connection",
      sessionId,
      remoteAddress: session.remoteAddress,
      userAgent: session.userAgent,
      clientSessionsCount: server.clientSessions.length,
    });

    sendJson(ws, {
      type: "session",
      sessionId,
      message: "WebSocket session established",
    });

    ws.on("message", (message) => {
      writeWsLog(server, "ws-log", {
        event: "message",
        sessionId,
        message: message.toString(),
      });

      sendJson(ws, {
        type: "server-info",
        sessionId,
        data: safeServerInfo(server),
      });
    });

    ws.on("error", (error) => {
      if (server.logger) {
        server.logger.error(`[websocket] Client ${sessionId} error: ${error.message}`);
      }
      writeWsLog(server, "ws-error", {
        event: "client-error",
        sessionId,
        error: error.message,
        stack: error.stack,
      });
    });

    ws.on("close", (code, reason) => {
      removeClientSession(server, sessionId);
      if (server.logger) {
        server.logger.info(`[websocket] Client disconnected: ${sessionId}`);
      }
      writeWsLog(server, "ws-log", {
        event: "close",
        sessionId,
        code,
        reason: reason ? reason.toString() : "",
        clientSessionsCount: server.clientSessions.length,
      });
    });
  });

  wss.on("listening", () => {
    if (server.logger) {
      server.logger.info(`[websocket] WebSocket server listening on port ${port}`);
    }
    writeWsLog(server, "ws-log", {
      event: "listening",
      port,
    });
  });

  wss.on("error", (error) => {
    if (server.logger) {
      server.logger.error(`[websocket] Server error: ${error.message}`);
    }
    writeWsLog(server, "ws-error", {
      event: "server-error",
      error: error.message,
      stack: error.stack,
      port,
    });
  });

  return wss;
}

module.exports = {
  startWebSocketServer,
  safeServerInfo,
};
