/** Declare server-level variables */
var state, server = {};

/** Declare reqlib */
server.appRoot = require('app-root-path');

/** Load config */
const config = require('./modules/config');
const db = require('./modules/mongoConnector')(config);

/** Load Morgan for http logging */
const morgan = require('morgan');

/** Load MongoDB for logger connection */
const { MongoClient } = require('mongodb');

/** Declare the custom winston logger and create a blank instance */
const winston = require('./modules/logger');

// Build authenticated connection string for logger
let loggerConnectionString;
if (config.mongoLog.url.startsWith('mongodb://')) {
	const urlWithoutScheme = config.mongoLog.url.substring(10);
	const slashIndex = urlWithoutScheme.indexOf('/');
	
	if (slashIndex === -1) {
		loggerConnectionString = `mongodb://${config.mongoLog.username}:${config.mongoLog.password}@${urlWithoutScheme}/${config.mongoLog.db}`;
	} else {
		loggerConnectionString = `mongodb://${config.mongoLog.username}:${config.mongoLog.password}@${urlWithoutScheme}`;
	}
} else {
	loggerConnectionString = config.mongoLog.url.replace('mongodb://', `mongodb://${config.mongoLog.username}:${config.mongoLog.password}@`);
}

const dbClient = new MongoClient(loggerConnectionString);
const logDb = dbClient.db(config.mongoLog.db);
const logger = new winston(logDb);

server.config = config;
server.db = db;
server.logger = logger;

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
app.use(bodyParser.json());
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

const routes = require('./routes');
routes.init(app, server);

app.listen(port, () => logger.info(`ChiTracAPI Started and listening on port ${port}`));

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
}

initializeCollections();
