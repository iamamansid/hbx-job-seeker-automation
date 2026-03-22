CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS seek_job_updated_at ON seek_job;
CREATE TRIGGER seek_job_updated_at
    BEFORE UPDATE ON seek_job
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS seek_browser_session_updated_at ON seek_browser_session;
CREATE TRIGGER seek_browser_session_updated_at
    BEFORE UPDATE ON seek_browser_session
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
