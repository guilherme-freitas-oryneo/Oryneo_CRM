/**
 * ORYNEO condition DSL: deterministic, JSON-only, three-valued evaluation.
 * No user-provided JS/SQL, and missing inputs never become implicit truth.
 * The server must independently authorize context fields and actions.
 */
export type Scalar = string | number | boolean | null;
export type FieldName =
  | 'opportunity.intent' | 'opportunity.stage_id' | 'opportunity.source'
  | 'opportunity.plan' | 'opportunity.cycle'
  | 'conversation.mode' | 'conversation.opted_out' | 'conversation.consent_granted'
  | 'billing.status' | 'billing.paid_verified' | 'lead.intent' | 'event.type';
export type Rule =
  | { kind: 'compare'; field: FieldName; op: 'eq' | 'neq'; value: Scalar }
  | { kind: 'one_of'; field: FieldName; values: Scalar[] }
  | { kind: 'exists'; field: FieldName }
  | { kind: 'group'; op: 'all' | 'any'; rules: Rule[] };
export type RuleOutcome = true | false | 'unknown';
export type RuleIssue = { code: string; path: string };
export type RuleResult = { ok: boolean; issues: RuleIssue[] };

export const RULE_FIELDS: readonly FieldName[] = [
  'opportunity.intent', 'opportunity.stage_id', 'opportunity.source',
  'opportunity.plan', 'opportunity.cycle', 'conversation.mode',
  'conversation.opted_out', 'conversation.consent_granted',
  'billing.status', 'billing.paid_verified', 'lead.intent', 'event.type',
] as const;

const fieldSet = new Set<string>(RULE_FIELDS);
const own = (obj: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const scalar = (value: unknown): value is Scalar =>
  value === null || typeof value === 'string' || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value));

/** Validate untrusted JSON without recursively executing arbitrary properties. */
export function validateRule(value: unknown): RuleResult {
  const issues: RuleIssue[] = [];
  let total = 0;
  const add = (code: string, path: string) => issues.push({ code, path });
  function visit(item: unknown, path: string, depth: number): void {
    total++;
    if (total > 64) { add('RULE_TOO_LARGE', path); return; }
    if (depth > 8) { add('RULE_TOO_DEEP', path); return; }
    if (!isRecord(item)) { add('RULE_INVALID', path); return; }
    if (item.kind === 'group') {
      if (!['all', 'any'].includes(String(item.op)) || !Array.isArray(item.rules)
        || !item.rules.length || item.rules.length > 32
        || Object.keys(item).some(key => !['kind', 'op', 'rules'].includes(key))) {
        add('RULE_GROUP_INVALID', path);
        return;
      }
      item.rules.forEach((child, index) => visit(child, path + '.rules[' + index + ']', depth + 1));
      return;
    }
    if (!fieldSet.has(String(item.field))) { add('RULE_FIELD_UNKNOWN', path + '.field'); return; }
    const allowed = item.kind === 'compare' ? ['kind', 'field', 'op', 'value']
      : item.kind === 'one_of' ? ['kind', 'field', 'values']
        : item.kind === 'exists' ? ['kind', 'field'] : [];
    if (!allowed.length || Object.keys(item).some(key => !allowed.includes(key))) {
      add('RULE_KEYS_INVALID', path);
      return;
    }
    if (item.kind === 'compare' && (!['eq', 'neq'].includes(String(item.op))
      || !own(item, 'value') || !scalar(item.value))) add('RULE_COMPARISON_INVALID', path);
    if (item.kind === 'one_of' && (!Array.isArray(item.values)
      || !item.values.length || item.values.length > 32 || !item.values.every(scalar))) {
      add('RULE_VALUES_INVALID', path);
    }
  }
  visit(value, '$', 0);
  return { ok: issues.length === 0, issues };
}

function getContextValue(context: Record<string, unknown>, field: FieldName):
  { present: boolean; value?: unknown } {
  const parts = field.split('.');
  let cursor: unknown = context;
  for (const part of parts) {
    if (!isRecord(cursor) || !own(cursor, part)) return { present: false };
    cursor = cursor[part];
  }
  return { present: true, value: cursor };
}

/** Fail closed: invalid rules or absent context return unknown, never a false assertion. */
export function evaluateRule(rule: unknown, context: Record<string, unknown>): RuleOutcome {
  if (!validateRule(rule).ok) return 'unknown';
  function evaluate(item: Rule): RuleOutcome {
    if (item.kind === 'group') {
      const outcomes = item.rules.map(evaluate);
      if (item.op === 'all') {
        if (outcomes.includes(false)) return false;
        return outcomes.includes('unknown') ? 'unknown' : true;
      }
      if (outcomes.includes(true)) return true;
      return outcomes.includes('unknown') ? 'unknown' : false;
    }
    const { present, value } = getContextValue(context, item.field);
    if (item.kind === 'exists') return present;
    if (!present || !scalar(value)) return 'unknown';
    if (item.kind === 'one_of') return item.values.some(option => option === value);
    const equal = item.value === value;
    return item.op === 'eq' ? equal : !equal;
  }
  return evaluate(rule as Rule);
}
