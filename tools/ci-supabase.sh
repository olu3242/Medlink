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
  mkdir -p "$CI_SUPABASE_WORKDIR"
  cp -R supabase/. "$CI_SUPABASE_WORKDIR/"
  CI_SUPABASE_PROJECT_ID="$CI_SUPABASE_PROJECT_ID" \
  CI_SUPABASE_API_PORT="$CI_SUPABASE_API_PORT" \
  CI_SUPABASE_DB_PORT="$CI_SUPABASE_DB_PORT" \
  CI_SUPABASE_STUDIO_PORT="$CI_SUPABASE_STUDIO_PORT" \
  CI_SUPABASE_INBUCKET_PORT="$CI_SUPABASE_INBUCKET_PORT" \
  CI_SUPABASE_SMTP_PORT="$CI_SUPABASE_SMTP_PORT" \
  CI_SUPABASE_POP3_PORT="$CI_SUPABASE_POP3_PORT" \
  CI_SUPABASE_ANALYTICS_PORT="$CI_SUPABASE_ANALYTICS_PORT" \
  node tools/write-ci-supabase-config.mjs "$CI_SUPABASE_WORKDIR/config.toml"
}

ci_supabase_stop() {
  if [[ -n "${CI_SUPABASE_WORKDIR:-}" ]]; then
    npx supabase stop --workdir "$CI_SUPABASE_WORKDIR" --project-id "${CI_SUPABASE_PROJECT_ID:-}" --no-backup || true
  fi
}

ci_supabase_cleanup() {
  ci_supabase_stop
  rm -rf "${CI_SUPABASE_WORKDIR:-}"
}

ci_supabase_start() {
  ci_supabase_prepare
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    for name in CI_SUPABASE_PROJECT_ID CI_SUPABASE_WORKDIR CI_SUPABASE_API_PORT CI_SUPABASE_DB_PORT CI_SUPABASE_STUDIO_PORT CI_SUPABASE_INBUCKET_PORT CI_SUPABASE_SMTP_PORT CI_SUPABASE_POP3_PORT CI_SUPABASE_ANALYTICS_PORT; do
      printf '%s=%s\n' "$name" "${!name}" >> "$GITHUB_ENV"
    done
  fi
  local attempt
  for attempt in 1 2 3; do
    ci_supabase_stop
    if npx supabase start --workdir "$CI_SUPABASE_WORKDIR" --yes; then
      return 0
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
}

ci_supabase_status() {
  ci_supabase_identity
  npx supabase status --workdir "$CI_SUPABASE_WORKDIR" -o env
}
