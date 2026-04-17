-- Write-capable SQL execution for the AI chatbot
-- Returns affected row count and any RETURNING data

CREATE OR REPLACE FUNCTION exec_write_sql(query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  affected int;
BEGIN
  EXECUTE query;
  GET DIAGNOSTICS affected = ROW_COUNT;
  result := jsonb_build_object('affected_rows', affected);
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION '%', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION exec_write_sql(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION exec_write_sql(text) FROM anon;
REVOKE ALL ON FUNCTION exec_write_sql(text) FROM authenticated;
