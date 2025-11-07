#!/usr/bin/env node
// src/cli.js
const { program } = require('commander');
const { getEnv, getConfig, setConfig } = require('./config');
const jobstore = require('./jobstore');
const { startWorkers, stopDaemon, PID_FILE } = require('./worker');
const fs = require('fs');

program.version('1.0.0').description('queuectl - CLI job queue');

program
  .command('enqueue <jobJson>')
  .description("Enqueue a job: e.g. queuectl enqueue '{\"id\":\"job1\",\"command\":\"sleep 2\"}'")
  .action(async (jobJson) => {
    try {
      const job = JSON.parse(jobJson);
      const id = await jobstore.enqueue(job);
      console.log('Enqueued job:', id);
    } catch (err) {
      console.error('Failed to enqueue job:', err.message);
    } finally {
      process.exit();
    }
  });

program
  .command('worker start')
  .description('Start workers: queuectl worker start --count 3 [--daemon]')
  .option('--count <n>', 'number of workers to run concurrently', '1')
  .option('--daemon', 'run in background (write pidfile)', false)
  .action(async (opts) => {
    const count = parseInt(opts.count || 1, 10);
    const daemon = !!opts.daemon;
    console.log(`Starting ${count} worker(s)${daemon ? ' as daemon' : ''}...`);
    await startWorkers(count, daemon);
  });

program
  .command('worker stop')
  .description('Stop running worker daemon gracefully (reads PID file)')
  .action(async () => {
    await stopDaemon();
    process.exit();
  });

program
  .command('status')
  .description('Show summary of job states & active worker PID file')
  .action(async () => {
    try {
      const sum = await jobstore.summary();
      console.log('Job counts by state:');
      console.table(sum);
      if (fs.existsSync(PID_FILE)) {
        console.log('Worker PID file found at', PID_FILE);
        console.log(fs.readFileSync(PID_FILE, 'utf8'));
      } else {
        console.log('No worker PID file found (workers might be running in foreground or no daemon started).');
      }
    } catch (err) {
      console.error('Error fetching status:', err.message);
    } finally {
      process.exit();
    }
  });

program
  .command('list')
  .description('List jobs by state: queuectl list --state pending')
  .option('--state <state>', 'pending|processing|completed|failed|dead', 'pending')
  .action(async (opts) => {
    try {
      const rows = await jobstore.listByState(opts.state);
      if (!rows.length) {
        console.log('No jobs found.');
      } else {
        console.table(rows.map(r => ({
          id: r.id,
          command: r.command,
          attempts: r.attempts,
          max_retries: r.max_retries,
          state: r.state,
          next_run_at: r.next_run_at,
          last_error: r.last_error
        })));
      }
    } catch (err) {
      console.error('Error listing jobs:', err.message);
    } finally {
      process.exit();
    }
  });

program
  .command('dlq list')
  .description('List DLQ jobs')
  .action(async () => {
    try {
      const rows = await jobstore.listDLQ();
      if (!rows.length) console.log('DLQ empty');
      else console.table(rows);
    } catch (err) {
      console.error('Error listing DLQ:', err.message);
    } finally {
      process.exit();
    }
  });

program
  .command('dlq retry <id>')
  .description('Retry job from DLQ by id')
  .action(async (id) => {
    try {
      await jobstore.retryDLQJob(id);
      console.log('Job retried from DLQ:', id);
    } catch (err) {
      console.error('Error retrying DLQ job:', err.message);
    } finally {
      process.exit();
    }
  });

program
  .command('config set <key> <value>')
  .description('Set configuration values (backoff_base, default_max_retries)')
  .action(async (key, value) => {
    try {
      await setConfig(key, String(value));
      console.log(`Config ${key} set to ${value}`);
    } catch (err) {
      console.error('Error setting config:', err.message);
    } finally {
      process.exit();
    }
  });

program
  .command('config get <key>')
  .description('Get configuration value')
  .action(async (key) => {
    try {
      const val = await getConfig(key);
      console.log(key, '=', val);
    } catch (err) {
      console.error('Error getting config:', err.message);
    } finally {
      process.exit();
    }
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}

