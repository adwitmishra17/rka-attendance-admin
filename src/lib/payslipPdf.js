// ============================================================================
// payslipPdf.js — branded salary-slip PDF (one page per employee).
//
// Mirrors the Monthly Report letterhead (round crest + wordmark image, both on
// transparent backgrounds). Printer-friendly per the 2026-09-16 rule: black
// text, black hairline rules, light-grey header fill (office printers wash out
// colour). One item → one file; many items → one file, a page each.
// ============================================================================

import { branchLabel } from './branch'

const inr = (n) => 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-IN')

async function loadPng(src, maxDim) {
  try {
    const img = new Image()
    img.src = src
    await img.decode()
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * scale)
    c.height = Math.round(img.height * scale)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return { data: c.toDataURL('image/png'), w: c.width, h: c.height }
  } catch { return null }
}

// Indian-system rupees in words.
function rupeesInWords(amount) {
  const n = Math.round(Number(amount) || 0)
  if (n === 0) return 'Zero rupees only'
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  const two = (x) => x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '')
  const three = (x) => (x >= 100 ? ones[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + two(x % 100) : '') : two(x))
  let out = '', x = n
  const crore = Math.floor(x / 10000000); x %= 10000000
  const lakh = Math.floor(x / 100000); x %= 100000
  const thou = Math.floor(x / 1000); x %= 1000
  if (crore) out += three(crore) + ' Crore '
  if (lakh) out += three(lakh) + ' Lakh '
  if (thou) out += three(thou) + ' Thousand '
  if (x) out += three(x)
  return out.trim() + ' rupees only'
}

