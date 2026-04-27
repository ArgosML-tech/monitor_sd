'use strict';

/**
 * Extracts a simple equality filter value from a CQN where array.
 * Handles: field = 'value'  and  field in ('a','b')
 */
function _scan(where, field) {
  if (!Array.isArray(where)) return null;
  for (let i = 0; i < where.length; i++) {
    const token = where[i];
    // ref can be ['SalesOrder'] or ['SalesOrders','SalesOrder'] — check last segment
    const ref = token?.ref;
    if (!ref) continue;
    if (ref[ref.length - 1] !== field) continue;
    const op  = where[i + 1];
    const val = where[i + 2];
    if (op === '='  && val?.val  !== undefined) return val.val;
    if (op === 'in' && Array.isArray(val?.list)) return val.list.map(x => x.val);
  }
  return null;
}

/**
 * Checks SELECT.where, SELECT.from.ref[0].where (key lookup),
 * and — for OData navigation requests — the parent entity key in from.ref[0].where.
 */
function getFilter(selectClause, field) {
  return _scan(selectClause?.where, field)
      ?? _scan(selectClause?.from?.ref?.[0]?.where, field);
}

/**
 * For navigation requests, searches ALL ref segments in from.ref for keyField.
 * Handles both 2-level (Deliveries('X')/BillingDocuments) and
 * 3-level (SalesOrders('X')/Deliveries('Y')/BillingDocuments) navigation paths.
 */
function getNavParentKey(selectClause, keyField) {
  const fromRef = selectClause?.from?.ref;
  if (!Array.isArray(fromRef) || fromRef.length < 2) return null;
  for (const segment of fromRef) {
    const val = _scan(segment?.where, keyField);
    if (val !== null) return val;
  }
  return null;
}

module.exports = { getFilter, getNavParentKey };
