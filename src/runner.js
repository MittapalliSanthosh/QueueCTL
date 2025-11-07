// src/runner.js
const { exec } = require('child_process');

function runCommand(command, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const child = exec(command, { timeout: timeoutMs, shell: true }, (error, stdout, stderr) => {
      if (error) {
        // error.code is the exit code on many systems
        resolve({ success: false, error: (error && error.message) || stderr || 'Unknown error', code: error.code, stdout, stderr });
      } else {
        resolve({ success: true, stdout, stderr });
      }
    });
  });
}

module.exports = { runCommand };

