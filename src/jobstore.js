// src/jobstore.js
const { getPool } = require('./db');
const { v4: uuidv4 } = require('uuid');

async function enqueue(job) {
  const pool = await getPool();
  const id = job.id || uuidv4();
  const now = new Date();
  const nextRun = job.next_run_at || now;
  const maxRetries = job.max_retries ?? job.maxRetries ?? 3;
  await pool.query(
    `INSERT INTO jobs (id, command, state, attempts, max_retries, created_at, updated_at, next_run_at)
     VALUES (?, ?, 'pending', 0, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE command = VALUES(command), max_retries = VALUES(max_retries)`,
    [id, job.command, maxRetries, now, now, nextRun]
  );
  return id;
}

async function listByState(state) {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC', [state]);
  return rows;
}

async function summary() {
  const pool = await getPool();
  const [rows] = await pool.query(
    `SELECT state, COUNT(*) as count FROM jobs GROUP BY state`
  );
  const map = {};
  rows.forEach(r => (map[r.state] = r.count));
  return map;
}

/**
 * Try claim a pending job atomically.
 * We pick the oldest pending job with next_run_at <= NOW()
 */
async function claimJob(workerId) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Select one job for update and skip locked rows (MySQL 8+)
    const [rows] = await conn.query(
      `SELECT id, command, attempts, max_retries FROM jobs
       WHERE state = 'pending' AND next_run_at <= NOW()
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );

    if (!rows.length) {
      await conn.commit();
      conn.release();
      return null;
    }

    const job = rows[0];
    // update to processing and increment attempts
    await conn.query(
      `UPDATE jobs SET state='processing', attempts = attempts + 1, locked_by = ?, locked_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [workerId, job.id]
    );
    await conn.commit();
    conn.release();

    // fetch the updated job row to include attempts incremented
    const [jobRows] = await pool.query('SELECT * FROM jobs WHERE id = ?', [job.id]);
    return jobRows[0];
  } catch (err) {
    try { await conn.rollback(); } catch (e) {}
    conn.release();
    throw err;
  }
}

async function markCompleted(id) {
  const pool = await getPool();
  await pool.query('UPDATE jobs SET state = ?, updated_at = NOW(), locked_by = NULL, locked_at = NULL WHERE id = ?', ['completed', id]);
}

async function failAndMaybeRetry(job, lastError, backoffBase = 2) {
  const pool = await getPool();
  const attempts = job.attempts;
  const maxRetries = job.max_retries;

  if (attempts >= maxRetries) {
    // Move to DLQ
    await pool.query(
      `INSERT INTO dlq (id, command, attempts, max_retries, created_at, moved_at, last_error)
       VALUES (?, ?, ?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE last_error = VALUES(last_error), moved_at = VALUES(moved_at)`,
      [job.id, job.command, attempts, maxRetries, job.created_at, lastError]
    );
    await pool.query('UPDATE jobs SET state = ?, updated_at = NOW(), locked_by = NULL, locked_at = NULL, last_error = ? WHERE id = ?', ['dead', lastError, job.id]);
    return { movedToDLQ: true };
  } else {
    // compute exponential backoff: delay = base^attempts seconds (attempts already incremented when claimed)
    const delaySeconds = Math.pow(backoffBase, attempts);
    await pool.query(
      `UPDATE jobs
       SET state='pending',
           next_run_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
           updated_at = NOW(),
           locked_by = NULL,
           locked_at = NULL,
           last_error = ?
       WHERE id = ?`,
      [delaySeconds, lastError, job.id]
    );
    return { movedToDLQ: false, nextRetryIn: delaySeconds };
  }
}

async function listDLQ() {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM dlq ORDER BY moved_at DESC');
  return rows;
}

async function retryDLQJob(id) {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM dlq WHERE id = ?', [id]);
  if (!rows.length) throw new Error('DLQ job not found');
  const job = rows[0];
  // Put back into jobs with attempts preserved but state = pending and next_run_at = now
  await pool.query(
    `INSERT INTO jobs (id, command, state, attempts, max_retries, created_at, updated_at, next_run_at, last_error)
     VALUES (?, ?, 'pending', ?, ?, ?, NOW(), NOW(), NULL)
     ON DUPLICATE KEY UPDATE command = VALUES(command), state='pending', next_run_at = NOW(), updated_at = NOW(), last_error = NULL`,
    [job.id, job.command, job.attempts, job.max_retries, job.created_at]
  );
  // remove from dlq
  await pool.query('DELETE FROM dlq WHERE id = ?', [id]);
  return true;
}

module.exports = {
  enqueue,
  listByState,
  summary,
  claimJob,
  markCompleted,
  failAndMaybeRetry,
  listDLQ,
  retryDLQJob
};

