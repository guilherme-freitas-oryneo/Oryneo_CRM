import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('permissões internas da cobrança', () => {
  it('permite que a service role valide membros do CRM', () => {
    const migrations = readdirSync(`${root}/supabase/migrations`)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => readFileSync(`${root}/supabase/migrations/${name}`, 'utf8'))
      .join('\n');

    expect(migrations).toMatch(
      /grant\s+select\s+on(?:\s+table)?\s+public\.crm_members\s+to\s+service_role/i,
    );
  });

  it('não confunde falha de banco com usuário sem acesso', () => {
    const source = readFileSync(
      `${root}/supabase/functions/billing-create-order/index.ts`,
      'utf8',
    );

    expect(source).toMatch(/error:\s*memberError/);
    expect(source).toMatch(/if\s*\(memberError\).*503/s);
  });
});
