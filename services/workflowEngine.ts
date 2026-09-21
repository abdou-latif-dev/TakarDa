// Minimal Core workflow primitives — trigger → optional condition → matching
// rules. Deliberately does NOT execute WorkflowAction[] yet: no domain module
// needs it in this step (Factures has no workflow rules), and interpreting
// 'createRecord'/'adjustRelatedField' correctly requires domain context that
// belongs in a domain service, not here. This file only answers "which rules
// apply right now?" — a real execution runner is future work once a module
// actually needs one (see architecture report, §15/§18).

import type { ConditionExpr, FieldValue, WorkflowRule } from '@/types/entities';

export function evaluateCondition(expr: ConditionExpr, values: Record<string, FieldValue>): boolean {
  if ('all' in expr) return expr.all.every((e) => evaluateCondition(e, values));
  if ('any' in expr) return expr.any.some((e) => evaluateCondition(e, values));

  const actual = values[expr.field];
  switch (expr.op) {
    case 'eq':
      return actual === expr.value;
    case 'neq':
      return actual !== expr.value;
    case 'gt':
      return typeof actual === 'number' && typeof expr.value === 'number' && actual > expr.value;
    case 'lt':
      return typeof actual === 'number' && typeof expr.value === 'number' && actual < expr.value;
    case 'gte':
      return typeof actual === 'number' && typeof expr.value === 'number' && actual >= expr.value;
    case 'lte':
      return typeof actual === 'number' && typeof expr.value === 'number' && actual <= expr.value;
    case 'isEmpty':
      return actual === null || actual === undefined || actual === '' || (Array.isArray(actual) && actual.length === 0);
    case 'isNotEmpty':
      return !(actual === null || actual === undefined || actual === '' || (Array.isArray(actual) && actual.length === 0));
    default:
      return false;
  }
}

export function matchingRules(
  rules: WorkflowRule[],
  toolId: string,
  entityDefinitionId: string,
  trigger: WorkflowRule['trigger'],
  values: Record<string, FieldValue>,
): WorkflowRule[] {
  return rules.filter(
    (rule) =>
      rule.toolId === toolId &&
      rule.entityDefinitionId === entityDefinitionId &&
      rule.trigger === trigger &&
      (!rule.when || evaluateCondition(rule.when, values)),
  );
}
