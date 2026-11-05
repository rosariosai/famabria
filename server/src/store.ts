// All SQL lives here. MariaDB through mysql2 (pure JavaScript, works with MariaDB and MySQL).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import type { CalEvent } from '../../src/core/events';
import type { Config } from './config';

export const SCHEMA_VERSION = 1;
export const CLOCK_TOLERANCE_MS = 10 * 60 * 1000;

export interface ServerEvent extends CalEvent { seq: number; by: string }
export interface PushResult { applied: string[]; ignored: string[]; rejected: { id: string; reason: string }[]; cursor: number }

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export class Store {
  readonly pool: Pool;
  constructor(cfg: Config['db']) {
    this.pool = mysql.createPool({
      host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database,
      charset: 'utf8mb4', waitForConnections: true, connectionLimit: 6, supportBigNumbers: true, bigNumberStrings: false,
      connectTimeout: 8000,
    });
  }

  async close() { await this.pool.end(); }

  async ping(): Promise<boolean> {
    try { await this.pool.query('SELECT 1'); return true; } catch { return false; }
  }

  /** Creates the tables when missing. Safe to run on every start. Only tn_* tables are touched. */
  async migrate(): Promise<void> {
    const q = (sql: string) => this.pool.query(sql);
    await q(`CREATE TABLE IF NOT EXISTS tn_meta (k VARCHAR(40) NOT NULL PRIMARY KEY, v VARCHAR(200) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS tn_users (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(40) NOT NULL, token_hash CHAR(64) NOT NULL,
      created_at BIGINT NOT NULL, revoked_at BIGINT NULL, UNIQUE KEY uq_name (name), KEY ix_token (token_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS tn_seq (id TINYINT NOT NULL PRIMARY KEY, v BIGINT NOT NULL) ENGINE=InnoDB`);
    await q(`INSERT IGNORE INTO tn_seq (id, v) VALUES (1, 0)`);
    await q(`CREATE TABLE IF NOT EXISTS tn_events (
      id VARCHAR(64) NOT NULL PRIMARY KEY, seq BIGINT NOT NULL, calendar_id VARCHAR(64) NOT NULL, date CHAR(10) NOT NULL,
      title VARCHAR(120) NOT NULL, notes TEXT NOT NULL, time CHAR(5) NULL, color VARCHAR(16) NOT NULL,
      created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, deleted_at BIGINT NULL, author VARCHAR(40) NOT NULL,
      KEY ix_seq (seq), KEY ix_date (date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT v FROM tn_meta WHERE k='schema_version'`);
    if (!rows.length) await this.pool.query(`INSERT INTO tn_meta (k, v) VALUES ('schema_version', ?)`, [String(SCHEMA_VERSION)]);
    else if (Number(rows[0].v) > SCHEMA_VERSION) throw new Error('The database was created by a newer server version. Update the server.');
  }

  // ---------------------------------------------------------------- users
  /** Returns the new token. It is shown once and only its hash is stored. */
  async addUser(name: string, now = Date.now()): Promise<string> {
    if (!/^[a-z0-9][a-z0-9._-]{0,38}$/i.test(name)) throw new Error('A user name uses letters, digits, dot, dash or underscore (max 39).');
    const token = 'tn_' + randomBytes(32).toString('base64url');
    try {
      await this.pool.query(`INSERT INTO tn_users (name, token_hash, created_at) VALUES (?, ?, ?)`, [name.toLowerCase(), hash(token), now]);
    } catch (e) {
      if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw new Error(`User "${name}" already exists. Revoke it first to issue a new token.`);
      throw e;
    }
    return token;
  }
  async listUsers(): Promise<{ name: string; createdAt: number; revokedAt: number | null }[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT name, created_at, revoked_at FROM tn_users ORDER BY id`);
    return rows.map((r) => ({ name: r.name, createdAt: Number(r.created_at), revokedAt: r.revoked_at === null ? null : Number(r.revoked_at) }));
  }
  /** Revokes and frees the name, so the same person can be issued a fresh token. */
  async revokeUser(name: string): Promise<boolean> {
    const [r] = await this.pool.query<mysql.ResultSetHeader>(`DELETE FROM tn_users WHERE name = ?`, [name.toLowerCase()]);
    return r.affectedRows > 0;
  }
  async userForToken(token: string): Promise<string | null> {
    if (!/^tn_[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
    const h = hash(token);
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT name, token_hash FROM tn_users WHERE token_hash = ? AND revoked_at IS NULL`, [h]);
    const row = rows[0];
    if (!row) return null;
    return timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(h)) ? (row.name as string) : null;
  }

  // ---------------------------------------------------------------- events
  private toEvent(r: RowDataPacket): ServerEvent {
    return {
      id: r.id, calendarId: r.calendar_id, date: r.date, title: r.title, notes: r.notes, time: r.time, color: r.color,
      createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), deletedAt: r.deleted_at === null ? null : Number(r.deleted_at),
      seq: Number(r.seq), by: r.author,
    };
  }

  async cursor(): Promise<number> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT v FROM tn_seq WHERE id = 1`);
    return Number(rows[0]?.v ?? 0);
  }

  async changesSince(since: number, limit: number): Promise<{ events: ServerEvent[]; cursor: number; more: boolean }> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT * FROM tn_events WHERE seq > ? ORDER BY seq ASC LIMIT ?`, [since, limit + 1]);
    const more = rows.length > limit;
    const events = rows.slice(0, limit).map((r) => this.toEvent(r));
    return { events, more, cursor: events.length ? events[events.length - 1].seq : since };
  }

  async allEvents(): Promise<ServerEvent[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT * FROM tn_events ORDER BY seq ASC`);
    return rows.map((r) => this.toEvent(r));
  }

  /**
   * Last write wins per event (newer updatedAt). The whole batch is one transaction and holds the counter row lock until commit,
   * so sequence numbers become visible in the same order they were handed out (a client's cursor can never skip an event).
   */
  async push(events: CalEvent[], author: string, now = Date.now()): Promise<PushResult> {
    for (let attempt = 1; ; attempt++) {
      try { return await this.pushOnce(events, author, now); }
      catch (err) {
        if ((err as { errno?: number }).errno === 1213 && attempt < 4) continue; // deadlock: safe to retry, nothing was committed
        throw err;
      }
    }
  }

  private async pushOnce(events: CalEvent[], author: string, now: number): Promise<PushResult> {
    const applied: string[] = [], ignored: string[] = [], rejected: { id: string; reason: string }[] = [];
    const conn: PoolConnection = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`SELECT v FROM tn_seq WHERE id = 1 FOR UPDATE`); // one writer at a time, always the same lock order
      for (const e of events) {
        if (e.updatedAt > now + CLOCK_TOLERANCE_MS) { rejected.push({ id: e.id, reason: 'The device clock is ahead of the server. Fix the clock and try again.' }); continue; }
        const [cur] = await conn.query<RowDataPacket[]>(`SELECT updated_at FROM tn_events WHERE id = ? FOR UPDATE`, [e.id]);
        if (cur.length && Number(cur[0].updated_at) >= e.updatedAt) { ignored.push(e.id); continue; }
        await conn.query(`UPDATE tn_seq SET v = LAST_INSERT_ID(v + 1) WHERE id = 1`);
        const [[{ s }]] = (await conn.query<RowDataPacket[]>(`SELECT LAST_INSERT_ID() AS s`)) as unknown as [[{ s: number }]];
        await conn.query(
          `INSERT INTO tn_events (id, seq, calendar_id, date, title, notes, time, color, created_at, updated_at, deleted_at, author)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE seq=VALUES(seq), calendar_id=VALUES(calendar_id), date=VALUES(date), title=VALUES(title), notes=VALUES(notes),
             time=VALUES(time), color=VALUES(color), created_at=VALUES(created_at), updated_at=VALUES(updated_at), deleted_at=VALUES(deleted_at), author=VALUES(author)`,
          [e.id, s, e.calendarId, e.date, e.title, e.notes, e.time, e.color, e.createdAt, e.updatedAt, e.deletedAt, author],
        );
        applied.push(e.id);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => undefined);
      throw err;
    } finally {
      conn.release();
    }
    return { applied, ignored, rejected, cursor: await this.cursor() };
  }
}
