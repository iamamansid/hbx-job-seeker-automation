CREATE OR REPLACE VIEW seek_daily_summary AS
SELECT
    DATE(applied_at AT TIME ZONE 'Australia/Adelaide') AS application_date,
    COUNT(*) AS total_applied,
    AVG(relevance_score)::INTEGER AS avg_relevance_score,
    COUNT(*) FILTER (WHERE sponsorship_score = 'confirmed') AS confirmed_sponsor_count,
    COUNT(*) FILTER (WHERE sponsorship_score = 'likely') AS likely_sponsor_count,
    COUNT(*) FILTER (WHERE sponsorship_score = 'silent') AS silent_sponsor_count
FROM seek_job
WHERE status = 'applied'
  AND applied_at IS NOT NULL
GROUP BY DATE(applied_at AT TIME ZONE 'Australia/Adelaide')
ORDER BY application_date DESC;

CREATE OR REPLACE VIEW seek_top_companies AS
SELECT
    company,
    COUNT(*) FILTER (WHERE status = 'applied') AS applied_count,
    COUNT(*) FILTER (WHERE status = 'skipped') AS skipped_count,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
    MAX(relevance_score) AS max_relevance_score,
    MAX(applied_at) AS last_applied_at
FROM seek_job
GROUP BY company
ORDER BY applied_count DESC, max_relevance_score DESC;

CREATE OR REPLACE VIEW seek_pending_manual_review AS
SELECT
    id,
    title,
    company,
    location,
    seek_url,
    relevance_score,
    sponsorship_score,
    external_url,
    scraped_at
FROM seek_job
WHERE status = 'external'
ORDER BY relevance_score DESC, scraped_at DESC;

COMMENT ON VIEW seek_daily_summary IS
    'Daily application counts and scores for monitoring';

COMMENT ON VIEW seek_top_companies IS
    'Companies ranked by application activity';

COMMENT ON VIEW seek_pending_manual_review IS
    'External applications that need manual follow-up';
