/** Declare server-level variables */
var state, server = {};

/** Declare reqlib */
server.appRoot = require('app-root-path');

/** Load config */
const config = require('./modules/config');

const db = require('./modules/mongoConnector')(config);

if (!config.mongoLog?.connectionString || typeof config.mongoLog.connectionString !== 'string' || !config.mongoLog.connectionString.trim()) {
	throw new Error('MONGO_LOG_CONN_STRING is required');
}

/** Load Morgan for http logging */
const morgan = require('morgan');

/** Load MongoDB for logger connection */
const { MongoClient } = require('mongodb');
const https = require('https');
const certificates = require('./modules/certificates');

/** Declare the custom winston logger and create a blank instance */
const winston = require('./modules/logger');

const logClient = new MongoClient(config.mongoLog.connectionString.trim());
const logDb = logClient.db();
const logger = new winston(logDb);

server.config = config;
server.db = db;
server.logDb = logDb;
server.logger = logger;
/** Holds scheduled job handles (e.g. alpha testing job scheduler). */
server.scheduledJobs = {};

server.defaults = {
    machine: require('./defaults/machine').machine,
    item: require('./defaults/item').item,
    operator: require('./defaults/operator').operator,
    status: require('./defaults/status').status,
    fault: require('./defaults/fault').fault
}

const xmlParser = require('./modules/xmlParser');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');

server.xmlParser = xmlParser;

/** Load ChiTrac modules */
const collectionManager = require('./modules/collection-manager');
const cm = new collectionManager(db, logger);

/** Load Express and prep it for use */
const express = require('express');
const session = require('express-session');
const path = require('path');
const app = express();
const port = config.port; // ✅ Using .env PORT

// Passport
const passport = require('passport');

// Pass passport for configuration
require('./configuration/passport')(passport, server);
server['passport'] = passport;

app.use(cookieParser());
const jsonParserDefault = bodyParser.json();
const jsonParserLarge = bodyParser.json({ limit: '25mb' });
app.use((req, res, next) => {
	if (
		req.path === '/api/reports/analytics/machine-report-email' &&
		req.method === 'POST'
	) {
		return jsonParserLarge(req, res, next);
	}
	jsonParserDefault(req, res, next);
});
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    secret: config.jwtSecret, // ✅ Using .env secret
    resave: true,
    saveUninitialized: true
}));

app.use(passport.initialize());
app.use(passport.session());

const flash = require('connect-flash');
app.use(flash());

const allowCrossDomain = function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
};

app.use(allowCrossDomain);

const morganMiddleware = morgan(':method :url :status :res[content-length] - :response-time ms', {
    stream: {
        write: (message) => logger.http(message.trim())
    }
});

app.use(morganMiddleware);

/**** Initial Collection Setup */
async function initializeCollections() {
    logger.debug('Initializing machine collection...');
    await cm.createCollection('machine').then(() => {
        const collection = db.collection('machine');
        collection.insertMany(server.defaults.machine);
        logger.debug('Machine collection initialized!');
    }).catch(async (error) => {
        if (error.codeName === 'NamespaceExists') {
            logger.debug('Machine collection already initialized!');
        } else {
            logger.error(error.toString());
        }
    });

    logger.debug('Initializing item collection...');
    await cm.createCollection('item').then(() => {
        const collection = db.collection('item');
        collection.insertMany(server.defaults.item);
        logger.debug('Item collection initialized!');
    }).catch((error) => {
        if (error.codeName === 'NamespaceExists') {
            logger.debug('Item collection already initialized!');
        } else {
            logger.error(error.toString());
        }
    });

    logger.debug('Initializing fault collection...');
    await cm.createCollection('fault').then(() => {
        const collection = db.collection('fault');
        collection.insertMany(server.defaults.fault);
        logger.debug('Fault collection initialized!');
    }).catch((error) => {
        if (error.codeName === 'NamespaceExists') {
            logger.debug('Fault collection already initialized!');
        } else {
            logger.error(error.toString());
        }
    });

    logger.debug('Initializing status collection...');
    await cm.createCollection('status').then(() => {
        const collection = db.collection('status');
        collection.insertMany(server.defaults.status);
        logger.debug('Status collection initialized!');
    }).catch((error) => {
        if (error.codeName === 'NamespaceExists') {
            logger.debug('Status collection already initialized!');
        } else {
            logger.error(error.toString());
        }
    });

    logger.debug('Initializing operator collection...');
    await cm.createCollection('operator').then(() => {
        const collection = db.collection('operator');
        collection.insertMany(server.defaults.operator);
        logger.debug('Operators collection initialized!');
    }).catch(async (error) => {
        if (error.codeName === 'NamespaceExists') {
            const cursor = db.collection('operator').find({});
            const found = await cursor.toArray();
            if (found.length) {
                logger.debug('Operator collection already initialized!');
            } else {
                logger.debug('Operator collection exists but is empty!');
                db.collection('operator').insertMany(server.defaults.operator);
                logger.debug('Operator collection populated!');
            }
        } else {
            logger.error(error.toString());
        }
    });

    logger.debug('Initializing system-preferences collection...');
    const systemPreferences = require('./modules/systemPreferences');
    await cm.createCollection(config.systemPreferencesCollectionName).then(async () => {
        await systemPreferences.ensureSystemPreferences(db, config);
        logger.debug('System preferences collection initialized!');
    }).catch(async (error) => {
        if (error.codeName === 'NamespaceExists') {
            await systemPreferences.ensureSystemPreferences(db, config);
            logger.debug('System preferences collection already initialized!');
        } else {
            logger.error(error.toString());
        }
    });
}

async function startServer() {
    try {
        const systemPreferences = require('./modules/systemPreferences');
        const preferences = await systemPreferences.loadAndApplySystemPreferences(server);
        logger.info('System preferences loaded', {
            systemName: server.config.systemName,
            defaultTheme: server.config.defaultTheme,
            logLevel: server.config.logLevel,
            httpsEnabled: server.config.httpsEnabled,
            httpsEnabledSource: server.config.httpsEnabledSource,
            userPermissionsLevels: server.config.userPermissionsLevels
        });

        const routes = require('./routes');
        routes.init(app, server);

        await initializeCollections();
        const { ensureAnalyticsIndexes } = require('./modules/analyticsIndexes');
        await ensureAnalyticsIndexes(db, config, logger);

        const { startWebsocketServer } = require('./modules/websocketServer');
        server.websocketServer = startWebsocketServer(server);

        app.listen(port, () => {
            logger.info(`ChiTracAPI Started and listening on port ${port}`);
        });

        if (server.config.httpsEnabled === true) {
            if (!certificates.certificateFilesExist(server.config)) {
                const { keyPath, certPath } = certificates.getCertificatePaths(server.config);
                logger.error(`HTTPS is enabled but certificate files were not found. Expected key: ${keyPath}, cert: ${certPath}`);
            } else {
                const credentials = certificates.loadHttpsCredentials(server.config);
                https.createServer(credentials, app).listen(server.config.httpsPort, () => {
                    logger.info(`ChiTracAPI HTTPS Started and listening on port ${server.config.httpsPort}`);
                });
            }
        }
    } catch (e) {
        logger.error(`Server startup failed: ${e.message}`);
        throw e;
    }
}

startServer();
