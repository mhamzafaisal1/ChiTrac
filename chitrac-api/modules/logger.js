module.exports = function(db) {
    return constructor(db);
}

function constructor(db) {
    const winston = require('winston');
    require('winston-mongodb');
    require('winston-daily-rotate-file');
    const path = require('path');

    const logsDir = path.join(__dirname, '..', 'logs');

    /*let exceptionFileTransport = new winston.transports.DailyRotateFile({
        filename: path.join('logs', '/%DATE%_exception.log'),
        level: 'error',
        zippedArchive: true,
        maxFiles: '365d'
    });*/
    let errorFileTransport = new winston.transports.DailyRotateFile({
        dirname: logsDir,
        filename: '%DATE%_error.log',
        level: 'error',
        zippedArchive: true,
        maxFiles: '365d'
    });
    let httpFileTransport = new winston.transports.DailyRotateFile({
        dirname: logsDir,
        filename: '%DATE%_http.log',
        level: 'http',
        zippedArchive: true,
        maxFiles: '60d'
    });

    const logger = winston.createLogger({
        levels: winston.config.npm.levels,
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
        transports: [errorFileTransport, httpFileTransport],
        exceptionHandlers: [errorFileTransport]
    });



    if (process.env.NODE_ENV !== 'production') {
        if (process.env.NODE_ENV === 'development') {
            logger.add(new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize({ all: true }),
                    winston.format.align(),
                    winston.format.json(),
                    winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
                ),
                level: 'silly'
            }));
        }
        logger.add(new winston.transports.DailyRotateFile({
            dirname: logsDir,
            filename: '%DATE%_everything.log',
            level: 'silly',
            zippedArchive: true,
            maxFiles: '3d'
        }));
    }
    
    if (db) {
        logger.add(new winston.transports.MongoDB({
            level: 'error',
            db: db,
            collection: 'api-error',
            options: { useUnifiedTopology: true },
            storeHost: true
        }));
        logger.add(new winston.transports.MongoDB({
            level: 'http',
            db: db,
            collection: 'api-http',
            options: { useUnifiedTopology: true },
            storeHost: true
        }));
    }
    return logger;
}