const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const http = require('node:http');
const express = require('express');
const WebSocket = require('ws');
const { createConfigurationSync, configurationSyncMiddleware } = require('../modules/configurationSync');
const { startWebsocketServer } = require('../modules/websocketServer');

function setup() {
    const documents = {
        'config-machine': [{ _id: 'm1', id: 1, name: 'LPL1', active: true }],
        'config-operator': [{ _id: 'o1', code: '123', name: { first: 'Test', surname: 'Operator' } }],
        'config-shift': [{ _id: 's1', active: true, activeDays: ['1', '5'], timestamps: {
            start: '2026-10-23T11:00:00Z', end: '2026-10-23T19:00:00Z'
        }, breaks: [{ timestamps: { start: '2026-10-23T15:00:00Z', end: '2026-10-23T15:15:00Z' } }] }],
        'config-extra': [{ _id: 'x1', setting: 2 }],
        'config-user': [{ password: 'must-never-be-sent' }],
        'private-users': [{ password: 'must-never-be-read' }]
    };
    let fail = false;
    const reads = [];
    const broadcasts = [];
    const server = {
        config: { userCollectionName: 'private-users' },
        db: {
            listCollections: () => ({ toArray: async () => Object.keys(documents).map(name => ({ name })) }),
            collection: name => {
                reads.push(name);
                return { find: () => ({ toArray: async () => {
                    if (fail) throw new Error('database unavailable');
                    return structuredClone(documents[name] || []);
                } }) };
            }
        },
        broadcastWebsocket: payload => broadcasts.push(payload)
    };
    server.configurationSync = createConfigurationSync(server);
    return { server, documents, broadcasts, reads, fail: value => fail = value };
}

test('initial sync includes every config collection and excludes users, including a renamed user collection', async () => {
    const { server, reads } = setup();
    const snapshot = await server.configurationSync.refresh();
    assert.deepEqual(Object.keys(snapshot.names).sort(), ['fault', 'item', 'machine', 'maintenanceShift', 'operator', 'shift', 'status']);
    assert.ok(snapshot.collections['config-extra']);
    assert.ok(snapshot.collections['config-shift-maintenance']);
    assert.equal(snapshot.collections['config-user'], undefined);
    assert.equal(snapshot.collections['private-users'], undefined);
    assert.ok(!reads.includes('config-user') && !reads.includes('private-users'));
    assert.equal(snapshot.collections['config-operator'][0].id, 123);
    assert.equal(snapshot.collections['config-operator'][0].code, undefined);
    const shift = snapshot.collections['config-shift'][0];
    assert.deepEqual(shift.startTime, { hour: 6, minute: 0 });
    assert.deepEqual(shift.breaks[0].startTime, { hour: 10, minute: 0 });
    assert.deepEqual(shift.activeDays, [1, 5]);
});

test('only changed collections are broadcast; inserts, edits, deletes and dropped/new collections are reflected', async () => {
    const { server, documents, broadcasts } = setup();
    await server.configurationSync.refresh();
    await server.configurationSync.refresh();
    assert.equal(broadcasts.length, 1);
    documents['config-machine'].push({ _id: 'm2', id: 2 });
    await server.configurationSync.refresh();
    assert.deepEqual(Object.keys(broadcasts.at(-1).collections), ['config-machine']);
    documents['config-machine'][0].name = 'Updated';
    await server.configurationSync.refresh();
    assert.equal(broadcasts.at(-1).collections['config-machine'][0].name, 'Updated');
    documents['config-machine'] = [];
    delete documents['config-extra'];
    documents['config-new'] = [{ _id: 'n1' }];
    await server.configurationSync.refresh();
    assert.deepEqual(broadcasts.at(-1).collections['config-machine'], []);
    assert.deepEqual(broadcasts.at(-1).collections['config-extra'], []);
    assert.ok(broadcasts.at(-1).collections['config-new']);
});

test('a failed refresh retains the last valid snapshot and subsequent refreshes recover', async () => {
    const { server, fail, documents } = setup();
    const original = await server.configurationSync.refresh();
    fail(true);
    await assert.rejects(server.configurationSync.refresh(), /database unavailable/);
    assert.deepEqual(server.configurationSync.snapshot(), original);
    fail(false);
    documents['config-machine'] = [];
    const recovered = await server.configurationSync.refresh();
    assert.equal(recovered.revision, original.revision + 1);
});

