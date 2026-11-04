const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const http = require('node:http');
const WebSocket = require('ws');
const { startWebsocketServer } = require('../modules/websocketServer');

test('public status connections exclude initial data, broadcasts and private request responses', async t => {
    let configurationReads = 0;
    const server = {
        config: {}, cache: {},
        logger: { info() {}, error() {} },
        logDb: { collection: () => ({ insertOne: async () => {} }) },
        configurationSync: {
            snapshot: () => ({ type: 'configuration-cache', collections: { 'config-machine': [{ name: 'Private' }] } }),
            refresh: async () => { configurationReads++; return { type: 'configuration-cache' }; }
        }
    };
    const listener = http.createServer();
    const wss = startWebsocketServer(server, { httpServer: listener, path: '/ws' });
    const clients = [];
    t.after(async () => {
        clients.forEach(client => client.terminate());
        await new Promise(resolve => wss.close(resolve));
        await new Promise(resolve => listener.close(resolve));
    });
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const url = `ws://127.0.0.1:${listener.address().port}/ws`;
    const events = new EventEmitter(), received = [];
    const publicSocket = new WebSocket(`${url}?channel=connection-status`);
    clients.push(publicSocket);
    publicSocket.on('message', data => {
        const message = JSON.parse(String(data));
        received.push(message); events.emit(message.type, message);
    });
    await once(events, 'connection-status', { signal: AbortSignal.timeout(3000) });
    assert.equal(server.clientSessions.length, 0);

    // Normal signed-in feeds retain their existing initialization and delivery.
    const privateEvents = new EventEmitter();
    const privateSocket = new WebSocket(url);
    clients.push(privateSocket);
    privateSocket.on('message', data => privateEvents.emit(JSON.parse(String(data)).type));
    await once(privateEvents, 'configuration-cache', { signal: AbortSignal.timeout(3000) });
    assert.equal(server.clientSessions.length, 1);
    const delivery = once(privateEvents, 'configuration-cache-update', { signal: AbortSignal.timeout(3000) });
    server.broadcastWebsocket({ type: 'configuration-cache-update', collections: { private: true } });
    await delivery;

    for (const type of ['configuration-cache-request', 'server-info-request']) {
        const response = once(events, 'connection-status', { signal: AbortSignal.timeout(3000) });
        publicSocket.send(JSON.stringify({ type }));
        await response;
    }
    assert.equal(configurationReads, 0);
    assert.equal(received.length, 3);
    for (const message of received) {
        assert.equal(message.type, 'connection-status');
        assert.deepEqual(Object.keys(message).sort(), ['timestamp', 'type']);
    }
});
