/**
 * A SQL column name in camel case: "bpo_as_is" -> "bpoAsIs", "Loan_Model" -> "loanModel".
 */
export function camelCase(column: string): string {
  const pascal = column.split(/[^A-Za-z0-9]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join('');
  return pascal[0].toLowerCase() + pascal.slice(1);
}
