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
  local safe_run_id="$(printf '%s' "$run_id" | tr -cd 'a-zA-Z0-9-' | cut -c1-12)"
  local slot
  export CI_SUPABASE_EXCLUDE_SERVICES=""
  case "$job_slug" in
    migration-apply)
      slot=0
      export CI_SUPABASE_EXCLUDE_SERVICES="studio,imgproxy,edge-runtime,logflare,vector,realtime,storage-api"
      ;;
    live-database) slot=1 ;;
    browser-auth-e2e)
      slot=2
      export CI_SUPABASE_EXCLUDE_SERVICES="studio,imgproxy,edge-runtime,logflare,vector,realtime,storage-api"
      ;;
    medication-golden-loop-e2e) slot=3 ;;
    *) slot=9 ;;
  esac
  local project_job="${safe_job:0:10}"
  project_job="${project_job%-}"
  export CI_SUPABASE_PROJECT_ID="medlink-ci-${slot}-${safe_run_id}-${attempt}-${project_job}"
  [[ "${#CI_SUPABASE_PROJECT_ID}" -le 40 ]] || {
    printf 'Supabase project ID exceeds Docker resource limit: %s\n' "$CI_SUPABASE_PROJECT_ID" >&2
    return 1
  }
  [[ "$CI_SUPABASE_PROJECT_ID" =~ [a-zA-Z0-9]$ ]] || {
    printf 'Supabase project ID must end with an alphanumeric character: %s\n' "$CI_SUPABASE_PROJECT_ID" >&2
    return 1
  }
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

ci_supabase_runtime_inventory() {
  local phase="$1"
  command -v docker >/dev/null 2>&1 || return 0
  printf 'CI_SUPABASE_RUNTIME_INVENTORY=%s\n' "$phase"
  docker ps -a --filter "name=${CI_SUPABASE_PROJECT_ID}" --format 'CONTAINER={{.Names}} STATUS={{.Status}}' || true
  docker network ls --filter "name=${CI_SUPABASE_PROJECT_ID}" --format 'NETWORK={{.Name}}' || true
  docker volume ls --filter "name=${CI_SUPABASE_PROJECT_ID}" --format 'VOLUME={{.Name}}' || true
}

ci_supabase_remove_scoped_resources() {
  local resource_kind="$1"
  local resource_id resource_name
  while IFS= read -r resource_id; do
    [[ -n "$resource_id" ]] || continue
    case "$resource_kind" in
      container) resource_name="$(docker inspect --format '{{.Name}}' "$resource_id" 2>/dev/null | sed 's#^/##')" ;;
      network) resource_name="$(docker network inspect --format '{{.Name}}' "$resource_id" 2>/dev/null)" ;;
      volume) resource_name="$(docker volume inspect --format '{{.Name}}' "$resource_id" 2>/dev/null)" ;;
      *) return 1 ;;
    esac
    [[ "$resource_name" == *"$CI_SUPABASE_PROJECT_ID"* ]] || {
      printf 'Refusing to remove non-job %s resource: %s\n' "$resource_kind" "$resource_name" >&2
      return 1
    }
    case "$resource_kind" in
      container) docker rm -f "$resource_id" ;;
      network) docker network rm "$resource_id" ;;
      volume) docker volume rm "$resource_id" ;;
    esac
  done
}

ci_supabase_retry_cleanup() {
  ci_supabase_runtime_inventory BEFORE_RETRY_CLEANUP
  ci_supabase_stop
  command -v docker >/dev/null 2>&1 || return 0
  docker ps -aq --filter "name=${CI_SUPABASE_PROJECT_ID}" | ci_supabase_remove_scoped_resources container
  docker network ls -q --filter "name=${CI_SUPABASE_PROJECT_ID}" | ci_supabase_remove_scoped_resources network
  docker volume ls -q --filter "name=${CI_SUPABASE_PROJECT_ID}" | ci_supabase_remove_scoped_resources volume
  ci_supabase_runtime_inventory AFTER_RETRY_CLEANUP
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
    for name in CI_SUPABASE_PROJECT_ID CI_SUPABASE_WORKDIR CI_SUPABASE_CONFIG_PATH CI_SUPABASE_API_PORT CI_SUPABASE_DB_PORT CI_SUPABASE_STUDIO_PORT CI_SUPABASE_INBUCKET_PORT CI_SUPABASE_SMTP_PORT CI_SUPABASE_POP3_PORT CI_SUPABASE_ANALYTICS_PORT CI_SUPABASE_EXCLUDE_SERVICES; do
      printf '%s=%s\n' "$name" "${!name}" >> "$GITHUB_ENV"
    done
  fi
  local attempt transient_chain=0
  for attempt in 1 2 3; do
    if [[ "$attempt" -eq 1 ]]; then
      ci_supabase_stop
    fi
    local start_output
    local -a start_args=(start --workdir "$CI_SUPABASE_WORKDIR" --yes)
    if [[ -n "$CI_SUPABASE_EXCLUDE_SERVICES" ]]; then
      start_args+=(--exclude "$CI_SUPABASE_EXCLUDE_SERVICES")
    fi
    if start_output="$(npx supabase "${start_args[@]}" 2>&1)"; then
      printf '%s\n' "$start_output"
      if ! ci_supabase_assert_port_parity || ! ci_supabase_assert_schema; then
        return 1
      fi
      return 0
    fi
    printf '%s\n' "$start_output" >&2
    if printf '%s\n' "$start_output" | grep -Eqi 'toomanyrequests|429|rate exceeded|temporar(y|ily)|timeout|timed out|connection reset|network|pull.*(fail|error)'; then
      transient_chain=1
    elif [[ "$transient_chain" -eq 1 ]] && printf '%s\n' "$start_output" | grep -Eqi 'starting database|initialising schema|initializing schema|error running container'; then
      printf 'CI_SUPABASE_TRANSIENT_CHAIN=partial initialization after registry/network failure\n' >&2
    else
      return 1
    fi
    if [[ "$attempt" -eq 3 ]]; then
      return 1
    fi
    ci_supabase_retry_cleanup
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