function renderOne(doc, autoTable, crest, banner, { item, emp, period, branchCode }) {
  const M = 14
  const pageW = doc.internal.pageSize.getWidth()
  const [y, m] = period.split('-').map(Number)
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  // Letterhead
  if (crest) doc.addImage(crest.data, 'PNG', M, 10.5, 20, 20)
  if (banner) {
    const bw = 74, bh = bw * (banner.h / banner.w)
    doc.addImage(banner.data, 'PNG', M + 24, 11, bw, bh)
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(20, 20, 20).text('RADHAKRISHNA ACADEMY', M + 24, 19)
  }
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(20, 20, 20).text('SALARY SLIP', pageW - M, 15, { align: 'right' })
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(90).text(monthLabel, pageW - M, 20.5, { align: 'right' })
  doc.text(branchLabel(branchCode), pageW - M, 25.5, { align: 'right' })
  doc.setDrawColor(30).setLineWidth(0.5).line(M, 33, pageW - M, 33)

  // Employee band — two rows of label/value pairs
  const pairs1 = [['Employee', emp.full_name || '—'], ['Emp code', emp.employee_code || '—'], ['Designation', emp.designation || '—'], ['Department', emp.department || '—']]
  const pairs2 = [['PF no', emp.pf_number || '—'], ['ESI no', emp.esi_number || '—'], ['UAN', emp.uan_number || '—'], ['Bank A/C', item.bank_account_number || emp.bank_account_number || '—']]
  const colW = (pageW - 2 * M) / 4
  const drawPairs = (pairs, top) => pairs.forEach((p, i) => {
    const x = M + i * colW
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(120).text(String(p[0]).toUpperCase(), x, top)
    doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(20)
    doc.text(doc.splitTextToSize(String(p[1]), colW - 3), x, top + 4)
  })
  drawPairs(pairs1, 40)
  drawPairs(pairs2, 51)

  // Attendance line (structured only)
  let cursorY = 60
  if (item.pay_mode !== 'fixed') {
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(90)
    const lop = Number(item.lop_days || 0)
    doc.text(`Working days: ${item.working_days ?? '—'}    Paid days: ${item.paid_days ?? '—'}${lop ? `    Loss of pay: ${lop} day(s)` : ''}`, M, cursorY)
    cursorY += 3
  }

  // Earnings / Deductions (two half-width tables at the same startY)
  const earnRows = item.pay_mode === 'fixed'
    ? [['Fixed salary', inr(item.gross)]]
    : [['Basic', inr(item.basic)], ['HRA', inr(item.hra)], ['Other allowances', inr(item.other_allowances)]]
  if (Number(item.lop_amount) > 0) earnRows.push([{ content: 'Less: Loss of pay', styles: { textColor: [150, 30, 30] } }, { content: '- ' + inr(item.lop_amount), styles: { textColor: [150, 30, 30] } }])
  const earnedGross = Number(item.gross || 0) - Number(item.lop_amount || 0)

  const dedRows = []
  if (Number(item.epf) > 0) dedRows.push(['EPF', inr(item.epf)])
  if (Number(item.esi) > 0) dedRows.push(['ESI', inr(item.esi)])
  if (Number(item.advance_recovery) > 0) dedRows.push(['Advance recovery', inr(item.advance_recovery)])
  if (Number(item.other_deduction) > 0) dedRows.push([item.other_deduction_note ? `Other (${item.other_deduction_note})` : 'Other deduction', inr(item.other_deduction)])
  if (dedRows.length === 0) dedRows.push(['—', inr(0)])

  const half = (pageW - 2 * M) / 2
  const common = {
    startY: cursorY + 3, theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, textColor: [20, 20, 20], lineColor: [40, 40, 40], lineWidth: 0.1 },
    headStyles: { fillColor: [232, 232, 232], textColor: [20, 20, 20], fontStyle: 'bold', lineColor: [40, 40, 40], lineWidth: 0.1 },
    columnStyles: { 1: { halign: 'right' } },
  }
  autoTable(doc, { ...common, margin: { left: M, right: half + M }, head: [['Earnings', 'Amount']], body: earnRows,
    foot: [[{ content: 'Total earnings', styles: { fontStyle: 'bold' } }, { content: inr(earnedGross), styles: { fontStyle: 'bold', halign: 'right' } }]], footStyles: { fillColor: [245, 245, 245], textColor: [20, 20, 20], lineColor: [40, 40, 40], lineWidth: 0.1 } })
  const y1 = doc.lastAutoTable.finalY
  autoTable(doc, { ...common, margin: { left: half + M, right: M }, head: [['Deductions', 'Amount']], body: dedRows,
    foot: [[{ content: 'Total deductions', styles: { fontStyle: 'bold' } }, { content: inr(item.total_deductions), styles: { fontStyle: 'bold', halign: 'right' } }]], footStyles: { fillColor: [245, 245, 245], textColor: [20, 20, 20], lineColor: [40, 40, 40], lineWidth: 0.1 } })
  const yEnd = Math.max(y1, doc.lastAutoTable.finalY)

  // Net pay box
  const boxY = yEnd + 6
  doc.setDrawColor(30).setLineWidth(0.4).rect(M, boxY, pageW - 2 * M, 16)
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(20)
  doc.text('NET PAY', M + 4, boxY + 7)
  doc.setFontSize(14).text(inr(item.net_pay), pageW - M - 4, boxY + 8, { align: 'right' })
  doc.setFont('helvetica', 'italic').setFontSize(8.5).setTextColor(70)
  doc.text(rupeesInWords(item.net_pay), M + 4, boxY + 13)

  // Footer
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(130)
  doc.text(`Generated ${new Date().toLocaleDateString('en-IN')} · This is a system-generated salary slip.`, M, 285)
  doc.setDrawColor(120).setLineWidth(0.2).line(pageW - M - 45, 278, pageW - M, 278)
  doc.text('Authorised signatory', pageW - M, 282, { align: 'right' })
}

/**
 * @param {object} run    payroll_runs row (period 'YYYY-MM', branch_code)
 * @param {array}  items  payroll_items rows to render
 * @param {object} empById map employee_id → { full_name, employee_code, designation, department, pf_number, esi_number, uan_number, bank_account_number }
 */
export async function generatePayslips({ run, items, empById = {} }) {
  const rows = items.filter(Boolean)
  if (!rows.length) throw new Error('No lines to generate.')
  const [{ jsPDF }, autoTableMod, crest, banner] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), loadPng('/crest.png', 240), loadPng('/banner-light.png', 1000),
  ])
  const autoTable = autoTableMod.default
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  rows.forEach((item, i) => {
    if (i > 0) doc.addPage()
    renderOne(doc, autoTable, crest, banner, { item, emp: empById[item.employee_id] || {}, period: run.period, branchCode: run.branch_code })
  })
  const name = rows.length === 1
    ? `payslip-${(empById[rows[0].employee_id]?.employee_code || 'emp')}-${run.period}.pdf`
    : `payslips-${run.branch_code}-${run.period}.pdf`
  doc.save(name)
}
