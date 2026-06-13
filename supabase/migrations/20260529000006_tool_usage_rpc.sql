-- RPC called by toolRegistry.ts to track tool usage analytics
-- mavis_tool_registry already exists from earlier migration
CREATE OR REPLACE FUNCTION increment_tool_usage(p_tool_name text)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE mavis_tool_registry
  SET usage_count = coalesce(usage_count, 0) + 1,
      last_used_at = now()
  WHERE name = p_tool_name;
$$;
