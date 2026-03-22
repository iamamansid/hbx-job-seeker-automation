-- V1__Initial_schema.sql
CREATE TABLE agent_run (
    id SERIAL PRIMARY KEY,
    start_time TIMESTAMP NOT NULL DEFAULT NOW(),
    end_time TIMESTAMP,
    status VARCHAR(50) NOT NULL, -- 'RUNNING', 'COMPLETED', 'FAILED'
    search_terms TEXT,
    location VARCHAR(255)
);

CREATE TABLE job_listing (
    id SERIAL PRIMARY KEY,
    run_id INTEGER REFERENCES agent_run(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    company VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    url TEXT UNIQUE NOT NULL,
    description TEXT,
    portal_source VARCHAR(50) NOT NULL, -- 'LinkedIn', 'Seek', 'Indeed', 'ETaxJobs', 'WorkVisa'
    salary VARCHAR(255),
    visa_sponsorship_mentioned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE job_event (
    id SERIAL PRIMARY KEY,
    job_id INTEGER REFERENCES job_listing(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL, -- 'SCRAPED', 'ANALYZED', 'PLANNED', 'APPLIED', 'REJECTED'
    event_message TEXT,
    event_data JSONB, -- Stores LLM decisions, application plans, fill stats
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_url ON job_listing(url);
CREATE INDEX idx_job_event_type ON job_event(job_id, event_type);
