#!/usr/bin/env node
// src/worker.js
const fs = require('fs');
const path = require('path');
const { getEnv, getConfig } = require('./config');
const jobstore = require('./jobstore');
const { runCommand } = require('./runner');
const { v4: uuidv4 } = require('uuid');

const PID_FILE = process.env.PID_FILE || './workers.pid';

class Worker {
  constructor(id, backoffBase) {
    this.id = id;
    this.running = false;
    this.currentJob = null;
    this.backoffBase = backoffBase || 2;
  }

  async loop(shutdownSignal) {
    this.running = true;
    while (!shutdownSignal.shutdown) {
      try {
        const job = await jobstore.claimJob(this.id);
        if (!job) {
          // nothing ready, sleep a bit
          await new Promise(res => setTimeout(res, 1000));
          continue;
        }
        this.currentJob = job;
        console.log(`[${this.id}] Claimed job ${job.id}. Attempt ${job.attempts}/${job.max_retries}`);
        const { success, error, stdout } = await runCommand(job.command);
        if (success) {
          console.log(`[${this.id}] Job ${job.id} completed. Output: ${stdout ? stdout.toString().trim() : ''}`);
          await jobstore.markCompleted(job.id);
        } else {
          console.warn(`[${this.id}] Job ${job.id} failed: ${error}`);
          await jobstore.failAndMaybeRetry(job, error, this.backoffBase);
        }
        this.currentJob = null;
      } catch (err) {
        console.error(`[${this.id}] Worker error:`, err);
        // Avoid tight infinite loop on persistent DB errors
        await new Promise(res => setTimeout(res, 2000));
      }
    }
    console.log(`[${this.id}] Shutdown signal received. Exiting loop.`);
  }
}

async function startWorkers(count = 1, daemon = false) {
  const backoffBase = parseInt(process.env.BACKOFF_BASE || (await getConfig('backoff_base') || 2), 10);
  const shutdownSignal = { shutdown: false };

  const workers = [];
  for (let i = 0; i < count; i++) {
    const w = new Worker(`worker-${process.pid}-${i}-${uuidv4().slice(0,6)}`, backoffBase);
    workers.push(w);
  }

  // write PID file if daemon
  if (daemon) {
    fs.writeFileSync(PID_FILE, `${process.pid}\n`, { flag: 'w' });
  }

  // handle signals
  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down...');
    shutdownSignal.shutdown = true;
  });
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    shutdownSignal.shutdown = true;
  });

  // start loops concurrently
  await Promise.all(workers.map(w => w.loop(shutdownSignal)));

  // cleanup
  if (daemon && fs.existsSync(PID_FILE)) {
    try { fs.unlinkSync(PID_FILE); } catch (e) {}
  }
  console.log('All workers stopped.');
}

async function stopDaemon() {
  if (!fs.existsSync(PID_FILE)) {
    console.error('PID file not found. Is a daemon running?');
    process.exitCode = 1;
    return;
  }
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').split('\n')[0], 10);
  if (!pid) {
    console.error('Invalid PID file content');
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Sent SIGTERM to PID ${pid}`);
  } catch (err) {
    console.error('Failed to stop process:', err.message);
  }
}

module.exports = { startWorkers, stopDaemon, PID_FILE };

