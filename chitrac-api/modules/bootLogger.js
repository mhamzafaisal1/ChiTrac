const winston = require("winston");
const path = require("path");
require("winston-daily-rotate-file");

const logsDir = path.join(__dirname, "..", "logs");

const bootFileTransport = new winston.transports.DailyRotateFile({
  dirname: logsDir,
  filename: "%DATE%_boot.log",
  datePattern: "YYYY-MM-DD",
  level: "info",
  zippedArchive: true,
  maxFiles: "14d",
});

const bootLogger = winston.createLogger({
  levels: winston.config.npm.levels,
  defaultMeta: { service: "chitrac-api-boot" },
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [bootFileTransport],
});

bootLogger.add(
  new winston.transports.Console({
    level: "error",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf((info) => `${info.timestamp} [boot] ${info.level}: ${info.message}`)
    ),
  })
);

function registerProcessCrashHandlers() {
  process.on("uncaughtException", (err) => {
    bootLogger.error("uncaughtException", {
      message: err.message,
      stack: err.stack,
    });
    setTimeout(() => process.exit(1), 750);
  });
  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    bootLogger.error("unhandledRejection", { message, stack });
  });
}

module.exports = bootLogger;
module.exports.registerProcessCrashHandlers = registerProcessCrashHandlers;
module.exports.logsDir = logsDir;
