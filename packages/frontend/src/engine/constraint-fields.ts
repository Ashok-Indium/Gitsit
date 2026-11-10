// The model constants people set per input file on the Constraints page and in the SQL table
// Constraints.BPL_Constraints. `index` is the field's Field_Index there (the lakehouse field name
// of the earlier constants table); `cell` is the Model-sheet cell the value goes into. Groups and
// their order follow that constants table.

import { colNum, parseAddress } from './formula-text.ts';
import type { Constants } from './protocol.ts';
import type { Cell } from './rewrite.ts';

export type ConstraintKind = 'pct' | 'number' | 'date';

export interface ConstraintField {
  index: string;
  display: string;
  /** Model cell the value is written into. */
  cell: string;
  group: string;
  /** Position within the group. */
  order: number;
  /** pct: stored as a fraction (0.7) and shown and typed as a percentage (70). */
  kind: ConstraintKind;
  /**
   * A value the workbook types into a column's formulas rather than a cell: the engine points those
   * formulas at `cell` (an empty cell above the column) so the value can be changed.
   */
  literal?: { col: string; find: string; value: number };
}

export const CONSTRAINT_GROUPS = [
  'Fade', 'BPL Rehab', 'Hurdle', 'GNMA DCF', 'Custom DCF', 'Maturing DCF', 'Mod-Plan-RI', 'NPL DCF', 'Payoff DCF',
  'Perf', 'Perf DCF', 'REO DCF', 'Servicing Fees', 'TA Fees', 'General', 'Value Band', 'GNMA Pool DCF', 'Yield & Gain',
] as const;

type Row = [index: string, display: string, cell: string, group: (typeof CONSTRAINT_GROUPS)[number], order: number, kind: ConstraintKind];

