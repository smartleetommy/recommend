import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.SUPABASE_DB_SESSION_POOL_URL;

if (!connectionString) {
  throw new Error("Missing SUPABASE_DB_SESSION_POOL_URL");
}

function createPoolConfig(rawConnectionString) {
  try {
    new URL(rawConnectionString);

    return { connectionString: rawConnectionString };
  } catch {
    const match = rawConnectionString.match(
      /^(postgres(?:ql)?:\/\/)([^:@/]+):(.+)@([^/?#:]+)(?::(\d+))?\/([^?]+)(?:\?.*)?$/
    );

    if (!match) {
      throw new Error("Invalid SUPABASE_DB_SESSION_POOL_URL");
    }

    return {
      user: decodeURIComponent(match[2]),
      password: match[3],
      host: match[4],
      port: match[5] ? Number(match[5]) : 5432,
      database: decodeURIComponent(match[6])
    };
  }
}

export const pool = new Pool({
  ...createPoolConfig(connectionString),
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 10000)
});
