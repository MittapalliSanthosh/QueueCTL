#!/usr/bin/env bash
# scripts/smoke-test.sh
set -e

echo "Enqueueing a quick success job (echo)"
queuectl enqueue '{"id":"job-echo-1","command":"echo OK","max_retries":2}'

echo "Enqueueing a job that fails quickly (invalid command)"
queuectl enqueue '{"id":"job-bad-1","command":"invalid_cmd_should_fail","max_retries":2}'

echo "Starting a single worker in background..."
queuectl worker start --count 1 --daemon

echo "Waiting 8 seconds for processing + retries..."
sleep 8

echo "Current status:"
queuectl status
echo "List pending:"
queuectl list --state pending
echo "List completed:"
queuectl list --state completed
echo "DLQ list:"
queuectl dlq list

echo "Stopping worker..."
queuectl worker stop
echo "Done"