// In the order of the field list the table was specified with.
const ROWS: Row[] = [
  ['U1', 'Advances Factor', 'U1', 'General', 1, 'pct'],
  // GJ9 is the average of the loans' as-of dates; every loan's date comes from GJ1 (asofdate).
  ['GJ9', 'AsOfDate', 'GJ1', 'General', 2, 'date'],
  ['afq7', 'REO_FCL Exp Cost $ - High', 'AFQ7', 'REO DCF', 6, 'number'],
  ['ait7', 'NPL Timeline Mths (Integer)', 'AIT7', 'NPL DCF', 9, 'number'],
  ['aiu7', 'NPL_Return Additional (Decimal)', 'AIU7', 'NPL DCF', 10, 'number'],
  ['aiy8', 'NPL_Capex Factor %', 'AIY8', 'NPL DCF', 11, 'pct'],
  ['ala7', 'Custom_Exit Faded  Factor %', 'ALA7', 'Custom DCF', 4, 'pct'],
  ['ala8', 'Custom_Exit DTV Factor (Decimal)', 'ALA8', 'Custom DCF', 5, 'number'],
  ['alb7', 'Custom_Capex Faded Factor %', 'ALB7', 'Custom DCF', 6, 'pct'],
  ['alb8', 'Custom_Capex DTV Factor (Decimal)', 'ALB8', 'Custom DCF', 7, 'number'],
  ['alc7', 'Custom Timeline Mths (Integer)', 'ALC7', 'Custom DCF', 8, 'number'],
  ['ald7', 'Custom_Return Additional %', 'ALD7', 'Custom DCF', 9, 'pct'],
  ['ank7', 'Maturing_Exit Faded  Factor %', 'ANK7', 'Maturing DCF', 3, 'pct'],
  ['afq8', 'REO_FCL Exp Cost $ - Low', 'AFQ8', 'REO DCF', 7, 'number'],
  ['ank8', 'Maturing_Exit DTV Factor (Decimal)', 'ANK8', 'Maturing DCF', 4, 'number'],
  ['anl7', 'Maturing_Capex Faded Factor %', 'ANL7', 'Maturing DCF', 5, 'pct'],
  ['anl8', 'Maturing_Capex DTV Factor (Decimal)', 'ANL8', 'Maturing DCF', 6, 'number'],
  ['anm7', 'Maturing Timeline Mths (Integer)', 'ANM7', 'Maturing DCF', 7, 'number'],
  ['anp1', 'Maturing_Bid Value Cap %', 'ANP1', 'Maturing DCF', 9, 'pct'],
  ['anp2', 'Maturing_Bid Low Cap %', 'ANP2', 'Maturing DCF', 10, 'pct'],
  ['anp3', 'Maturing_Bid UPB Cap %', 'ANP3', 'Maturing DCF', 11, 'pct'],
  ['aqg7', 'GNMA POOL Timeline Mths (Integer)', 'AQG7', 'GNMA Pool DCF', 1, 'number'],
  ['aqh7', 'GNMA POOL_Return Additional %', 'AQH7', 'GNMA Pool DCF', 2, 'pct'],
  ['ass7', 'GNMA Claim_Return Additional %', 'ASS7', 'GNMA DCF', 3, 'pct'],
  ['afy7', 'REO_Closing Exp Proceeds Factor %', 'AFY7', 'REO DCF', 8, 'pct'],
  ['bgs8', 'Constant30', 'BGS8', 'Yield & Gain', 1, 'pct'],
  ['bhd8', 'Constant31', 'BHD8', 'Yield & Gain', 2, 'pct'],
  ['ann7', 'Maturing_Return Additional %', 'ANN7', 'Maturing DCF', 8, 'pct'],
  ['adn8', 'Payoff_Capex Faded Factor %', 'ADN8', 'Payoff DCF', 10, 'pct'],
  ['abe5', 'Perf_UPB_Cap Additional %', 'ABE5', 'Perf DCF', 6, 'pct'],
  ['nc1', 'FICO Eligible (Integer)', 'NC1', 'Mod-Plan-RI', 20, 'number'],
  ['afr7', 'REO_PPRES Exp $ - High', 'AFR7', 'REO DCF', 10, 'number'],
  ['afr8', 'REO_PPRES Exp $ - Low', 'AFR8', 'REO DCF', 11, 'number'],
  ['afy8', 'REO_Closing Exp Additional $', 'AFY8', 'REO DCF', 9, 'number'],
  ['aim7', 'NPL_FCL Exp Cost $ - High', 'AIM7', 'NPL DCF', 4, 'number'],
  ['aim8', 'NPL_FCL Exp Low Cost $ - Low', 'AIM8', 'NPL DCF', 5, 'number'],
  ['ain7', 'NPL_PPRES Exp $', 'AIN7', 'NPL DCF', 6, 'number'],
  ['aip7', 'NPL_Exit Factor % - Low', 'AIP7', 'NPL DCF', 7, 'pct'],
  ['aip8', 'NPL_Exit Factor % - High', 'AIP8', 'NPL DCF', 8, 'pct'],
  ['down_pmt_%_of_current_ri_(dq1)', 'Down Pmt % of Current RI (DQ1)', 'PC3', 'Mod-Plan-RI', 5, 'pct'],
  ['down_pmt_%_of_current_ri_(dq2)', 'Down Pmt % of Current RI (DQ2)', 'PC4', 'Mod-Plan-RI', 6, 'pct'],
  ['down_pmt_%_of_current_ri_(dq3)', 'Down Pmt % of Current RI (DQ3)', 'PC5', 'Mod-Plan-RI', 7, 'pct'],
  ['dq1_max_months', 'DQ1 Max Months', 'PD3', 'Mod-Plan-RI', 8, 'number'],
  ['dq2_max_months', 'DQ2 Max Months', 'PD4', 'Mod-Plan-RI', 9, 'number'],
  ['fade_adj_all', 'fade_adj_all', 'AJ1', 'Fade', 5, 'pct'],
  ['fade_adj_payer', 'fade_adj_payer', 'AI1', 'Fade', 4, 'pct'],
  ['fade_adj_stale', 'fade_adj_stale', 'AH1', 'Fade', 3, 'pct'],
  ['fade_adj_type', 'Fade_Adj_Type', 'AG1', 'Fade', 2, 'pct'],
  ['fade_stale_months', 'fade_stale_months', 'AB1', 'Fade', 1, 'number'],
  ['gnma_claim_months', 'GNMA Claim Months', 'ASR7', 'GNMA DCF', 2, 'number'],
  ['high_prop_value_min', 'High Prop Value Min', 'EQ1', 'Value Band', 2, 'number'],
  ['hud_debenture_rate', 'HUD_debenture_rate', 'ASO1', 'GNMA DCF', 1, 'pct'],
  ['hurdle_npl', 'hurdle_NPL', 'CC1', 'Hurdle', 1, 'number'],
  ['hurdle_pl', 'hurdle_PL', 'CD1', 'Hurdle', 2, 'number'],
  ['inct_npl', 'inct_NPL', 'CO1', 'Servicing Fees', 3, 'pct'],
  ['inct_perf', 'inct_perf', 'CO2', 'Servicing Fees', 6, 'pct'],
  ['inct_ta', 'inct_TA', 'CT1', 'TA Fees', 2, 'pct'],
  ['low_cap', 'low cap', 'ALF2', 'Custom DCF', 2, 'pct'],
  ['low_prop_value_max', 'Low Prop Value Max', 'EP1', 'Value Band', 1, 'number'],
  ['ltv_floor_for_pay_plan', 'LTV Floor for Pay Plan', 'QG3', 'Mod-Plan-RI', 17, 'number'],
  ['maturing_perf_payoff_months_delay', 'Maturing Perf Payoff Months Delay', 'ANJ7', 'Maturing DCF', 2, 'number'],
  ['mgmt_npl', 'mgmt_NPL', 'CN1', 'Servicing Fees', 2, 'pct'],
  ['mgmt_perf', 'mgmt_perf', 'CN2', 'Servicing Fees', 5, 'pct'],
  ['mgmt_ta', 'mgmt_TA', 'CS1', 'TA Fees', 1, 'pct'],
  ['min_p&i_change_for_pay_plan', 'Min P&I Change for Pay Plan', 'QG4', 'Mod-Plan-RI', 18, 'number'],
  ['mod_maturity_max_term', 'Mod Maturity Max Term', 'NI5', 'Mod-Plan-RI', 3, 'number'],
  ['mod_upb_%_of_current_payoff', 'Mod UPB % of Current Payoff', 'ND1', 'Mod-Plan-RI', 2, 'pct'],
  ['mod_min_ltv', 'mod_min_LTV', 'NA1', 'Mod-Plan-RI', 1, 'number'],
  ['monthly_npl', 'monthly_NPL', 'CM1', 'Servicing Fees', 1, 'number'],
  ['monthly_perf', 'monthly_perf', 'CM2', 'Servicing Fees', 4, 'number'],
  ['months_dq_floor_for_pay_plan', 'Months DQ Floor for Pay Plan', 'QG1', 'Mod-Plan-RI', 15, 'number'],
  ['months_dq_max_for_ri', 'Months DQ Max for RI', 'QG2', 'Mod-Plan-RI', 16, 'number'],
  ['npl_bidcap_upb', 'NPL bidcap_UPB', 'AJG5', 'NPL DCF', 1, 'pct'],
  ['npl_cv_bidcap_adjust', 'NPL CV bidcap adjust', 'AJH4', 'NPL DCF', 2, 'pct'],
  ['npl_low_value_cv_bidcap_adjust', 'NPL Low Value CV bidcap adjust', 'AJH5', 'NPL DCF', 3, 'pct'],
  ['pay_plan_#_months_(active_fcl)', 'Pay Plan # Months (Active FCL)', 'PG5', 'Mod-Plan-RI', 11, 'number'],
  ['pay_plan_down_payment_month', 'Pay Plan Down Payment Month', 'PE5', 'Mod-Plan-RI', 10, 'number'],
  ['pay_plan_maturity_max_term', 'Pay Plan Maturity Max Term', 'PO5', 'Mod-Plan-RI', 14, 'number'],
  ['pay_plan_p&i_%_increase', 'Pay Plan P&I % Increase', 'PH5', 'Mod-Plan-RI', 12, 'pct'],
  ['pay_plan_upb_%_increase', 'Pay Plan UPB % Increase', 'PJ5', 'Mod-Plan-RI', 13, 'pct'],
  ['payoff_bidcap_po', 'Payoff bidcap_PO', 'ADV5', 'Payoff DCF', 6, 'pct'],
  ['payoff_cv_bidcap_adjust', 'Payoff CV bidcap adjust', 'ADW4', 'Payoff DCF', 8, 'pct'],
  ['payoff_fcl_expense_judicial', 'Payoff FCL Expense Judicial', 'ACZ7', 'Payoff DCF', 1, 'number'],
  ['payoff_fcl_expense_non_jdcl', 'Payoff FCL Expense Non-Jdcl', 'ACZ8', 'Payoff DCF', 2, 'number'],
  ['payoff_high_value_cv_bidcap_adjust', 'Payoff High Value CV bidcap adjust', 'ADW3', 'Payoff DCF', 7, 'pct'],
  ['payoff_low_value_cv_bidcap_adjust', 'Payoff Low Value CV bidcap adjust', 'ADW5', 'Payoff DCF', 9, 'pct'],
  ['payoff_prop_pres_expense', 'Payoff Prop Pres Expense', 'ADA7', 'Payoff DCF', 3, 'number'],
  ['payoff_bidcap_cv', 'Payoff_bidcap_CV', 'ADW2', 'Payoff DCF', 5, 'pct'],
  ['payoff_bidcap_lowvalue', 'Payoff_bidcap_lowvalue', 'ADW1', 'Payoff DCF', 4, 'pct'],
  ['perf_cv_bidcap_adjust', 'Perf CV bidcap adjust', 'ABF4', 'Perf DCF', 4, 'pct'],
  ['perf_high_value_cv_bidcap_adjust', 'Perf High Value CV bidcap adjust', 'ABF3', 'Perf DCF', 3, 'pct'],
  ['perf_low_value_cv_bidcap_adjust', 'Perf Low Value CV bidcap adjust', 'ABF5', 'Perf DCF', 5, 'pct'],
  ['perf_bidcap_cv_payer', 'Perf_bidcap_CV_payer', 'ABF1', 'Perf DCF', 2, 'pct'],
  ['perf_bidcap_upb', 'Perf_bidcap_UPB', 'ABE1', 'Perf DCF', 1, 'pct'],
  ['perf_exitcap_accr_cm', 'perf_exitcap_ACCR_CM', 'DQ1', 'Perf', 2, 'pct'],
  ['perf_exitcap_accr_kd', 'perf_exitcap_ACCR_KD', 'DQ3', 'Perf', 6, 'pct'],
  ['perf_exitcap_cv_cm', 'perf_exitcap_CV_CM', 'DS1', 'Perf', 4, 'pct'],
  ['perf_exitcap_cv_kd', 'perf_exitcap_CV_KD', 'DS3', 'Perf', 8, 'pct'],
  ['perf_exitcap_upb_cm', 'perf_exitcap_UPB_CM', 'DR1', 'Perf', 3, 'pct'],
  ['perf_exitcap_UPB_KD', 'perf_exitcap_UPB_KD', 'DR3', 'Perf', 7, 'pct'],
  ['perf_exitcap_yield_cm', 'perf_exitcap_yield_CM', 'DT1', 'Perf', 5, 'pct'],
  ['perf_exitcap_yield_kd', 'perf_exitcap_yield_KD', 'DT3', 'Perf', 9, 'pct'],
  ['perf_pmts', 'perf_pmts', 'DL1', 'Perf', 1, 'number'],
  ['nw1', 'perf_season', 'NW1', 'Mod-Plan-RI', 19, 'number'],
  ['pmi_recovery_selling_costs', 'PMI Recovery Selling Costs', 'MV1', 'General', 3, 'pct'],
  ['prop_sale_selling_cost', 'Prop Sale selling cost', 'ANQ7', 'Maturing DCF', 1, 'pct'],
  ['rehab_drawn_minimum', 'Rehab Drawn Minimum', 'GA5', 'BPL Rehab', 2, 'pct'],
  ['rehab_minimum_moic', 'Rehab Minimum MOIC', 'GB5', 'BPL Rehab', 3, 'number'],
  ['rehab_net_minimum', 'Rehab Net Minimum', 'FZ5', 'BPL Rehab', 1, 'number'],
  ['reinstatement_month', 'Reinstatement Month', 'OI5', 'Mod-Plan-RI', 4, 'number'],
  ['reo_bidcap_po', 'REO bidcap_PO', 'AGR5', 'REO DCF', 2, 'pct'],
  ['reo_cv_bidcap_adjust', 'REO CV bidcap adjust', 'AGS4', 'REO DCF', 4, 'pct'],
  ['reo_high_value_cv_bidcap_adjust', 'REO High Value CV bidcap adjust', 'AGS3', 'REO DCF', 3, 'pct'],
  ['reo_low_value_cv_bidcap_adjust', 'REO Low Value CV bidcap adjust', 'AGS5', 'REO DCF', 5, 'pct'],
  ['reo_rehab_min_dtv', 'REO Rehab min DTV', 'AFU1', 'REO DCF', 1, 'number'],
  ['reo_ppress_constant', 'REO_PPRESS_CONSTANT', 'AFR5', 'REO DCF', 12, 'number'],
  ['reo_util_constant', 'REO_UTIL_CONSTANT', 'AFV5', 'REO DCF', 13, 'number'],
  ['upb_cap', 'UPB cap', 'ALF3', 'Custom DCF', 3, 'pct'],
  ['value_cap', 'value cap', 'ALF1', 'Custom DCF', 1, 'pct'],
];

