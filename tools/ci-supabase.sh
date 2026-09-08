#!/usr/bin/env bash
set -euo pipefail

# Each GitHub job gets an isolated Supabase config and port range. The CLI has
# no direct port flags, so the generated workdir is the supported boundary.
ci_supabase_identity() {
  [[ -n "${CI_SUPABASE_WORKDIR:-}" ]] && return 0
  local job_slug="${GITHUB_JOB:-local}"
  local run_id="${GITHUB_RUN_ID:-local}"
  local attempt="${GITHUB_RUN_ATTEMPT:-1}"
  local safe_job="$(printf '%s' "$job_slug" | tr '[:upper:]_' '[:lower:]-' | tr -cd 'a-z0-9-' | cut -c1-32)"
  local slot
  case "$job_slug" in
    migration-apply) slot=0 ;;
    live-database) slot=1 ;;
    browser-auth-e2e) slot=2 ;;
    medication-golden-loop-e2e) slot=3 ;;
    *) slot=9 ;;
  esac
  export CI_SUPABASE_PROJECT_ID="medlink-ci-${safe_job}-${run_id}-${attempt}"
  export CI_SUPABASE_WORKDIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/supabase-${safe_job}-${run_id}-${attempt}"
  export CI_SUPABASE_CONFIG_PATH="$CI_SUPABASE_WORKDIR/supabase/config.toml"
  export CI_SUPABASE_API_PORT=$((54321 + slot * 10))
  export CI_SUPABASE_DB_PORT=$((54322 + slot * 10))
  export CI_SUPABASE_STUDIO_PORT=$((54323 + slot * 10))
  export CI_SUPABASE_INBUCKET_PORT=$((54324 + slot * 10))
  export CI_SUPABASE_SMTP_PORT=$((54325 + slot * 10))
  export CI_SUPABASE_POP3_PORT=$((54326 + slot * 10))
  export CI_SUPABASE_ANALYTICS_PORT=$((54327 + slot * 10))
}

ci_supabase_prepare() {
  ci_supabase_identity

  rm -rf "$CI_SUPABASE_WORKDIR"
  mkdir -p "$CI_SUPABASE_WORKDIR/supabase"
  cp -R supabase/. "$CI_SUPABASE_WORKDIR/supabase/"
  test -f "$CI_SUPABASE_CONFIG_PATH"
  test -d "$CI_SUPABASE_WORKDIR/supabase/migrations"
  CI_SUPABASE_PROJECT_ID="$CI_SUPABASE_PROJECT_ID" \
  CI_SUPABASE_API_PORT="$CI_SUPABASE_API_PORT" \
  CI_SUPABASE_DB_PORT="$CI_SUPABASE_DB_PORT" \
  CI_SUPABASE_STUDIO_PORT="$CI_SUPABASE_STUDIO_PORT" \
  CI_SUPABASE_INBUCKET_PORT="$CI_SUPABASE_INBUCKET_PORT" \
  CI_SUPABASE_SMTP_PORT="$CI_SUPABASE_SMTP_PORT" \
  CI_SUPABASE_POP3_PORT="$CI_SUPABASE_POP3_PORT" \
  CI_SUPABASE_ANALYTICS_PORT="$CI_SUPABASE_ANALYTICS_PORT" \
  node tools/write-ci-supabase-config.mjs "$CI_SUPABASE_CONFIG_PATH"
  printf 'CONFIG_PATH=%s\nPROJECT_ID=%s\nAPI_PORT=%s\nDB_PORT=%s\nSTUDIO_PORT=%s\nMAIL_PORT=%s\n' \
    "$CI_SUPABASE_CONFIG_PATH" "$CI_SUPABASE_PROJECT_ID" "$CI_SUPABASE_API_PORT" \
    "$CI_SUPABASE_DB_PORT" "$CI_SUPABASE_STUDIO_PORT" "$CI_SUPABASE_INBUCKET_PORT"
}

ci_supabase_stop() {
  if [[ -n "${CI_SUPABASE_WORKDIR:-}" ]]; then
    npx supabase stop --workdir "$CI_SUPABASE_WORKDIR" --project-id "${CI_SUPABASE_PROJECT_ID:-}" --no-backup || true
  fi
}

ci_supabase_cleanup() {
  ci_supabase_stop
  case "${CI_SUPABASE_WORKDIR:-}" in
    */supabase-*) rm -rf "$CI_SUPABASE_WORKDIR" ;;
    *) printf 'Refusing to clean unexpected Supabase workdir: %s\n' "${CI_SUPABASE_WORKDIR:-<unset>}" >&2; return 1 ;;
  esac
}

