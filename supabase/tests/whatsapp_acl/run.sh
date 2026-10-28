#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
container_name="oryneo-wa-acl-test-$$"
trap 'docker rm -f "$container_name" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$container_name" -e POSTGRES_PASSWORD=local-only postgres:17 >/dev/null
for attempt in {1..30}; do
  if docker exec "$container_name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container_name" pg_isready -U postgres >/dev/null

for file in \
  "$repo_root/supabase/tests/whatsapp_acl/setup.sql" \
  "$repo_root/supabase/migrations/20261024012010_crm_whatsapp_webhook_inbox.sql" \
  "$repo_root/supabase/migrations/20261026174004_crm_whatsapp_inbox_read_model.sql" \
  "$repo_root/supabase/migrations/20261027003453_crm_whatsapp_delivery_and_unread.sql" \
  "$repo_root/supabase/migrations/20261027003948_crm_whatsapp_read_race_fix.sql" \
  "$repo_root/supabase/tests/whatsapp_acl/pre.sql" \
  "$repo_root/supabase/migrations/20261027184432_crm_whatsapp_acl.sql" \
  "$repo_root/supabase/tests/whatsapp_acl/assert.sql" \
  "$repo_root/supabase/tests/whatsapp_acl/assert_more.sql"; do
  docker exec -i "$container_name" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres < "$file"
done
for file in \
  "$repo_root/supabase/migrations/20261027190050_crm_whatsapp_assignment.sql" \
  "$repo_root/supabase/migrations/20261027234834_whatsapp_outbox_operator_index.sql" \
  "$repo_root/supabase/migrations/20261028002546_whatsapp_rich_interactions.sql" \
  "$repo_root/supabase/tests/whatsapp_acl/assert_assignment.sql" \
  "$repo_root/supabase/tests/whatsapp_acl/assert_rich_interactions.sql"; do
  docker exec -i "$container_name" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres < "$file"
done
printf 'WhatsApp ACL: tests passed\n'
