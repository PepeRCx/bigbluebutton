import { Pool } from 'pg';
import {
  BBB_GRAPHQL_DB_HOST,
  BBB_GRAPHQL_DB_NAME,
  BBB_GRAPHQL_DB_PASSWORD,
  BBB_GRAPHQL_DB_PORT,
  BBB_GRAPHQL_DB_USER,
} from '../config';

let postgresPool: Pool | null = null;

export const getPostgresPool = (): Pool => {
  if (postgresPool) {
    return postgresPool;
  }

  postgresPool = new Pool({
    host: BBB_GRAPHQL_DB_HOST,
    port: BBB_GRAPHQL_DB_PORT,
    database: BBB_GRAPHQL_DB_NAME,
    user: BBB_GRAPHQL_DB_USER,
    password: BBB_GRAPHQL_DB_PASSWORD,
    max: 5,
  });

  postgresPool.on('error', (err: Error) => {
    console.error('[Postgres] Pool error:', err.message);
  });

  return postgresPool;
};

export default {
  getPostgresPool,
};
