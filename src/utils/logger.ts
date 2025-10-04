import winston from 'winston';
import path from 'path';
import { config } from './config';

// Ensure logs directory exists
const logDir = path.dirname(config.logging.file);

const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss',
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss',
  }),
  winston.format.printf(({ timestamp, level, message, component, ...meta }) => {
    // Only include essential metadata in console output to reduce noise
    const essentialMeta = Object.keys(meta).filter(key =>
      !['service', 'component'].includes(key) &&
      !['patterns', 'patternsUsed', 'options'].includes(key)
    );

    let output = `${timestamp} [${level}]: ${message}`;

    // Add component if present and different from service
    if (component && component !== 'claude-compass') {
      output += ` (${component})`;
    }

    // Only add essential metadata (file counts, error counts, etc.)
    if (essentialMeta.length > 0) {
      const essentialData = essentialMeta.reduce((acc, key) => {
        acc[key] = meta[key];
        return acc;
      }, {} as any);

      // Only show if it's small and useful
      if (JSON.stringify(essentialData).length < 200) {
        output += ` ${JSON.stringify(essentialData)}`;
      }
    }

    return output;
  })
);

export const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  defaultMeta: { service: 'claude-compass' },
  transports: [
    // File transport for all logs
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
    }),
    // Error-specific file
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

// Add console transport for development
if (config.nodeEnv !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
      level: 'info', // Only show info and above in console, debug goes to file only
    })
  );
}

// Create child loggers for different components
export const createComponentLogger = (component: string): winston.Logger => {
  return logger.child({ component });
};

export const flushLogs = async (): Promise<void> => {
  return new Promise((resolve) => {
    setImmediate(() => {
      setImmediate(() => {
        setImmediate(() => {
          setTimeout(resolve, 200);
        });
      });
    });
  });
};