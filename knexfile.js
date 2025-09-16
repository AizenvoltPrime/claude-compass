require('dotenv').config();

module.exports = {
  development: {
    client: 'postgresql',
    connection: {
      host: process.env.DATABASE_HOST || 'localhost',
      port: process.env.DATABASE_PORT || 5432,
      database: process.env.DATABASE_NAME || 'claude_compass',
      user: process.env.DATABASE_USER || 'claude_compass',
      password: process.env.DATABASE_PASSWORD || 'password',
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      directory: './dist/database/migrations',
      tableName: 'knex_migrations',
      extension: 'js',
      loadExtensions: ['.js']
    }
  },

  test: {
    client: 'postgresql',
    connection: {
      host: process.env.DATABASE_HOST || 'localhost',
      port: process.env.DATABASE_PORT || 5432,
      database: process.env.DATABASE_NAME ? `${process.env.DATABASE_NAME}_test` : 'claude_compass_test',
      user: process.env.DATABASE_USER || 'claude_compass',
      password: process.env.DATABASE_PASSWORD || 'password',
    },
    pool: {
      min: 1,
      max: 5
    },
    migrations: {
      directory: './dist/database/migrations',
      tableName: 'knex_migrations',
      extension: 'js',
      loadExtensions: ['.js']
    }
  },

  production: {
    client: 'postgresql',
    connection: process.env.DATABASE_URL,
    pool: {
      min: 2,
      max: 20
    },
    migrations: {
      directory: './dist/database/migrations',
      tableName: 'knex_migrations',
      extension: 'js',
      loadExtensions: ['.js']
    }
  }
};