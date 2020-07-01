require('dotenv').config();
const winston = require('winston');
const { format } = require('winston');
const path = require('path');
require('winston-mongodb');

const logFormat = format.printf(({ level, message, metadata, timestamp }) => {
  return `${timestamp} [${metadata.process}] ${level}: ${message}`;
});

const mongoOpts = {
  options: {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  },
};

winston.loggers.add('logs', {
  format: format.combine(format.timestamp(), logFormat),
  transports: [
    new winston.transports.File({
      filename: path.resolve(__dirname, '..', 'logs', 'logs.log'),
    }),
    new winston.transports.Console({
      format: format.combine(format.colorize(), format.timestamp(), logFormat),
    }),
    new winston.transports.MongoDB({
      db: process.env.MONGODB_URL,
      ...mongoOpts,
    }),
  ],
});

winston.exitOnError = false;

const timeout = (millis) =>
  new Promise((resolve) => setTimeout(resolve, millis));

module.exports = {
  timeout,
  winston,
};
