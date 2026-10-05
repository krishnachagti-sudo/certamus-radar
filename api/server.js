// Entry point on Railway (`npm start`): reads the environment
// (api/config.js), connects to Postgres as radar_api and serves the API.
import http from 'node:http';
import pg from 'pg';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createGoogle } from './google.js';
import { poolDb } from './pg.js';

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
pool.on('error', e => console.error(`postgres pool: ${e.message}`));

const handler = createApp({
  db: poolDb(pool),
  google: createGoogle({ clientId: config.googleClientId, clientSecret: config.googleClientSecret }),
  config,
});

const server = http.createServer(handler);
server.requestTimeout = 60000;
server.headersTimeout = 20000;
server.listen(config.port, () => console.log(`certamus-radar api on :${config.port} for ${config.allowedOrigins.join(', ')}`));

process.on('SIGTERM', () => {
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 10000).unref();
});