test('reconciliation detects edits made outside REST, and stopping cancels further checks', async () => {
    const { server, documents } = setup();
    const events = new EventEmitter();
    server.broadcastWebsocket = payload => events.emit(payload.type, payload);
    server.configurationSync = createConfigurationSync(server, { intervalMs: 20 });
    try {
        await server.configurationSync.start();
        const update = once(events, 'configuration-cache-update', { signal: AbortSignal.timeout(2000) });
        documents['config-machine'][0].name = 'Edited directly';
        const [message] = await update;
        assert.equal(message.collections['config-machine'][0].name, 'Edited directly');
        server.configurationSync.stop();
        const revision = server.configurationSync.snapshot().revision;
        documents['config-machine'] = [];
        await new Promise(done => setTimeout(done, 50));
        assert.equal(server.configurationSync.snapshot().revision, revision);
    } finally { server.configurationSync.stop(); }
});

test('successful configuration saves refresh before the response, while rejected saves and unrelated requests do not', async () => {
    let resolve;
    let refreshes = 0;
    const server = { configurationSync: { refresh: () => { refreshes++; return new Promise(done => resolve = done); } } };
    const middleware = configurationSyncMiddleware(server);
    const sent = [];
    const res = { statusCode: 200, end(body) { sent.push(body); return this; } };
    middleware({ method: 'PUT', originalUrl: '/api/machine/config/m1' }, res, () => {});
    res.end({ saved: true });
    assert.equal(sent.length, 0);
    resolve();
    await new Promise(done => setImmediate(done));
    assert.deepEqual(sent, [{ saved: true }]);
    for (const [method, path, statusCode] of [['PUT', '/api/machine/config/m1', 400], ['GET', '/api/machine/config', 200], ['PUT', '/api/users/u1', 200]]) {
        const response = { statusCode, end() { return this; } };
        middleware({ method, originalUrl: path }, response, () => {});
        response.end({});
    }
    assert.equal(refreshes, 1);
});

test('websocket clients receive initial config, live changes and a complete fresh snapshot on reconnect', async t => {
    const { server, documents } = setup();
    delete server.broadcastWebsocket;
    server.logDb = { collection: () => ({ insertOne: async () => {} }) };
    const app = express();
    app.use(express.json(), configurationSyncMiddleware(server));
    app.put('/api/machine/config/:id', (req, res) => {
        documents['config-machine'][0].name = req.body.name;
        res.json(documents['config-machine'][0]);
    });
    app.delete('/api/alpha/shifts/:id', (req, res) => {
        documents['config-shift'] = [];
        res.status(204).send();
    });
    const listener = http.createServer(app);
    const wss = startWebsocketServer(server, { httpServer: listener });
    await server.configurationSync.refresh();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const url = `http://127.0.0.1:${listener.address().port}`;
    const clients = [];
    t.after(async () => {
        clients.forEach(client => client.terminate());
        await new Promise(done => wss.close(done));
        await new Promise(done => listener.close(done));
    });
    function connect() {
        const socket = new WebSocket(url.replace('http', 'ws') + '/ws');
        clients.push(socket);
        const events = new EventEmitter();
        socket.on('message', data => { const message = JSON.parse(String(data)); events.emit(message.type, message); });
        return { socket, events };
    }
    const first = connect();
    const second = connect();
    const [initial] = await Promise.all([once(first.events, 'configuration-cache'), once(second.events, 'configuration-cache')]);
    const updates = [once(first.events, 'configuration-cache-update'), once(second.events, 'configuration-cache-update')];
    const result = await fetch(url + '/api/machine/config/m1', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'New name' })
    });
    assert.equal(result.status, 200);
    for (const [update] of await Promise.all(updates)) assert.equal(update.collections['config-machine'][0].name, 'New name');
    first.socket.close();
    await once(first.socket, 'close');
    documents['config-machine'].push({ _id: 'm2', id: 2 });
    await server.configurationSync.refresh();
    const reconnected = connect();
    const [snapshot] = await once(reconnected.events, 'configuration-cache');
    assert.equal(snapshot.collections['config-machine'].length, 2);
    assert.ok(snapshot.revision > initial[0].revision);
    const requested = once(reconnected.events, 'configuration-cache');
    reconnected.socket.send(JSON.stringify({ type: 'configuration-cache-request' }));
    assert.equal((await requested)[0].revision, snapshot.revision);
    const deleted = once(reconnected.events, 'configuration-cache-update');
    assert.equal((await fetch(url + '/api/alpha/shifts/s1', { method: 'DELETE' })).status, 204);
    assert.deepEqual((await deleted)[0].collections['config-shift'], []);
});
