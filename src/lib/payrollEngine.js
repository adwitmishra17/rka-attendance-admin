// ============================================================================
// payrollEngine.js — pure payroll math (no I/O, unit-testable).
//
// One employee's monthly pay is computed from: their salary structure + config
// (from `employees`), an attendance summary for the month, any active salary
// advance, and manual office inputs. The monthly-run grid seeds every line from
// computePayrollItem() and may then override any figure before finalising.
//
// Policy (decided with the office, 2026-09-16):
//   • Per-day rate = gross / 30 (fixed divisor, every month).
//   • LOP = absences beyond a per-employee paid-leave quota; school_leave is
//     paid; attendance_exempt or lop_enabled=false ⇒ no LOP.
//   • Deductions are per-employee opt-in: EPF 12% of EARNED basic (basic reduced
//     for LOP days at basic/30), ESI 0.75% of earned
//     wages (only while gross ≤ ₹21,000), salary-advance installment, and a
//     manual "other" line. Any can be off.
//   • pay_mode 'fixed' = a flat fixed_salary with NO auto EPF/ESI/LOP — the
//     "just pay ₹X" case; explicit advance/other deductions still apply.
// ============================================================================

export const EPF_RATE = 0.12;          // employee provident fund, on basic
export const EMPLOYER_EPF_RATE = 0.12; // employer share (register only)
export const ESI_EMP_RATE = 0.0075;    // employee ESI, on gross wages
export const EMPLOYER_ESI_RATE = 0.0325;
export const ESI_WAGE_CEILING = 21000; // ESI applies only at/below this monthly gross
export const LOP_DIVISOR = 30;         // per-day rate = gross / 30

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const inr = (v) => Math.round(num(v)); // whole rupees, half-up (for positive values)

/**
 * Working days in a month for LOP: calendar days − Sundays − holidays.
 * @param {number} year  e.g. 2026
 * @param {number} month 1–12
 * @param {string[]} holidayDates 'YYYY-MM-DD' dates that fall in the month (branch holidays, excluding Sundays)
 */
export function workingDaysInMonth(year, month, holidayDates = []) {
  const days = new Date(year, month, 0).getDate(); // last day of month
  let sundays = 0;
  for (let d = 1; d <= days; d++) {
    if (new Date(year, month - 1, d).getDay() === 0) sundays++;
  }
  const hol = new Set(
    (holidayDates || [])
      .filter((h) => {
        const dt = new Date(`${h}T00:00:00`);
        return dt.getFullYear() === year && dt.getMonth() + 1 === month && dt.getDay() !== 0; // ignore Sunday holidays (already off)
      }),
  );
  return Math.max(0, days - sundays - hol.size);
}

/**
 * Compute one payroll line.
 * @param {object} p
 * @param {object} p.employee  { pay_mode, fixed_salary, basic_salary, hra, other_allowances,
 *                               epf_enabled, esi_enabled, lop_enabled, paid_leaves_per_month, attendance_exempt }
 * @param {object} p.attendance { workingDays, paidDays }  paidDays = present+late+school_leave (exempt ⇒ treated as full)
 * @param {object} [p.advance]   { balance, monthlyInstallment }  outstanding advance + configured installment
 * @param {object} [p.manual]    { otherDeduction, otherDeductionNote, advanceRecovery } office overrides (advanceRecovery overrides the auto installment)
 * @returns full line: earnings, LOP, deductions, net, employer contributions.
 */
export function computePayrollItem({ employee = {}, attendance = {}, advance = {}, manual = {} }) {
  const mode = employee.pay_mode === 'fixed' ? 'fixed' : 'structured';
  const exempt = !!employee.attendance_exempt;

  let basic = 0, hra = 0, otherAllow = 0, gross = 0;
  let workingDays = num(attendance.workingDays);
  let paidDays = exempt ? workingDays : num(attendance.paidDays);
  let lopDays = 0, perDayRate = 0, lopAmount = 0;
  let epf = 0, esi = 0, employerEpf = 0, employerEsi = 0;

  if (mode === 'fixed') {
    gross = inr(employee.fixed_salary);
    // No structure, no LOP, no statutory. Earned = the flat figure.
  } else {
    basic = num(employee.basic_salary);
    hra = num(employee.hra);
    otherAllow = num(employee.other_allowances);
    gross = basic + hra + otherAllow;
    perDayRate = gross / LOP_DIVISOR;

    const applyLop = !!employee.lop_enabled && !exempt;
    if (applyLop) {
      const absent = Math.max(0, workingDays - paidDays);
      lopDays = Math.max(0, absent - num(employee.paid_leaves_per_month));
      lopAmount = inr(lopDays * perDayRate);
    }
    const earnedForEsi = gross - lopAmount;
    // EPF is on EARNED basic — basic reduced by the LOP days at basic/30 (office decision 2026-09-16).
    const earnedBasic = Math.max(0, basic - (lopDays * basic) / LOP_DIVISOR);
    if (employee.epf_enabled) { epf = inr(EPF_RATE * earnedBasic); employerEpf = inr(EMPLOYER_EPF_RATE * earnedBasic); }
    if (employee.esi_enabled && gross <= ESI_WAGE_CEILING) {
      esi = inr(ESI_EMP_RATE * earnedForEsi);
      employerEsi = inr(EMPLOYER_ESI_RATE * earnedForEsi);
    }
  }

  const earnedGross = gross - lopAmount;

  // Advance recovery: explicit override, else this month's installment capped at the outstanding balance.
  const autoRecovery = Math.min(inr(advance.balance), inr(advance.monthlyInstallment));
  const advanceRecovery = manual.advanceRecovery != null ? inr(manual.advanceRecovery) : autoRecovery;
  const otherDeduction = inr(manual.otherDeduction);

  const totalDeductions = epf + esi + advanceRecovery + otherDeduction;
  const netPay = inr(earnedGross - totalDeductions);

  return {
    pay_mode: mode,
    basic, hra, other_allowances: otherAllow, gross,
    working_days: workingDays, paid_days: paidDays,
    lop_days: lopDays, per_day_rate: Math.round(perDayRate * 100) / 100, lop_amount: lopAmount,
    epf, esi, advance_recovery: advanceRecovery,
    other_deduction: otherDeduction, other_deduction_note: manual.otherDeductionNote || null,
    total_deductions: totalDeductions, net_pay: netPay,
    employer_epf: employerEpf, employer_esi: employerEsi,
  };
}
