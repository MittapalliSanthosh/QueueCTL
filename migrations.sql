-- migrations.sql

CREATE DATABASE IF NOT EXISTS queuectl;
USE queuectl;

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(128) PRIMARY KEY,
  command TEXT NOT NULL,
  state ENUM('pending','processing','completed','failed','dead') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 3,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  next_run_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_by VARCHAR(128) NULL,
  locked_at DATETIME NULL,
  last_error TEXT NULL
);

-- Dead Letter Queue table (optional duplicate, but clearer)
CREATE TABLE IF NOT EXISTS dlq (
  id VARCHAR(128) PRIMARY KEY,
  command TEXT NOT NULL,
  attempts INT NOT NULL,
  max_retries INT NOT NULL,
  created_at DATETIME NOT NULL,
  moved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT NULL
);

-- Config table
CREATE TABLE IF NOT EXISTS config (
  name VARCHAR(128) PRIMARY KEY,
  value VARCHAR(255) NOT NULL
);

-- Defaults
INSERT INTO config (name,value) VALUES
  ('backoff_base','2') ON DUPLICATE KEY UPDATE value=value,
  ('default_max_retries','3') ON DUPLICATE KEY UPDATE value=value;

