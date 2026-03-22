DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'seek_blacklist_type') THEN
        CREATE TYPE seek_blacklist_type AS ENUM (
            'company',
            'title_pattern'
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS seek_blacklist (
    id              SERIAL               PRIMARY KEY,
    entry_type      seek_blacklist_type  NOT NULL,
    value           VARCHAR(500)         NOT NULL,
    reason          TEXT,
    added_at        TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    added_by        VARCHAR(200)         DEFAULT 'operator',
    is_active       BOOLEAN              NOT NULL DEFAULT TRUE,
    UNIQUE (entry_type, value)
);

INSERT INTO seek_blacklist (entry_type, value, reason) VALUES
    ('company', 'dws limited', 'Explicitly states no visa sponsorship'),
    ('company', 'dws group', 'Explicitly states no visa sponsorship'),
    ('company', 'australian public service', 'Government roles do not sponsor'),
    ('company', 'department of defence', 'Requires security clearance'),
    ('company', 'services australia', 'Government - no sponsorship')
ON CONFLICT (entry_type, value) DO NOTHING;

COMMENT ON TABLE seek_blacklist IS
    'Blacklisted companies and title patterns. Replaces file-based blacklist storage.';
