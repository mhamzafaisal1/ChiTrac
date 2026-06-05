class Observable {
    constructor() {
        this.subscribers = new Set();
    }

    subscribe(callback) {
        if (typeof callback !== 'function') {
            throw new TypeError('Observable subscriber must be a function');
        }

        this.subscribers.add(callback);

        return {
            unsubscribe: () => {
                this.subscribers.delete(callback);
            }
        };
    }

    next(event) {
        this.subscribers.forEach((callback) => {
            callback(event);
        });
    }
}

function isObservableObject(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }

    if (Array.isArray(value)) {
        return true;
    }

    return Object.getPrototypeOf(value) === Object.prototype;
}

function createObservableServer(initialServer = {}) {
    const observable = new Observable();
    const proxyCache = new WeakMap();
    const proxyTargets = new WeakSet();

    function emitChange(type, path, value, previousValue) {
        observable.next({
            type,
            path,
            value,
            previousValue,
            timestamp: new Date().toISOString()
        });
    }

    function proxify(target, path = []) {
        if (!isObservableObject(target)) {
            return target;
        }

        if (proxyTargets.has(target)) {
            return target;
        }

        if (proxyCache.has(target)) {
            return proxyCache.get(target);
        }

        const proxy = new Proxy(target, {
            get(currentTarget, property, receiver) {
                const value = Reflect.get(currentTarget, property, receiver);

                if (typeof property === 'symbol') {
                    return value;
                }

                if (!isObservableObject(value)) {
                    return value;
                }

                return proxify(value, path.concat(property));
            },

            set(currentTarget, property, value, receiver) {
                const previousValue = Reflect.get(currentTarget, property, receiver);
                const nextValue = isObservableObject(value)
                    ? proxify(value, path.concat(property))
                    : value;

                const didSet = Reflect.set(currentTarget, property, nextValue, receiver);

                if (didSet && previousValue !== nextValue) {
                    emitChange('set', path.concat(property).join('.'), nextValue, previousValue);
                }

                return didSet;
            },

            deleteProperty(currentTarget, property) {
                if (!Reflect.has(currentTarget, property)) {
                    return true;
                }

                const previousValue = Reflect.get(currentTarget, property);
                const didDelete = Reflect.deleteProperty(currentTarget, property);

                if (didDelete) {
                    emitChange('delete', path.concat(property).join('.'), undefined, previousValue);
                }

                return didDelete;
            }
        });

        proxyTargets.add(proxy);
        proxyCache.set(target, proxy);
        return proxy;
    }

    const server = proxify(initialServer);

    Object.defineProperty(server, 'observable', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: observable
    });

    Object.defineProperty(server, 'subscribe', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: observable.subscribe.bind(observable)
    });

    return server;
}

module.exports = {
    Observable,
    createObservableServer
};
