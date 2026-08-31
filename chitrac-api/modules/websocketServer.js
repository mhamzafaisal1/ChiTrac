const WebSocket = require('ws');
const crypto = require('crypto');

const WS_PORT = 50001;
const LOG_COLLECTION = 'ws-log';
const ERROR_COLLECTION = 'ws-error';

function redactConfigValue(key, value) {
    if (typeof key !== 'string') {
        return value;
    }

    const normalizedKey = key.toLowerCase();
    const shouldRedact = [
        'connectionstring',
        'jwtsecret',
        'secret',
        'password',
        'token'
    ].some((sensitiveKey) => normalizedKey.includes(sensitiveKey));

    if (!shouldRedact) {
        return value;
    }

    if (typeof value === 'string' && value.length) {
        return '[REDACTED]';
    }

    if (value && typeof value === 'object') {
        return '[REDACTED]';
    }

    return value;
}

function redactObject(input) {
    if (Array.isArray(input)) {
        return input.map(redactObject);
    }

    if (!input || typeof input !== 'object') {
        return input;
    }

    return Object.entries(input).reduce((redacted, [key, value]) => {
        redacted[key] = redactObject(redactConfigValue(key, value));
        return redacted;
    }, {});
}

function getCollectionNames(config) {
    return Object.entries(config)
        .filter(([key, value]) => key.endsWith('CollectionName') && typeof value === 'string')
        .reduce((collections, [key, value]) => {
            collections[key] = value;
            return collections;
        }, {});
}

function buildServerSnapshot(server) {
    const config = server.config || {};
    const clientSessions = Array.isArray(server.clientSessions)
        ? server.clientSessions
        : [];

    return {
        type: 'server-info',
        timestamp: new Date().toISOString(),
        server: {
            config: redactObject(config),
            defaults: server.defaults || {},
            systemName: config.systemName,
            nodeEnv: config.nodeEnv,
            ports: {
                api: config.port,
                https: config.httpsPort,
                websocket: WS_PORT
            },
            features: {
                softrol: config.softrol,
                milnor: config.milnor,
                httpsEnabled: config.httpsEnabled,
                enableApiTokenCheck: config.enableApiTokenCheck,
                showErrorModals: config.showErrorModals
            },
            collections: getCollectionNames(config),
            scheduledJobs: Object.keys(server.scheduledJobs || {}),
            websocket: {
                clientSessionCount: clientSessions.length,
                clientSessions: clientSessions.map(toPublicClientSession)
            }
        }
    };
}

function activeShiftIndicatorFromCache(currentShiftCache) {
    const meta = currentShiftCache?.meta || {};
    const isCurrent = meta.mode === 'current' && meta.shiftId;

    if (!isCurrent) {
        return {
            shiftId: null,
            shift: null,
            mode: 'none',
            start: null,
            end: null
        };
    }

    return {
        shiftId: String(meta.shiftId),
        shift: meta.shift || null,
        mode: 'current',
        start: meta.start || null,
        end: meta.end || null
    };
}

function buildDashboardCacheSnapshot(server) {
    const cache = server.cache || {};

    return {
        type: 'dashboard-cache-update',
        timestamp: new Date().toISOString(),
        scope: 'all',
        cache: {
            today: cache.today || {},
            currentShift: cache.currentShift || {},
            activeShift: activeShiftIndicatorFromCache(cache.currentShift),
            lastSevenDays: cache.lastSevenDays || {},
            countSparkline: cache.countSparkline || {},
            dashboard: cache.dashboard || {}
        }
    };
}

function shouldBroadcastServerChange(event) {
    const path = Array.isArray(event?.path) ? event.path.join('.') : String(event?.path || '');
    return !path.startsWith('cache.');
}

function getSocketInfo(req) {
    return {
        remoteAddress: req.socket?.remoteAddress,
        remotePort: req.socket?.remotePort,
        userAgent: req.headers?.['user-agent']
    };
}

function normalizeMessage(message) {
    if (Array.isArray(message)) {
        return Buffer.concat(message);
    }

    if (Buffer.isBuffer(message)) {
        return message;
    }

    if (message instanceof ArrayBuffer) {
        return Buffer.from(message);
    }

    return Buffer.from(String(message), 'utf8');
}

function previewMessage(message) {
    const value = normalizeMessage(message).toString('utf8');
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}

function createSessionId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return crypto.randomBytes(16).toString('hex');
}

function toPublicClientSession(session) {
    return {
        id: session.id,
        connectedAt: session.connectedAt,
        lastMessageAt: session.lastMessageAt,
        messageCount: session.messageCount || 0,
        socketInfo: session.socketInfo
    };
}

function getOpenSessionById(server, sessionId) {
    if (!Array.isArray(server.clientSessions)) {
        return null;
    }

    return server.clientSessions.find((session) => (
        session.id === sessionId &&
        session.ws &&
        session.ws.readyState === WebSocket.OPEN
    )) || null;
}

function createLogHelpers(server) {
    const logDb = server.logDb;
    const logger = server.logger;

    async function writeLog(event, details = {}) {
        const doc = {
            timestamp: new Date(),
            event,
            ...details
        };

        try {
            await logDb.collection(LOG_COLLECTION).insertOne(doc);
        } catch (error) {
            logger?.error(`WebSocket log write failed: ${error.message}`);
        }
    }

    async function writeError(event, error, details = {}) {
        const doc = {
            timestamp: new Date(),
            event,
            message: error?.message || String(error),
            stack: error?.stack,
            ...details
        };

        try {
            await logDb.collection(ERROR_COLLECTION).insertOne(doc);
        } catch (logError) {
            logger?.error(`WebSocket error log write failed: ${logError.message}`);
        }

        logger?.error(`WebSocket ${event}: ${doc.message}`);
    }

    return { writeLog, writeError };
}

