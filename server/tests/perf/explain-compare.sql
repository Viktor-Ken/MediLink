\pset pager off
\timing on
\echo '=== index present? ==='
SELECT indexname FROM pg_indexes WHERE tablename = 'patients';
\echo '=== WITH index (current plan) ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT id, patient_no, first_name, last_name, dob::text AS dob FROM patients ORDER BY created_at DESC LIMIT 100;
\echo '=== index forced off (models pre-index plan) ==='
SET enable_indexscan = off;
SET enable_bitmapscan = off;
EXPLAIN (ANALYZE, BUFFERS) SELECT id, patient_no, first_name, last_name, dob::text AS dob FROM patients ORDER BY created_at DESC LIMIT 100;
RESET enable_indexscan;
RESET enable_bitmapscan;
\echo '=== WITH index again (repeat for stability) ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT id, patient_no, first_name, last_name, dob::text AS dob FROM patients ORDER BY created_at DESC LIMIT 100;
