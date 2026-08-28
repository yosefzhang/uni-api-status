import sqlite3 from "sqlite3";
import { Pool } from "pg";
import { promisify } from "util";
import fs from "fs";

const dbType = process.env.STATS_DB_TYPE || "sqlite";

let db: any;
let query: any;

if (dbType === "postgres") {
  const pool = new Pool({
    user: process.env.STATS_DB_USER,
    host: process.env.STATS_DB_HOST,
    database: process.env.STATS_DB_NAME,
    password: process.env.STATS_DB_PASSWORD,
    port: parseInt(process.env.STATS_DB_PORT || "5432", 10),
  });

  db = pool;
  query = async (sql: string, params: any[] = []) => {
    const client = await pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows;
    } finally {
      client.release();
    }
  };
} else {
  const dbPath = process.env.STATS_DB_PATH || "./data/stats.db";

  // 统计数据库可能尚未生成（例如 uni-api 从未记录过任何请求）。
  // 此时以只读方式打开会抛 SQLITE_CANTOPEN，这里降级为返回空数据，避免进程崩溃。
  if (!fs.existsSync(dbPath)) {
    console.warn(`[db] 统计数据库不存在，统计功能暂不可用: ${dbPath}`);
    db = null;
    query = async () => [];
  } else {
    const sqlite = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    db = sqlite;

    const all = promisify((sql: string, params: any[], callback: (err: Error | null, rows: any[]) => void) =>
      sqlite.all(sql, params, callback)
    );
    const run = promisify((sql: string, params: any[], callback: (err: Error | null) => void) =>
      sqlite.run(sql, params, callback)
    );

    query = async (sql: string, params: any[] = []) => {
      const sqliteSql = sql.replace(/\$\d+/g, "?");
      return await all(sqliteSql, params);
    };
  }
}

export { db, query };