function sendJson(ws, payload) {
    ws.send(JSON.stringify(payload));
}

function broadcastJson(wss, payload) {
    const message = JSON.stringify(payload);

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function sendJsonToClientSession(server, sessionId, payload) {
    const session = getOpenSessionById(server, sessionId);
    if (!session) {
        return false;
    }

    sendJson(session.ws, payload);
    return true;
}

function removeClientSession(server, sessionId) {
    if (!Array.isArray(server.clientSessions)) {
        return null;
    }

    const index = server.clientSessions.findIndex((session) => session.id === sessionId);
    if (index === -1) {
        return null;
    }

    const [removed] = server.clientSessions.splice(index, 1);
    return removed || null;
}

function getWebsocketServers(server) {
    return Array.isArray(server.websocketServers)
        ? server.websocketServers
        : [];
}

function broadcastJsonToServers(websocketServers, payload) {
    websocketServers.forEach((wss) => broadcastJson(wss, payload));
}

function attachServerClientSessionHelpers(server, wss) {
    if (!Array.isArray(server.clientSessions)) {
        server.clientSessions = [];
    }

    if (!Array.isArray(server.websocketServers)) {
        server.websocketServers = [];
    }

    if (!server.websocketServers.includes(wss)) {
        server.websocketServers.push(wss);
    }

    if (typeof server.getClientSession !== 'function') {
        Object.defineProperty(server, 'getClientSession', {
            enumerable: false,
            configurable: true,
            value: (sessionId) => getOpenSessionById(server, sessionId)
        });
    }

    if (typeof server.sendToClientSession !== 'function') {
        Object.defineProperty(server, 'sendToClientSession', {
            enumerable: false,
            configurable: true,
            value: (sessionId, payload) => sendJsonToClientSession(server, sessionId, payload)
        });
    }

    if (typeof server.broadcastWebsocket !== 'function') {
        Object.defineProperty(server, 'broadcastWebsocket', {
            enumerable: false,
            configurable: true,
            value: (payload) => broadcastJsonToServers(getWebsocketServers(server), payload)
        });
    }
}

function startWebsocketServer(server, options = {}) {
    const { writeLog, writeError } = createLogHelpers(server);
    const httpServer = options.httpServer;
    const websocketPath = options.path || '/ws';
    const wss = httpServer
        ? new WebSocket.Server({ server: httpServer, path: websocketPath })
        : new WebSocket.Server({ port: WS_PORT });
    attachServerClientSessionHelpers(server, wss);

    const subscription = typeof server.subscribe === 'function'
        ? server.subscribe((event) => {
            if (!shouldBroadcastServerChange(event)) {
                return;
            }

            const payload = {
                type: 'server-change',
                timestamp: new Date().toISOString(),
                change: {
                    type: event.type,
                    path: event.path,
                    timestamp: event.timestamp
                },
                snapshot: buildServerSnapshot(server)
            };

            try {
                broadcastJson(wss, payload);
                writeLog('server-change', payload.change);
            } catch (error) {
                writeError('server-change-broadcast-failed', error, payload.change);
            }
        })
        : null;

    wss.on('listening', () => {
        const listenDetails = httpServer
            ? { path: websocketPath, mode: 'http-server' }
            : { port: WS_PORT, mode: 'dedicated-port' };
        const location = httpServer ? `path ${websocketPath}` : `port ${WS_PORT}`;
        server.logger?.info(`ChiTrac WebSocket server started and listening on ${location}`);
        writeLog('listening', listenDetails);
    });

    wss.on('connection', (ws, req) => {
        const sessionId = createSessionId();
        const socketInfo = getSocketInfo(req);
        const session = {
            id: sessionId,
            ws,
            connectedAt: new Date().toISOString(),
            lastMessageAt: null,
            messageCount: 0,
            socketInfo
        };

        ws.id = sessionId;
        server.clientSessions.push(session);

        writeLog('connection', {
            ...socketInfo,
            sessionId,
            activeClientSessions: server.clientSessions.length
        });

        sendJson(ws, {
            type: 'websocket-session',
            timestamp: new Date().toISOString(),
            session: toPublicClientSession(session)
        });
        sendJson(ws, buildDashboardCacheSnapshot(server));

        ws.on('message', async (message) => {
            session.lastMessageAt = new Date().toISOString();
            session.messageCount += 1;

            await writeLog('message', {
                ...socketInfo,
                sessionId,
                bytes: normalizeMessage(message).byteLength,
                payloadPreview: previewMessage(message)
            });

            try {
                sendJson(ws, buildServerSnapshot(server));
                sendJson(ws, buildDashboardCacheSnapshot(server));
                await writeLog('server-info-sent', socketInfo);
            } catch (error) {
                await writeError('message-response-failed', error, socketInfo);
            }
        });

        ws.on('close', (code, reason) => {
            removeClientSession(server, sessionId);
            writeLog('close', {
                ...socketInfo,
                sessionId,
                code,
                reason: reason?.toString(),
                activeClientSessions: server.clientSessions.length
            });
        });

        ws.on('error', (error) => {
            writeError('client-error', error, {
                ...socketInfo,
                sessionId
            });
        });
    });

    wss.on('error', (error) => {
        writeError('server-error', error, { port: WS_PORT });
    });

    wss.on('close', () => {
        subscription?.unsubscribe();
        if (Array.isArray(server.websocketServers)) {
            server.websocketServers = server.websocketServers.filter((item) => item !== wss);
        }
        writeLog('server-closed', { port: WS_PORT });
    });

    return wss;
}

module.exports = {
    startWebsocketServer,
    buildServerSnapshot,
    buildDashboardCacheSnapshot
};
