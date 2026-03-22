CREATE TABLE IF NOT EXISTS seek_browser_session (
    id                  SERIAL PRIMARY KEY,
    storage_state_json  TEXT        NOT NULL,
    cookie_count        INTEGER     NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    session_age_days    INTEGER     NOT NULL DEFAULT 0,
    notes               TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_seek_browser_session_active
    ON seek_browser_session (is_active)
    WHERE is_active = TRUE;

COMMENT ON TABLE seek_browser_session IS
    'Stores Playwright storageState cookies from manual SEEK login. Replaces file-based session storage.';

COMMENT ON COLUMN seek_browser_session.session_age_days IS
    'Informational placeholder. The application computes live session age from created_at at query time.';
