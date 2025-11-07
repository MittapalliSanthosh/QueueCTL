# queuectl - CLI Job Queue with Retries and DLQ (Node.js + MySQL)

`queuectl` is a command-line interface (CLI) tool for managing background jobs with features like multiple workers, retries with exponential backoff, a Dead Letter Queue (DLQ), and persistence using MySQL.

## Prereqs

*   Node.js 18+ and npm
*   MySQL 8+ (or a compatible MySQL version; `SKIP LOCKED` is used for optimal concurrency but falls back to other locking mechanisms if not available)
*   `mysql` CLI client (optional, but useful for manual DB interaction)

## Setup and Installation

1.  **Clone or create the project structure:**

    Create the directories and files as outlined in the "Project layout" section above.

2.  **Install Node.js dependencies:**

    Navigate to the `queuectl` root directory and run:

    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**

    Copy the `.env.example` file to `.env` and edit your MySQL database credentials and other optional settings:

    ```bash
    cp .env.example .env
    # Open .env and modify DB_PASSWORD, etc.
    ```

4.  **Run Database Migrations:**

    Execute the `migrations.sql` file against your MySQL server. This will create the `queuectl` database (if it doesn't exist) and the necessary `jobs`, `dlq`, and `config` tables.

    ```bash
    mysql -u root -p < migrations.sql
    ```

    (Enter your MySQL root password when prompted.)

5.  **Make CLI Executable and Link (Optional):**

    Ensure the CLI scripts are executable:

    ```bash
    chmod +x src/cli.js src/worker.js
    ```

    For global access to the `queuectl` command, you can link it:

    ```bash
    npm link
    ```

    After this, you can run `queuectl` directly from any directory. Otherwise, you'll run it using `node src/cli.js`.

## Usage Examples

### Enqueue a Job

Add a new job to the queue. The `jobJson` must be a JSON string.

You can specify `id` (optional, UUID generated if not provided), `command`, and `max_retries`.

```bash
queuectl enqueue '{"id":"my-first-job","command":"echo Hello from queuectl","max_retries":3}'
queuectl enqueue '{"command":"sleep 5 && echo Done sleeping"}'
```

### Start Workers

Workers process jobs from the queue. You can specify the number of concurrent workers and whether to run them in the background as a daemon.

**Start 2 workers in the foreground:**

```bash
node src/cli.js worker start --count 2
```

(Use CTRL+C to stop foreground workers gracefully.)

**Start 1 worker as a daemon (background process):**

```bash
queuectl worker start --count 1 --daemon
```

(The daemon's PID will be written to `workers.pid`.)

### Stop Daemon Workers

If workers were started with `--daemon`, you can stop them gracefully using:

```bash
queuectl worker stop
```

This sends a SIGTERM signal to the process recorded in `workers.pid`.

### Check Status

Get a summary of job counts by state and check for active worker daemons.

```bash
queuectl status
```

**Output:**

```
Job counts by state:
┌───────────┬───────┐
│ State     │ Count │
├───────────┼───────┤
│ pending   │ 5     │
│ completed │ 10    │
│ failed    │ 2     │
│ dead      │ 1     │
└───────────┴───────┘
Worker PID file found at ./workers.pid
12345
```

### List Jobs

List jobs filtered by their current state.

```bash
queuectl list --state pending
queuectl list --state completed
queuectl list --state failed
queuectl list --state dead
```

Output will be a table of job details.

### Dead Letter Queue (DLQ) Management

Jobs that exhaust their retry attempts are moved to the DLQ.

**List jobs in the DLQ:**

```bash
queuectl dlq list
```

**Retry a job from the DLQ:**

This moves the job back to the `pending` state, resetting its `next_run_at` to now, but preserving its `attempts` count.

```bash
queuectl dlq retry <job-id-from-dlq>
```

### Configure Runtime Settings

You can adjust certain runtime parameters persisted in the `config` table.

**Set the exponential backoff base (default is 2):**

```bash
queuectl config set backoff_base 3
```

**Get a configuration value:**

```bash
queuectl config get backoff_base
```

## Testing Scenarios

To verify `queuectl` functionality:

*   **Basic Success:** Enqueue an `echo` command job and observe it transition to `completed`.
*   **Failure & Retry:** Enqueue a job with an `invalid_command`; it should fail and retry (e.g., 3 times by default), then eventually appear in the `dead` state and in the `dlq`.
*   **Multiple Workers:** Start with `--count 3` and enqueue several quick or `sleep` jobs. Observe them being processed in parallel.
*   **Persistence:** Enqueue some jobs, then restart your MySQL server and workers. The jobs should remain in the database and processing should resume.
*   **Graceful Shutdown:** Start a worker with a long-running job (e.g., `sleep 30`). Send a SIGTERM (e.g., via `queuectl worker stop` for daemon, or CTRL+C for foreground). The worker should finish its current job before exiting.

## Smoke Test Script

A basic smoke test is provided to quickly check the core functionalities:

```bash
bash scripts/smoke-test.sh
```

## Implementation Notes, Assumptions & Tradeoffs

*   **Locking & Concurrency:** The `claimJob` function uses `SELECT ... FOR UPDATE SKIP LOCKED` within a transaction to atomically claim jobs and prevent multiple workers from processing the same job concurrently. This requires MySQL 8+. If your MySQL version does not support `SKIP LOCKED`, the query will still function, but there's a higher risk of race conditions where multiple workers might momentarily try to claim the same job before the update lock is applied. A transactional update with a `locked_by` guard can mitigate this.

*   **Dead Letter Queue (DLQ):** Jobs that exhaust their `max_retries` are marked `dead` in the `jobs` table and simultaneously inserted into the `dlq` table. This provides a clear separation for dead jobs and allows for easier inspection and re-queueing.

*   **Exponential Backoff:** The retry delay is calculated as `backoffBase ^ attempts` seconds. `attempts` is incremented when the job is claimed, so the delay is based on the next attempt number.

*   **Worker Stop (--daemon):** When `worker start --daemon` is used, a PID file (`workers.pid`) is created. The `worker stop` command reads this file and sends a SIGTERM signal to the specified PID, enabling a graceful shutdown. If workers are run in the foreground, CTRL+C is used for shutdown.

*   **Command Execution:** Jobs are executed using Node.js `child_process.exec`. A default timeout of 60 seconds is applied. For very long-running commands or commands with large outputs, this timeout may need to be increased, or `child_process.spawn` might be a better choice for streaming output.

*   **Job Timeout Handling:** Beyond the `child_process.exec` timeout, there isn't explicit logic to mark a job as failed if it runs for too long. This could be an enhancement for future versions.

*   **Configuration:** Runtime configuration (like `backoff_base`) is stored in the `config` MySQL table, allowing dynamic adjustments via CLI commands. Environment variables take precedence over DB config if both are set.

*   **Security:** Database credentials should be stored securely (e.g., in `.env` for development/testing, but in a secrets manager for production). The `command` field directly executes shell commands, so it's crucial to ensure job commands come from trusted sources to prevent command injection vulnerabilities.

## Future Enhancements

*   **Job Timeout:** Implement a mechanism to mark jobs as failed if they exceed a configurable execution time.
*   **Worker Heartbeats:** Workers could periodically update a "last seen" timestamp in the database, allowing for detection of crashed workers and re-queuing of their locked jobs.
*   **Web UI/API:** A simple web interface or REST API for managing jobs, viewing status, and interacting with the DLQ.
*   **Job Prioritization:** Allow jobs to be enqueued with different priority levels.
*   **Concurrency Limits per Command:** Limit the number of concurrent executions for specific types of commands.
*   **More Robust Error Handling:** Differentiate between transient and permanent job failures.
*   **Logging:** More structured and configurable logging.
*   **Advanced Scheduling:** Support for cron-like scheduling of jobs.
