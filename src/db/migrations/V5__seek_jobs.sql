DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'seek_sponsorship_score') THEN
        CREATE TYPE seek_sponsorship_score AS ENUM (
            'confirmed',
            'likely',
            'silent',
            'excluded'
        );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'seek_job_status') THEN
        CREATE TYPE seek_job_status AS ENUM (
            'pending',
            'skipped',
            'queued',
            'applying',
            'applied',
            'failed',
            'external',
            'duplicate'
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS seek_job (
    id                      VARCHAR(64)             PRIMARY KEY,
    seek_url                TEXT                    NOT NULL,
    title                   VARCHAR(500)            NOT NULL,
    company                 VARCHAR(500)            NOT NULL,
    location                VARCHAR(500)            NOT NULL,
    salary                  VARCHAR(200),
    posted_date             VARCHAR(100),
    job_description_text    TEXT,
    key_requirements        TEXT,
    sponsorship_score       seek_sponsorship_score  NOT NULL DEFAULT 'silent',
    relevance_score         INTEGER                 NOT NULL DEFAULT 0
                                CHECK (relevance_score >= 0 AND relevance_score <= 100),
    sponsorship_signals     TEXT[],
    exclude_reasons         TEXT[],
    status                  seek_job_status         NOT NULL DEFAULT 'pending',
    applied_at              TIMESTAMPTZ,
    application_id          VARCHAR(200),
    cover_letter_used       TEXT,
    external_url            TEXT,
    error_message           TEXT,
    notes                   TEXT,
    scraped_at              TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    search_query            VARCHAR(500),
    search_location         VARCHAR(200)
);

CREATE INDEX IF NOT EXISTS idx_seek_job_status
    ON seek_job (status);

CREATE INDEX IF NOT EXISTS idx_seek_job_company
    ON seek_job (company);

CREATE INDEX IF NOT EXISTS idx_seek_job_sponsorship_score
    ON seek_job (sponsorship_score);

CREATE INDEX IF NOT EXISTS idx_seek_job_relevance_score
    ON seek_job (relevance_score DESC);

CREATE INDEX IF NOT EXISTS idx_seek_job_applied_at
    ON seek_job (applied_at DESC)
    WHERE applied_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_seek_job_scraped_at
    ON seek_job (scraped_at DESC);

CREATE INDEX IF NOT EXISTS idx_seek_job_status_score
    ON seek_job (status, relevance_score DESC)
    WHERE status NOT IN ('skipped', 'duplicate');

COMMENT ON TABLE seek_job IS
    'All SEEK jobs discovered, filtered, and applied to. Replaces file-based job tracking.';
