CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY,
  run_type TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  target_country TEXT NOT NULL,
  target_portals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  jobs_discovered INTEGER NOT NULL DEFAULT 0,
  applications_attempted INTEGER NOT NULL DEFAULT 0,
  applications_applied INTEGER NOT NULL DEFAULT 0,
  applications_pending INTEGER NOT NULL DEFAULT 0,
  applications_failed INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  salary TEXT,
  portal_source TEXT,
  visa_sponsorship_mentioned BOOLEAN NOT NULL DEFAULT FALSE,
  current_status TEXT NOT NULL DEFAULT 'discovered',
  relevance_score DOUBLE PRECISION,
  visa_sponsorship_score INTEGER,
  fill_rate INTEGER,
  last_run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  notes TEXT,
  latest_error TEXT,
  latest_form_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_processed_at TIMESTAMPTZ,
  last_applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY,
  run_id UUID REFERENCES runs(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  job_url TEXT,
  portal_source TEXT,
  event_type TEXT NOT NULL,
  event_status TEXT,
  message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(current_status);
CREATE INDEX IF NOT EXISTS idx_jobs_portal_source ON jobs(portal_source);
CREATE INDEX IF NOT EXISTS idx_jobs_last_run_id ON jobs(last_run_id);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id);
CREATE INDEX IF NOT EXISTS idx_events_job_id ON events(job_id);
CREATE INDEX IF NOT EXISTS idx_events_type_created_at ON events(event_type, created_at DESC);
