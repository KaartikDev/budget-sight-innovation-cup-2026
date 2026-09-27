export function calculateCost({ uncached, cached, output, inputRate, cacheRate, outputRate }) {
  const values = { uncached, cached, output, inputRate, cacheRate, outputRate };
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative finite number`);
  }
  const input = uncached * inputRate / 1_000_000;
  const cache = cached * cacheRate / 1_000_000;
  const generated = output * outputRate / 1_000_000;
  return { input, cache, output: generated, total: input + cache + generated };
}

const form = typeof document === 'undefined' ? null : document.querySelector('#cost-form');
if (form) {
  const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const format = value => currency.format(value);
  const refresh = () => {
    const data = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, Number(value)]));
    try {
      const cost = calculateCost(data);
      document.querySelector('#total').textContent = format(cost.total);
      document.querySelector('#breakdown').innerHTML = `Input ${format(cost.input)} <span>·</span> Cache ${format(cost.cache)} <span>·</span> Output ${format(cost.output)}`;
    } catch {
      document.querySelector('#total').textContent = '—';
      document.querySelector('#breakdown').textContent = 'Enter non-negative values to calculate.';
    }
  };
  form.addEventListener('input', refresh);
  refresh();
}
