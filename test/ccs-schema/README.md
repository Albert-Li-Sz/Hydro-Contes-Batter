Official ICPC CCS Contest API 2026-01 JSON schemas, copied unchanged from
https://github.com/icpc/ccs-specs/tree/cfeceec14783a9dafc24ad15369afaa767423f5f/json-schema
(branch 2026-01). These are test fixtures only. Their canonical $id URLs still contain master,
as supplied by upstream; tests register all schemas locally and never resolve master over the network.

The tests relax only unconditional `required` entries for run wall-clock timestamps (unavailable
in Hydro) and source files (hidden from other teams/public). Schema files themselves are unchanged.
Historical judgement start timestamps may also be absent when Hydro and the monitor have no
observation. These are documented data/visibility omissions, not a claim that every response
passes the unmodified upstream checker, which does not consult `access` for these requirements.
