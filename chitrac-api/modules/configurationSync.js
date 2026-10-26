const { randomUUID, createHash } = require('crypto');
const { addDerivedShiftTimeComponents, getTimeComponentsFromTimestamp } = require('../utils/shiftTimeComponents');

const CONFIG_KEYS = ['machine', 'operator', 'item', 'fault', 'status', 'shift', 'maintenanceShift'];
const DEFAULT_NAMES = { maintenanceShift: 'config-shift-maintenance' };

function publicConfigName(name, config) {
    return typeof name === 'string' && name.startsWith('config-') &&
        name !== 'config-user' && name !== config.userCollectionName;
}

function normalizeShift(shift) {
    const derived = addDerivedShiftTimeComponents(shift);
    const time = value => ({
        hour: Math.min(23, Math.max(0, Number(value?.hour) || 0)),
        minute: Math.min(59, Math.max(0, Number(value?.minute) || 0))
    });
    return {
        ...shift,
        _id: String(shift._id?.$oid ?? shift._id ?? ''),
        startTime: time(derived.startTime), endTime: time(derived.endTime),
        activeDays: (Array.isArray(shift.activeDays) ? shift.activeDays : []).map(Number).filter(day => day >= 1 && day <= 7),
        ...(Array.isArray(shift.breaks) ? { breaks: shift.breaks.map(brk => ({
            ...brk,
            startTime: time(brk.startTime || getTimeComponentsFromTimestamp(brk.timestamps?.start)),
            endTime: time(brk.endTime || getTimeComponentsFromTimestamp(brk.timestamps?.end))
        })) } : {})
    };
}

function serializeDocuments(name, documents, names) {
    const rows = documents.map(document => {
        if (name === names.shift || name === names.maintenanceShift) return normalizeShift(document);
        if (name === names.operator) {
            const { code, ...operator } = document;
            const id = operator.id === undefined ? code : operator.id;
            return { ...operator, ...(id !== undefined ? { id: /^-?\d+$/.test(String(id).trim()) ? Number(id) : id } : {}) };
        }
        return document;
    });
    // Match REST's BSON/Date JSON representation and make change detection independent of query order.
    return JSON.parse(JSON.stringify(rows)).sort((a, b) => String(a._id).localeCompare(String(b._id)));
}

function createConfigurationSync(server, { intervalMs = 10000 } = {}) {
    const config = server.config || {};
    const names = Object.fromEntries(CONFIG_KEYS.map(key => [key,
        config[`${key}CollectionName`] || DEFAULT_NAMES[key] || `config-${key}`
    ]).filter(([, name]) => publicConfigName(name, config)));
    const epoch = randomUUID();
    let revision = 0;
    let collections = null;
    let fingerprints = {};
    let queue = Promise.resolve();
    let timer;
    let stopped = true;

    function snapshot() {
        return collections && { type: 'configuration-cache', epoch, revision, names, collections };
    }

    async function rebuild() {
        const discovered = await server.db.listCollections({}, { nameOnly: true }).toArray();
        const selected = [...new Set([...Object.values(names), ...discovered.map(row => row.name)])]
            .filter(name => publicConfigName(name, config)).sort();
        const next = Object.fromEntries(await Promise.all(selected.map(async name => [name,
            serializeDocuments(name, await server.db.collection(name).find({}).toArray(), names)
        ])));
        const hashes = Object.fromEntries(selected.map(name => [name,
            createHash('sha256').update(JSON.stringify(next[name])).digest('hex')
        ]));
        const changed = Object.fromEntries(selected.filter(name => fingerprints[name] !== hashes[name])
            .map(name => [name, next[name]]));
        // A dropped collection must clear clients' old values as well.
        for (const name of Object.keys(collections || {})) if (!(name in next)) changed[name] = [];
        const initial = collections === null;
        collections = next;
        fingerprints = hashes;
        if (initial || Object.keys(changed).length) {
            revision++;
            server.broadcastWebsocket?.(initial ? snapshot() : {
                type: 'configuration-cache-update', epoch, revision, names, collections: changed
            });
        }
        return snapshot();
    }

    function refresh() {
        // Serialize refreshes: an older query must never overwrite a newer save.
        const next = queue.then(rebuild);
        queue = next.catch(() => {});
        return next;
    }

    function schedule() {
        if (stopped) return;
        timer = setTimeout(async () => {
            try { await refresh(); }
            catch (error) { server.logger?.error?.(`[configurationSync] Refresh failed: ${error.message}`); }
            finally { schedule(); }
        }, intervalMs);
        timer.unref?.();
    }

    return {
        snapshot, refresh,
        async start() {
            if (!stopped) return;
            stopped = false;
            try { await refresh(); }
            catch (error) { server.logger?.error?.(`[configurationSync] Initial load failed: ${error.message}`); }
            schedule();
        },
        stop() { stopped = true; clearTimeout(timer); }
    };
}

function configurationSyncMiddleware(server) {
    return (req, res, next) => {
        const path = (req.originalUrl || req.url).split('?')[0];
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ||
            !/^\/api\/(?:(?:machine|item|operator|status|faults?)\/config(?:\/[^/]+)?|alpha\/(?:shifts|maintenance-shifts)(?:\/[^/]+)?)\/?$/.test(path)) return next();
        const end = res.end;
        res.end = function(...args) {
            res.end = end;
            if (res.statusCode >= 200 && res.statusCode < 300 && server.configurationSync) {
                // Publish committed changes before acknowledging the save, so subsequent cached reads are current.
                server.configurationSync.refresh()
                    .catch(error => server.logger?.error?.(`[configurationSync] Post-save refresh failed: ${error.message}`))
                    .then(() => end.apply(res, args));
                return res;
            }
            return end.apply(res, args);
        };
        next();
    };
}

module.exports = { createConfigurationSync, configurationSyncMiddleware, serializeDocuments };