ci_supabase_env_value() {
  local name="$1"
  local input="$2"
  printf '%s\n' "$input" | sed -n "s/^${name}=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" | tail -n 1
}

ci_supabase_assert_port_parity() {
  local status api_url db_url mail_url
  status="$(npx supabase status --workdir "$CI_SUPABASE_WORKDIR" -o env)"
  api_url="$(ci_supabase_env_value API_URL "$status")"
  db_url="$(ci_supabase_env_value DB_URL "$status")"
  mail_url="$(ci_supabase_env_value INBUCKET_URL "$status")"
  [[ "$api_url" == *":${CI_SUPABASE_API_PORT}"* ]] || { printf 'Supabase API port mismatch (expected %s).\n' "$CI_SUPABASE_API_PORT" >&2; return 1; }
  [[ "$db_url" == *":${CI_SUPABASE_DB_PORT}"* ]] || { printf 'Supabase DB port mismatch (expected %s).\n' "$CI_SUPABASE_DB_PORT" >&2; return 1; }
  [[ "$mail_url" == *":${CI_SUPABASE_INBUCKET_PORT}"* ]] || { printf 'Supabase Mailpit port mismatch (expected %s).\n' "$CI_SUPABASE_INBUCKET_PORT" >&2; return 1; }
  printf 'CI_SUPABASE_PORT_PARITY=PASS\n'
}

ci_supabase_assert_schema() {
  local schema_dump
  schema_dump="$(mktemp)"
  if ! npx supabase db dump --workdir "$CI_SUPABASE_WORKDIR" --local --schema public --file "$schema_dump"; then
    rm -f "$schema_dump"
    return 1
  fi
  for object in organizations organization_memberships runtime_outbox_events; do
    grep -Eq "CREATE TABLE( IF NOT EXISTS)? (\"public\"\.)?\"?${object}\"?" "$schema_dump" || { printf 'Missing canonical table: public.%s\n' "$object" >&2; rm -f "$schema_dump"; return 1; }
  done
  for function_name in certify_pharmacy_catalog_fixture certify_reservation_concurrency_fixture certify_reservation_fulfillment_fixture certify_medicine_identity_guard_fixture; do
    grep -Eq "CREATE( OR REPLACE)? FUNCTION (\"public\"\.)?\"?${function_name}\"?" "$schema_dump" || { printf 'Missing fixture function: public.%s\n' "$function_name" >&2; rm -f "$schema_dump"; return 1; }
  done
  rm -f "$schema_dump"
  printf 'MIGRATIONS_APPLIED=YES\nCANONICAL_TABLES_PRESENT=YES\n'
}

ci_supabase_start() {
  ci_supabase_prepare
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    for name in CI_SUPABASE_PROJECT_ID CI_SUPABASE_WORKDIR CI_SUPABASE_CONFIG_PATH CI_SUPABASE_API_PORT CI_SUPABASE_DB_PORT CI_SUPABASE_STUDIO_PORT CI_SUPABASE_INBUCKET_PORT CI_SUPABASE_SMTP_PORT CI_SUPABASE_POP3_PORT CI_SUPABASE_ANALYTICS_PORT; do
      printf '%s=%s\n' "$name" "${!name}" >> "$GITHUB_ENV"
    done
  fi
  local attempt
  for attempt in 1 2 3; do
    ci_supabase_stop
    local start_output
    if start_output="$(npx supabase start --workdir "$CI_SUPABASE_WORKDIR" --yes 2>&1)"; then
      printf '%s\n' "$start_output"
      if ! ci_supabase_assert_port_parity || ! ci_supabase_assert_schema; then
        return 1
      fi
      return 0
    fi
    printf '%s\n' "$start_output" >&2
    if ! printf '%s\n' "$start_output" | grep -Eqi 'toomanyrequests|429|rate exceeded|temporar(y|ily)|timeout|timed out|connection reset|network|pull.*(fail|error)'; then
      return 1
    fi
    if [[ "$attempt" -eq 3 ]]; then
      return 1
    fi
    sleep $((attempt * 5))
  done
}

ci_supabase_reset() {
  ci_supabase_identity
  npx supabase db reset --workdir "$CI_SUPABASE_WORKDIR" --yes
  ci_supabase_assert_port_parity
  ci_supabase_assert_schema
}

ci_supabase_status() {
  ci_supabase_identity
  npx supabase status --workdir "$CI_SUPABASE_WORKDIR" -o env
}
