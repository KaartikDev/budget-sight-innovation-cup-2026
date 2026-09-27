import { estimateHoursSaved } from './calculation.js';

const fields = ['runs', 'minutes', 'incomplete'].map((id) => document.getElementById(id));
const output = document.getElementById('hours-saved');
const detail = document.getElementById('result-detail');
const error = document.getElementById('input-error');
const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

function updateEstimate() {
  const values = fields.map((field) => field.value.trim() === '' ? NaN : Number(field.value));
  const valid = values.every(Number.isFinite) && values.every((value) => value >= 0) && values[2] <= 100;
  if (!valid) {
    error.hidden = false;
    output.textContent = '—';
    detail.textContent = 'Check the values above to see your estimate.';
    return;
  }
  error.hidden = true;
  const hours = estimateHoursSaved(...values);
  output.textContent = formatter.format(hours);
  const weeks = hours / 40;
  detail.textContent = `About ${formatter.format(weeks)} workweeks returned to your team.`;
}

fields.forEach((field) => field.addEventListener('input', updateEstimate));
updateEstimate();
