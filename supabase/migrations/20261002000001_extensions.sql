-- Extensions used by the search layer.
create extension if not exists vector  with schema extensions;  -- embeddings + HNSW
create extension if not exists pg_trgm with schema extensions;  -- typo-tolerant autocomplete
create extension if not exists pg_net  with schema extensions;  -- pg_cron -> Edge Function calls
create extension if not exists pg_cron with schema pg_catalog;  -- embedding sync schedule
