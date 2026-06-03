const WebSocket = require('ws');

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
            scheduledJobs: Object.keys(server.scheduledJobs || {})
        }
    };
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

function startWebsocketServer(server) {
    const { writeLog, writeError } = createLogHelpers(server);
    const wss = new WebSocket.Server({ port: WS_PORT });
    const subscription = typeof server.subscribe === 'function'
        ? server.subscribe((event) => {
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
        server.logger?.info(`ChiTrac WebSocket server started and listening on port ${WS_PORT}`);
        writeLog('listening', { port: WS_PORT });
    });

    wss.on('connection', (ws, req) => {
        const socketInfo = getSocketInfo(req);
        writeLog('connection', socketInfo);

        ws.on('message', async (message) => {
            await writeLog('message', {
                ...socketInfo,
                bytes: normalizeMessage(message).byteLength,
                payloadPreview: previewMessage(message)
            });

            try {
                sendJson(ws, buildServerSnapshot(server));
                await writeLog('server-info-sent', socketInfo);
            } catch (error) {
                await writeError('message-response-failed', error, socketInfo);
            }
        });

        ws.on('close', (code, reason) => {
            writeLog('close', {
                ...socketInfo,
                code,
                reason: reason?.toString()
            });
        });

        ws.on('error', (error) => {
            writeError('client-error', error, socketInfo);
        });
    });

    wss.on('error', (error) => {
        writeError('server-error', error, { port: WS_PORT });
    });

    wss.on('close', () => {
        subscription?.unsubscribe();
        writeLog('server-closed', { port: WS_PORT });
    });

    return wss;
}

module.exports = {
    startWebsocketServer,
    buildServerSnapshot
};
