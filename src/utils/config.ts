import { config as dotenvConfig } from 'dotenv';
import path from 'path';

// Load environment variables
dotenvConfig();

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  url?: string;
}

export interface LoggingConfig {
  level: string;
  file: string;
}

export interface McpServerConfig {
  port: number;
  host: string;
}

export interface Config {
  database: DatabaseConfig;
  logging: LoggingConfig;
  mcpServer: McpServerConfig;
  nodeEnv: string;
  openaiApiKey?: string;
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (!value) {
    throw new Error(`Environment variable ${key} is required but not set`);
  }
  return value;
}

function getEnvVarAsNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number`);
  }
  return parsed;
}

export const config: Config = {
  database: {
    host: getEnvVar('DATABASE_HOST', 'localhost'),
    port: getEnvVarAsNumber('DATABASE_PORT', 5432),
    database: getEnvVar('DATABASE_NAME', 'claude_compass'),
    user: getEnvVar('DATABASE_USER', 'claude_compass'),
    password: getEnvVar('DATABASE_PASSWORD', 'password'),
    url: process.env.DATABASE_URL,
  },
  logging: {
    level: getEnvVar('LOG_LEVEL', 'info'),
    file: getEnvVar('LOG_FILE', path.join(process.cwd(), 'logs', 'claude-compass.log')),
  },
  mcpServer: {
    port: getEnvVarAsNumber('MCP_SERVER_PORT', 3000),
    host: getEnvVar('MCP_SERVER_HOST', 'localhost'),
  },
  nodeEnv: getEnvVar('NODE_ENV', 'development'),
  openaiApiKey: process.env.OPENAI_API_KEY,
};