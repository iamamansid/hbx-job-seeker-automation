CREATE TABLE IF NOT EXISTS seek_run_session (
    id                  SERIAL          PRIMARY KEY,
    started_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    finished_at         TIMESTAMPTZ,
    duration_seconds    INTEGER         GENERATED ALWAYS AS (
                            EXTRACT(EPOCH FROM (finished_at - started_at))::INTEGER
                        ) STORED,
    jobs_discovered     INTEGER         NOT NULL DEFAULT 0,
    jobs_applied        INTEGER         NOT NULL DEFAULT 0,
    jobs_skipped        INTEGER         NOT NULL DEFAULT 0,
    jobs_external       INTEGER         NOT NULL DEFAULT 0,
    jobs_failed         INTEGER         NOT NULL DEFAULT 0,
    jobs_duplicate      INTEGER         NOT NULL DEFAULT 0,
    status              VARCHAR(50)     NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running', 'completed', 'failed', 'dry_run')),
    is_dry_run          BOOLEAN         NOT NULL DEFAULT FALSE,
    error_message       TEXT,
    notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_seek_run_session_started_at
    ON seek_run_session (started_at DESC);

COMMENT ON TABLE seek_run_session IS
    'One row per bot execution. Tracks aggregate stats for each run.';
