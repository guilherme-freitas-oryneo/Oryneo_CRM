#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
container_name="oryneo-refund-test-$$"
trap 'docker rm -f "$container_name" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$container_name" -e POSTGRES_PASSWORD=local-only postgres:17 >/dev/null
for attempt in {1..30}; do docker exec "$container_name" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
for file in \
  "$repo_root/supabase/tests/billing_refund/setup.sql" \
  "$repo_root/supabase/migrations/20261013181000_crm_stripe_billing.sql" \
  "$repo_root/supabase/migrations/20261018190000_crm_billing_environment.sql" \
  "$repo_root/supabase/migrations/20261028002952_crm_stripe_refund_reconciliation.sql" \
  "$repo_root/supabase/tests/billing_refund/assert.sql"; do
  docker exec -i "$container_name" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres < "$file"
done
printf 'Stripe refund reconciliation: tests passed\n'