/** Values the workbook types into formulas: REO preservation's $200K BPO line and REO utilities' $250K line. */
const LITERALS: Record<string, ConstraintField['literal']> = {
  reo_ppress_constant: { col: 'AFR', find: '<200000', value: 200000 },
  reo_util_constant: { col: 'AFV', find: '<250000', value: 250000 },
};

export const CONSTRAINT_FIELDS: ConstraintField[] = ROWS.map(([index, display, cell, group, order, kind]) => ({
  index, display, cell, group, order, kind, ...(LITERALS[index] ? { literal: LITERALS[index] } : {}),
}));

export const CONSTRAINT_BY_INDEX = new Map(CONSTRAINT_FIELDS.map((f) => [f.index, f]));

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** A stored value ("0.7", "2025-10-10") as the Model cell holds it; null when it is not a valid value. */
export function constraintCell(f: ConstraintField, text: string | null | undefined): number | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  if (f.kind === 'date') {
    const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    return d ? (Date.UTC(+d[1], +d[2] - 1, +d[3]) - EXCEL_EPOCH) / 864e5 : null;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** A Model cell value in the stored form: numbers without floating-point noise, dates as yyyy-mm-dd. */
export function constraintText(f: ConstraintField, v: number): string {
  if (f.kind === 'date') return new Date(EXCEL_EPOCH + Math.round(v) * 864e5).toISOString().slice(0, 10);
  return String(Number(v.toPrecision(15)));
}

/**
 * Points the formulas that type a constant in (REO's $200K line …) at that constant's cell, then
 * writes the given constants into their cells; a constant not given keeps the workbook's value.
 */
export function writeConstants(model: Cell[][], constants: Constants = {}) {
  for (const f of CONSTRAINT_FIELDS) {
    const { row, col } = parseAddress(f.cell);
    if (f.literal) {
      const c = colNum(f.literal.col) - 1;
      const ref = `<$${f.cell.replace(/\d+$/, '')}$${row + 1}`;
      for (const r of model) {
        const v = r?.[c];
        if (typeof v === 'string' && v.startsWith('=')) r[c] = v.split(f.literal.find).join(ref);
      }
      (model[row] ||= [])[col] = f.literal.value;
    }
    const v = constants[f.cell];
    if (typeof v === 'number' && Number.isFinite(v)) (model[row] ||= [])[col] = v;
  }
}
