import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { WORKLOAD_TYPES } from "./reportingTaxonomy.js";

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 3 });
const OUTCOMES = ["completed", "partial_completion", "failed", "unknown"];
const CUSTOM_WORKLOAD_OPTION = "__custom__";
const RANGE_OPTIONS = [
  { value: "24h", label: "24 hours", hours: 24, bucket: "hour" },
  { value: "7d", label: "7 days", hours: 24 * 7, bucket: "day" },
  { value: "30d", label: "30 days", hours: 24 * 30, bucket: "day" },
  { value: "all", label: "All time", hours: null, bucket: "week" },
];

function titleCase(value) {
  return String(value || "unknown").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeWorkload(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatDuration(value) {
  if (value == null) return "Not recorded";
  if (value < 60_000) return `${(value / 1_000).toFixed(1)} sec`;
  return `${(value / 60_000).toFixed(1)} min`;
}

function formatBucket(value, bucket) {
  const options = bucket === "hour"
    ? { hour: "numeric", month: "short", day: "numeric" }
    : bucket === "week" ? { month: "short", day: "numeric" } : { month: "short", day: "numeric" };
  return new Intl.DateTimeFormat("en-US", options).format(new Date(value));
}

function hasSelection(turnIds, selected) {
  return !selected.size || turnIds.some((id) => selected.has(id));
}

function PanelHeader({ title, legend, actions }) {
  return <header className="insight-panel-header"><h2>{title}</h2>{(legend || actions) && <div className="insight-panel-actions">{legend && <div className="chart-legend">{legend}</div>}{actions}</div>}</header>;
}

function ChartTooltip({ x, y, width = 172, canvasWidth = 900, children }) {
  const left = clamp(x + 12, 4, canvasWidth - width - 4);
  const top = clamp(y - 42, 4, 320);
  return <g className="svg-tooltip" transform={`translate(${left} ${top})`} pointerEvents="none"><rect width={width} height="46" rx="5" /><foreignObject x="8" y="6" width={width - 16} height="36"><div className="svg-tooltip-copy">{children}</div></foreignObject></g>;
}

export function TimeSeriesChart({ data, bucket, selected = new Set(), onSelect }) {
  const [hovered, setHovered] = useState(null);
  const width = 900;
  const plotLeft = 64;
  const plotRight = 878;
  const plotWidth = plotRight - plotLeft;
  const count = Math.max(1, data.length);
  const x = (index) => data.length === 1 ? plotLeft + plotWidth / 2 : plotLeft + (index / (data.length - 1)) * plotWidth;
  const maxSpend = Math.max(1, ...data.map((point) => point.spendMicros));
  const maxTokens = Math.max(1, ...data.map((point) => point.inputTokens + point.outputTokens));
  const spendY = (value) => 146 - (value / maxSpend) * 96;
  const tokenHeight = (value) => (value / maxTokens) * 98;
  const points = data.map((point, index) => [x(index), spendY(point.spendMicros)]);
  let line = "";
  points.forEach(([pointX, pointY], index) => {
    if (index === 0) line += `M${pointX},${pointY}`;
    else {
      const midpoint = (points[index - 1][0] + pointX) / 2;
      line += `H${midpoint}V${pointY}H${pointX}`;
    }
  });
  const area = points.length ? `${line}V146H${points[0][0]}Z` : "";
  const barWidth = Math.min(42, (plotWidth / count) * 0.58);
  const labelIndexes = uniqueIndexes([0, Math.floor((data.length - 1) / 2), data.length - 1]);
  const hoveredPoint = hovered == null ? null : data[hovered];
  return <section className="insight-panel time-series-panel">
    <PanelHeader
      title="Usage over time"
      legend={<><span className="legend-spend">Spend</span><span className="legend-cached">Cached input</span><span className="legend-uncached">Uncached input</span><span className="legend-output">Output</span></>}
    />
    <div className="chart-stage timeline-reveal">
      <svg className="insight-chart" viewBox="0 0 900 350" role="img" aria-labelledby="usage-chart-title usage-chart-description">
        <title id="usage-chart-title">Estimated spend and token usage over time</title>
        <desc id="usage-chart-description">A stepped spend line above stacked bars for cached input, uncached input, and output tokens.</desc>
        <defs><linearGradient id="spendArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d77a45" stopOpacity=".28" /><stop offset="1" stopColor="#d77a45" stopOpacity="0" /></linearGradient><clipPath id="timelineReveal"><rect className="timeline-clip" x="0" y="0" width="900" height="350" /></clipPath></defs>
        <g className="chart-grid"><line x1={plotLeft} y1="50" x2={plotRight} y2="50" /><line x1={plotLeft} y1="98" x2={plotRight} y2="98" /><line x1={plotLeft} y1="146" x2={plotRight} y2="146" /><line x1={plotLeft} y1="206" x2={plotRight} y2="206" /><line x1={plotLeft} y1="255" x2={plotRight} y2="255" /><line x1={plotLeft} y1="304" x2={plotRight} y2="304" /></g>
        <g className="chart-axis-labels"><text x="12" y="54">{money.format(maxSpend / 1_000_000)}</text><text x="12" y="150">$0</text><text x="12" y="210">{compact.format(maxTokens)}</text><text x="12" y="308">0</text></g>
        <g clipPath="url(#timelineReveal)">{area && <path className="spend-area" d={area} />}{line && <path className="spend-line" d={line} />}</g>
        {data.map((point, index) => {
          const pointX = x(index);
          const cachedHeight = tokenHeight(point.cachedInputTokens);
          const uncachedHeight = tokenHeight(point.uncachedInputTokens);
          const outputHeight = tokenHeight(point.outputTokens);
          const active = hasSelection(point.turnIds, selected);
          return <g key={point.bucketStart} className={`token-bar chart-mark ${active ? "related" : "unrelated"}`} role={onSelect ? "button" : "img"} tabIndex="0" aria-label={`${formatBucket(point.bucketStart, bucket)}: ${integer.format(point.totalTokens)} tokens, ${money.format(point.spendMicros / 1_000_000)} spend`} onClick={() => onSelect?.({ title: formatBucket(point.bucketStart, bucket), description: `${point.turns} turn${point.turns === 1 ? "" : "s"} in this time bucket`, turnIds: point.turnIds })} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} onKeyDown={(event) => { if (onSelect && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.currentTarget.dispatchEvent(new MouseEvent("click", { bubbles: true })); } }}>
            <rect className="bar-cached" x={pointX - barWidth / 2} y={304 - cachedHeight} width={barWidth} height={cachedHeight} rx="2" />
            <rect className="bar-uncached" x={pointX - barWidth / 2} y={304 - cachedHeight - uncachedHeight} width={barWidth} height={uncachedHeight} rx="2" />
            <rect className="bar-output" x={pointX - barWidth / 2} y={304 - cachedHeight - uncachedHeight - outputHeight} width={barWidth} height={outputHeight} rx="2" />
            <circle className="spend-point" cx={pointX} cy={spendY(point.spendMicros)} r="4" />
          </g>;
        })}
        <g className="chart-x-labels">{labelIndexes.map((index) => data[index] && <text key={data[index].bucketStart} x={x(index)} y="336" textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}>{formatBucket(data[index].bucketStart, bucket)}</text>)}</g>
        {hoveredPoint && <ChartTooltip x={x(hovered)} y={spendY(hoveredPoint.spendMicros)}><strong>{formatBucket(hoveredPoint.bucketStart, bucket)}</strong><span>{money.format(hoveredPoint.spendMicros / 1_000_000)} · {compact.format(hoveredPoint.totalTokens)} tokens</span></ChartTooltip>}
      </svg>
    </div>
  </section>;
}

function uniqueIndexes(values) {
  return [...new Set(values.filter((value) => value >= 0))];
}

function median(values) {
  const sorted = values.filter((value) => value != null).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function EfficiencyScatter({ points, selected, onSelect }) {
  const [hovered, setHovered] = useState(null);
  const width = 520;
  const height = 344;
  const left = 56;
  const right = 500;
  const top = 30;
  const bottom = 296;
  const maxDuration = Math.max(1, ...points.map((point) => point.durationMs || 0));
  const maxSpend = Math.max(1, ...points.map((point) => point.spendMicros || 0));
  const x = (value) => left + (numberOrZero(value) / maxDuration) * (right - left);
  const y = (value) => bottom - (numberOrZero(value) / maxSpend) * (bottom - top);
  const durationMedian = median(points.map((point) => point.durationMs));
  const spendMedian = median(points.map((point) => point.spendMicros));
  const activePoint = points.find((point) => point.turnId === hovered);
  return <section className="insight-panel scatter-panel">
    <PanelHeader title="Run efficiency" />
    <div className="chart-stage">
      <svg className="insight-chart scatter-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="efficiency-title efficiency-description">
        <title id="efficiency-title">Run efficiency scatterplot</title><desc id="efficiency-description">Each turn is plotted by duration and estimated spend. Larger circles contain more tool calls.</desc>
        <g className="chart-grid"><line x1={left} y1={top} x2={left} y2={bottom} /><line x1={left} y1={bottom} x2={right} y2={bottom} /><line className="median-line" x1={x(durationMedian)} y1={top} x2={x(durationMedian)} y2={bottom} /><line className="median-line" x1={left} y1={y(spendMedian)} x2={right} y2={y(spendMedian)} /></g>
        <g className="chart-axis-labels"><text x="8" y={top + 4}>{money.format(maxSpend / 1_000_000)}</text><text x="8" y={bottom + 4}>$0</text><text x={left} y="326">0 sec</text><text x={right} y="326" textAnchor="end">{formatDuration(maxDuration)}</text></g>
        {points.map((point, index) => {
          const radius = 5 + Math.sqrt(Math.max(0, point.toolCalls)) * 1.25;
          const active = hasSelection([point.turnId], selected);
          return <circle key={point.turnId} className={`scatter-point outcome-${point.outcome} chart-mark ${active ? "related" : "unrelated"}`} cx={x(point.durationMs)} cy={y(point.spendMicros)} r={radius} role="button" tabIndex="0" aria-label={`${point.title}, ${titleCase(point.outcome)}, ${money.format(numberOrZero(point.spendMicros) / 1_000_000)}, ${formatDuration(point.durationMs)}`} onMouseEnter={() => setHovered(point.turnId)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(point.turnId)} onBlur={() => setHovered(null)} onClick={() => onSelect({ type: "run_efficiency", title: point.title, description: `${titleCase(point.workload)} · ${titleCase(point.outcome)}`, turnIds: [point.turnId] })} />;
        })}
        {activePoint && <ChartTooltip x={x(activePoint.durationMs)} y={y(activePoint.spendMicros)} width={190}><strong>{activePoint.title}</strong><span>{money.format(numberOrZero(activePoint.spendMicros) / 1_000_000)} · {activePoint.toolCalls} tools</span></ChartTooltip>}
      </svg>
    </div>
    <div className="efficiency-legend" aria-label="Run efficiency chart legend">
      <div className="outcome-key">{OUTCOMES.map((outcome) => <span key={outcome} className={`outcome-${outcome}`}>{titleCase(outcome)}</span>)}</div>
      <div className="efficiency-guide">
        <span className="guide-bubble"><i aria-hidden="true" />Larger circle = more tool calls</span>
        <span className="guide-median"><i aria-hidden="true" />Dotted lines = median duration and spend</span>
      </div>
    </div>
  </section>;
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function OverlapHeatmap({ overlap, selected, onSelect }) {
  const [hovered, setHovered] = useState(null);
  const repositories = overlap.repositories.slice(0, 6);
  const intents = overlap.intents.slice(0, 8);
  const cells = new Map(overlap.cells.map((cell) => [`${cell.repositoryId}\u0000${cell.intent}`, cell]));
  const left = 172;
  const top = 82;
  const cellWidth = 88;
  const cellHeight = 46;
  const width = left + intents.length * cellWidth + 16;
  const height = top + repositories.length * cellHeight + 24;
  const activeCell = hovered ? cells.get(hovered) : null;
  return <section className="insight-panel overlap-panel">
    <PanelHeader title="Cross-agent overlap" />
    <div className="chart-stage heatmap-scroll">
      <svg className="insight-chart heatmap-chart" viewBox={`0 0 ${Math.max(760, width)} ${height}`} role="img" aria-labelledby="overlap-title overlap-description">
        <title id="overlap-title">Agent overlap by repository and tool intent</title><desc id="overlap-description">Rows are repositories and columns are tool intents. Darker cells involve more distinct agents.</desc>
        <g className="heatmap-labels">{intents.map(({ intent }, column) => <text key={intent} transform={`translate(${left + column * cellWidth + cellWidth / 2} ${top - 12}) rotate(-35)`} textAnchor="start">{titleCase(intent)}</text>)}{repositories.map((repository, row) => <text key={repository.id} x={left - 12} y={top + row * cellHeight + 27} textAnchor="end">{repository.name.length > 22 ? `${repository.name.slice(0, 20)}…` : repository.name}</text>)}</g>
        {repositories.flatMap((repository, row) => intents.map(({ intent }, column) => {
          const key = `${repository.id}\u0000${intent}`;
          const cell = cells.get(key);
          const x = left + column * cellWidth;
          const y = top + row * cellHeight;
          if (!cell) return <rect key={key} className="heat-cell empty" x={x + 3} y={y + 3} width={cellWidth - 6} height={cellHeight - 6} rx="4" />;
          const active = hasSelection(cell.turnIds, selected);
          return <g key={key} className={`chart-mark heat-cell-group ${active ? "related" : "unrelated"}`} role="button" tabIndex="0" aria-label={`${repository.name}, ${titleCase(intent)}: ${cell.callCount} calls by ${cell.agentCount} agents`} onMouseEnter={() => setHovered(key)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(key)} onBlur={() => setHovered(null)} onClick={() => onSelect({ type: "cross_agent_overlap", focusIntent: intent, title: `${repository.name} · ${titleCase(intent)}`, description: `${cell.callCount} calls across ${cell.agentCount} agents and ${cell.turnCount} turns`, turnIds: cell.turnIds })}>
            <rect className={`heat-cell agents-${Math.min(4, cell.agentCount)}`} x={x + 3} y={y + 3} width={cellWidth - 6} height={cellHeight - 6} rx="4" />
            <text className="heat-value" x={x + cellWidth / 2} y={y + 28} textAnchor="middle">{cell.callCount}</text>
          </g>;
        }))}
        {activeCell && <ChartTooltip x={left + intents.findIndex(({ intent }) => intent === activeCell.intent) * cellWidth + cellWidth / 2} y={top + repositories.findIndex((repository) => repository.id === activeCell.repositoryId) * cellHeight + 8} width={214}><strong>{activeCell.agentCount} agents · {activeCell.callCount} calls</strong><span>{activeCell.agentNames.join(", ")}</span></ChartTooltip>}
      </svg>
    </div>
  </section>;
}

function OutcomeBars({ groups, selected, onSelect }) {
  return <section className="insight-panel outcome-panel">
    <PanelHeader title="Outcomes by workload" />
    <div className="outcome-bars" role="img" aria-label="Outcome proportions by workload">{groups.slice(0, 7).map((group) => <div className="outcome-bar-row" key={group.workload}>
      <div className="outcome-bar-label"><strong>{titleCase(group.workload)}</strong><span>{group.total} turn{group.total === 1 ? "" : "s"}</span></div>
      <div className={`outcome-bar-track ${group.total < 3 ? "low-sample" : ""}`}>{OUTCOMES.map((outcome) => {
        const value = group.outcomes[outcome];
        const width = group.total ? (value.count / group.total) * 100 : 0;
        if (!value.count) return null;
        const active = hasSelection(value.turnIds, selected);
        return <button key={outcome} className={`outcome-segment outcome-${outcome} ${active ? "related" : "unrelated"}`} style={{ width: `${width}%` }} aria-label={`${titleCase(group.workload)}, ${titleCase(outcome)}: ${value.count} turns`} title={`${titleCase(outcome)} · ${value.count}`} onClick={() => onSelect({ type: "workload_outcome", title: `${titleCase(group.workload)} · ${titleCase(outcome)}`, description: `${value.count} of ${group.total} turns`, turnIds: value.turnIds })}><span>{width >= 16 ? value.count : ""}</span></button>;
      })}</div>
    </div>)}</div>
    <div className="outcome-key">{OUTCOMES.map((outcome) => <span key={outcome} className={`outcome-${outcome}`}>{titleCase(outcome)}</span>)}</div>
  </section>;
}

function WorkloadRadar({ groups, selected, onSelect }) {
  const [hovered, setHovered] = useState(null);
  const [editorMode, setEditorMode] = useState(null);
  const [pendingWorkload, setPendingWorkload] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState("");
  const [customWorkload, setCustomWorkload] = useState("");
  const [addedWorkloads, setAddedWorkloads] = useState([]);
  const [hiddenWorkloads, setHiddenWorkloads] = useState([]);
  const observed = new Set(groups.map((group) => group.workload));
  const manuallyAdded = addedWorkloads.filter((workload) => !observed.has(workload) && !hiddenWorkloads.includes(workload));
  const emptyOutcomes = () => Object.fromEntries(OUTCOMES.map((outcome) => [outcome, { count: 0, turnIds: [] }]));
  const visibleGroups = [
    ...groups.filter((group) => !hiddenWorkloads.includes(group.workload)),
    ...manuallyAdded.map((workload) => ({ workload, total: 0, outcomes: emptyOutcomes() })),
  ];
  const visibleWorkloads = visibleGroups.map((group) => group.workload);
  const available = WORKLOAD_TYPES.filter((workload) => !visibleWorkloads.includes(workload));
  const chosenWorkload = pendingWorkload === CUSTOM_WORKLOAD_OPTION || available.includes(pendingWorkload) ? pendingWorkload : CUSTOM_WORKLOAD_OPTION;
  const normalizedCustom = normalizeWorkload(customWorkload);
  const workloadToAdd = chosenWorkload === CUSTOM_WORKLOAD_OPTION ? normalizedCustom : chosenWorkload;
  const workloadToRemove = visibleWorkloads.includes(pendingRemoval) ? pendingRemoval : visibleWorkloads[0] || "";
  const canAdd = workloadToAdd.length >= 2 && !visibleWorkloads.includes(workloadToAdd);
  const axes = visibleGroups.map((group) => {
    const turnIds = OUTCOMES.flatMap((outcome) => group.outcomes[outcome].turnIds);
    return {
      ...group,
      turnIds,
    };
  });
  const maxTurns = Math.max(1, ...axes.map((axis) => axis.total));
  const width = 520;
  const height = 380;
  const centerX = 260;
  const centerY = 180;
  const radius = 116;
  const angleFor = (index) => -Math.PI / 2 + (index / Math.max(1, axes.length)) * Math.PI * 2;
  const pointFor = (index, scale = 1) => {
    const angle = angleFor(index);
    return [centerX + Math.cos(angle) * radius * scale, centerY + Math.sin(angle) * radius * scale];
  };
  const polygon = (scale) => axes.map((_, index) => pointFor(index, scale).join(",")).join(" ");
  const valuePoints = axes.map((axis, index) => pointFor(index, axis.total / maxTurns));
  const activeAxis = hovered == null ? null : axes[hovered];
  const addWorkload = () => {
    if (!canAdd) return;
    setAddedWorkloads((current) => current.includes(workloadToAdd) ? current : [...current, workloadToAdd]);
    setHiddenWorkloads((current) => current.filter((workload) => workload !== workloadToAdd));
    setPendingWorkload("");
    setCustomWorkload("");
    setEditorMode(null);
    setHovered(null);
  };
  const removeWorkload = () => {
    if (!workloadToRemove) return;
    setAddedWorkloads((current) => current.filter((workload) => workload !== workloadToRemove));
    if (observed.has(workloadToRemove)) setHiddenWorkloads((current) => current.includes(workloadToRemove) ? current : [...current, workloadToRemove]);
    setPendingRemoval("");
    setEditorMode(null);
    setHovered(null);
  };
  return <section className="insight-panel radar-panel">
    <PanelHeader title="Turns by workload" actions={<div className={`radar-add-control ${editorMode ? "open" : ""}`}>
      {editorMode === "add" ? <>
        <select value={chosenWorkload} onChange={(event) => { setPendingWorkload(event.target.value); setCustomWorkload(""); }} aria-label="Workload type to add"><option value={CUSTOM_WORKLOAD_OPTION}>Custom workload…</option>{available.map((workload) => <option key={workload} value={workload}>{titleCase(workload)}</option>)}</select>
        {chosenWorkload === CUSTOM_WORKLOAD_OPTION && <input autoFocus value={customWorkload} onChange={(event) => setCustomWorkload(event.target.value)} placeholder="Type workload name" aria-label="Custom workload name" maxLength="48" />}
        <button className="radar-place-button" onClick={addWorkload} disabled={!canAdd}>Add axis</button>
        <button className="radar-cancel-button" onClick={() => setEditorMode(null)} aria-label="Cancel adding workload">×</button>
      </> : editorMode === "remove" ? <>
        <select value={workloadToRemove} onChange={(event) => setPendingRemoval(event.target.value)} aria-label="Workload type to remove">{visibleWorkloads.map((workload) => <option key={workload} value={workload}>{titleCase(workload)}</option>)}</select>
        <button className="radar-remove-confirm" onClick={removeWorkload} disabled={!workloadToRemove}>Remove axis</button>
        <button className="radar-cancel-button" onClick={() => setEditorMode(null)} aria-label="Cancel removing workload">×</button>
      </> : <>
        <button className="radar-add-button" onClick={() => setEditorMode("add")}>+ Add workload</button>
        <button className="radar-remove-button" onClick={() => setEditorMode("remove")} disabled={!visibleWorkloads.length}>− Remove workload</button>
      </>}
    </div>} />
    <div className="chart-stage">
      <svg className="insight-chart radar-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="radar-title radar-description">
        <title id="radar-title">Turn count by workload</title>
        <desc id="radar-description">Each axis represents a workload. Distance from the center shows its turn count relative to the busiest workload in the current filters. Manually added workloads without observed turns remain at the center.</desc>
        <g className="radar-grid">
          {[.25, .5, .75, 1].map((scale) => <polygon key={scale} points={polygon(scale)} />)}
          {axes.map((_, index) => { const [x, y] = pointFor(index); return <line key={index} x1={centerX} y1={centerY} x2={x} y2={y} />; })}
        </g>
        {axes.length > 2 && <polygon key={axes.map((axis) => axis.workload).join("-")} className="radar-area" points={valuePoints.map((point) => point.join(",")).join(" ")} />}
        {axes.map((axis, index) => {
          const [pointX, pointY] = valuePoints[index];
          const [labelX, labelY] = pointFor(index, 1.22);
          const angle = angleFor(index);
          const anchor = Math.cos(angle) > .25 ? "start" : Math.cos(angle) < -.25 ? "end" : "middle";
          const active = hasSelection(axis.turnIds, selected);
          const selectable = axis.total > 0;
          return <g key={axis.workload} className={`radar-axis chart-mark ${active ? "related" : "unrelated"} ${selectable ? "" : "manual-axis"}`} role={selectable ? "button" : "img"} tabIndex="0" aria-label={`${titleCase(axis.workload)}: ${axis.total ? `${axis.total} turn${axis.total === 1 ? "" : "s"}` : "no observed turns; manually added"}`} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)} onClick={() => selectable && onSelect({ type: "workload_volume", title: titleCase(axis.workload), description: `${axis.total} turn${axis.total === 1 ? "" : "s"} in this workload`, turnIds: axis.turnIds })} onKeyDown={(event) => { if (selectable && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.currentTarget.dispatchEvent(new MouseEvent("click", { bubbles: true })); } }}>
            <circle className="radar-hit" cx={pointX} cy={pointY} r="13" />
            <circle className="radar-point" cx={pointX} cy={pointY} r="4.5" />
            <text className="radar-label" x={labelX} y={labelY} textAnchor={anchor}>{titleCase(axis.workload)}</text>
            <text className="radar-sample" x={labelX} y={labelY + 12} textAnchor={anchor}>{axis.total} turn{axis.total === 1 ? "" : "s"}</text>
          </g>;
        })}
        {activeAxis && <ChartTooltip canvasWidth={width} x={valuePoints[hovered][0]} y={valuePoints[hovered][1]} width={184}><strong>{titleCase(activeAxis.workload)}</strong><span>{activeAxis.total ? `${integer.format(activeAxis.total)} turn${activeAxis.total === 1 ? "" : "s"}` : "No observed turns · view only"}</span></ChartTooltip>}
      </svg>
    </div>
    <p className="insight-pro-tip"><strong>Pro Tip!</strong><span>Create a <code>SKILL.md</code> for repeated workloads to minimize costs! You can add custom workloads too!</span></p>
  </section>;
}

function Sparkline({ values }) {
  const width = 104;
  const height = 28;
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => `${values.length === 1 ? width / 2 : (index / (values.length - 1)) * width},${height - 3 - (value / max) * (height - 8)}`).join(" ");
  return <svg className="insight-sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><line x1="0" y1={height - 3} x2={width} y2={height - 3} /><polyline points={points} /></svg>;
}

function formatImpact(impact) {
  if (impact.unit === "micros") return money.format(impact.value / 1_000_000);
  if (impact.unit === "tokens") return `${compact.format(impact.value)} tokens`;
  if (impact.unit === "ratio") return `${impact.value}×`;
  return `${integer.format(impact.value)} ${impact.unit}`;
}

function OpportunityFeed({ opportunities, selected, onSelect }) {
  return <section className="insight-panel opportunities-panel">
    <PanelHeader title="Obvious wins" />
    <div className="opportunity-feed">{opportunities.slice(0, 5).map((opportunity, index) => {
      const active = hasSelection(opportunity.turnIds, selected);
      return <button key={opportunity.id} className={`opportunity-row confidence-${opportunity.confidence} ${active ? "related" : "unrelated"}`} onClick={() => onSelect({ type: opportunity.type, title: opportunity.title, description: opportunity.summary, turnIds: opportunity.turnIds })}>
        <span className="opportunity-rank">{String(index + 1).padStart(2, "0")}</span>
        <span className="opportunity-copy"><span className="opportunity-meta">{titleCase(opportunity.confidence)} confidence · {titleCase(opportunity.impact.kind)} impact · {opportunity.affectedUserCount} user{opportunity.affectedUserCount === 1 ? "" : "s"} affected</span><strong>{opportunity.title}</strong><small>{opportunity.summary}</small><span className="opportunity-evidence">{opportunity.evidence.slice(0, 2).join(" · ")}</span></span>
        <span className="opportunity-impact"><small>{opportunity.impact.label}</small><strong>{formatImpact(opportunity.impact)}</strong><Sparkline values={opportunity.trend} /></span>
      </button>;
    })}</div>
  </section>;
}

function ToolEvidence({ tools, empty = "No matching tool calls were recorded." }) {
  if (!tools.length) return <p className="detail-empty-evidence">{empty}</p>;
  return <div className="detail-tool-list">{tools.slice(0, 16).map((tool, index) => <div className="detail-tool" key={tool.ordinal || `${tool.toolName}-${index}`}>
    <div><strong>{tool.toolName || titleCase(tool.itemType)}</strong><span className={`tool-status status-${tool.status}`}>{titleCase(tool.status)}</span></div>
    <p>{tool.ordinal || `tool_${index + 1}`} · {titleCase(tool.intent)} · {titleCase(tool.effect)}{tool.durationMs != null ? ` · ${formatDuration(tool.durationMs)}` : ""}{tool.exitCode != null ? ` · exit ${tool.exitCode}` : ""}</p>
    {tool.targets?.length > 0 && <small>{tool.targets.join(" · ")}</small>}
  </div>)}</div>;
}

function FailureEvidence({ failures }) {
  if (!failures.length) return <p className="detail-empty-evidence">No deterministic failures were recorded.</p>;
  return <div className="detail-failure-list">{failures.map((failure, index) => <div key={failure.ordinal || index}><strong>{titleCase(failure.category)}</strong><span>{failure.toolOrdinal}{failure.exitCode != null ? ` · exit ${failure.exitCode}` : ""}</span>{failure.subject && <p>{failure.subject}</p>}<code>{failure.fingerprint}</code></div>)}</div>;
}

function focusForRun(run, selection) {
  const tools = run.tools || [];
  if (selection.type === "stable_tool_reuse") return { title: "Read-result evidence", kind: "tools", values: tools.filter((tool) => tool.effect === "read") };
  if (selection.type === "cross_agent_overlap") return { title: "Overlap evidence", kind: "tools", values: selection.focusIntent ? tools.filter((tool) => tool.intent === selection.focusIntent) : tools };
  if (selection.type === "command_churn") return { title: "Command churn evidence", kind: "tools", values: tools.filter((tool) => tool.itemType === "commandExecution" || tool.status === "failed") };
  if (selection.type === "recurring_failures") return { title: "Recurring failure evidence", kind: "failures", values: run.failures || [] };
  if (selection.type === "validation_gap") return { title: "Validation evidence", kind: "validation", values: [] };
  return { title: "Execution evidence", kind: "tools", values: tools };
}

function ExpandedRun({ run, selection }) {
  const focus = focusForRun(run, selection);
  return <div className="detail-run-expanded">
    <section className="detail-prompt"><span>Prompt summary</span><p>{run.promptSummary || run.title}</p><small>{run.conversation?.userMessages || 0} user message{run.conversation?.userMessages === 1 ? "" : "s"} · raw prompt text is not retained in reporting</small></section>
    <section className="detail-focus"><span>{focus.title}</span>
      {focus.kind === "tools" && <ToolEvidence tools={focus.values} />}
      {focus.kind === "failures" && <FailureEvidence failures={focus.values} />}
      {focus.kind === "validation" && <div className={`detail-validation ${run.validationAfterLastModification ? "passed" : "missing"}`}><strong>{run.validationAfterLastModification ? "Validated after final edit" : "No validation after final edit"}</strong><small>{run.changedFileCount || 0} changed files · {run.validationActions?.length || 0} later validation actions</small></div>}
    </section>
    <div className="detail-run-facts"><div><span>Model</span><strong>{run.model || "Unknown"}</strong></div><div><span>Tokens</span><strong>{compact.format(numberOrZero(run.totalTokens))}</strong></div><div><span>Cache</span><strong>{compact.format(numberOrZero(run.cachedInputTokens))}</strong></div><div><span>Branch</span><strong>{run.branch || "—"}</strong></div></div>
    {(run.tools || []).length > focus.values.length && <details className="detail-evidence-group"><summary>All tool calls <span>{run.tools.length}</span></summary><ToolEvidence tools={run.tools} /></details>}
    {(run.failures || []).length > 0 && focus.kind !== "failures" && <details className="detail-evidence-group"><summary>Failure records <span>{run.failures.length}</span></summary><FailureEvidence failures={run.failures} /></details>}
    {(run.changedFiles || []).length > 0 && <details className="detail-evidence-group"><summary>Changed files <span>{run.changedFiles.length}</span></summary><div className="detail-file-list">{run.changedFiles.map((file) => <div key={file.path}><code>{file.path}</code><span>+{file.linesAdded} −{file.linesDeleted}</span></div>)}</div></details>}
  </div>;
}

function DetailRail({ selection, runs, onClose }) {
  const [expanded, setExpanded] = useState(null);
  useEffect(() => { setExpanded(null); }, [selection.title]);
  const selected = new Set(selection.turnIds);
  const visible = runs.filter((run) => selected.has(run.turnId)).sort((a, b) => numberOrZero(b.spendMicros) - numberOrZero(a.spendMicros));
  const totalSpend = visible.reduce((sum, run) => sum + numberOrZero(run.spendMicros), 0);
  return <aside className="insight-detail-rail" aria-label="Selected insight details">
    <header><div><span>Selected evidence</span><h2>{selection.title}</h2><p>{selection.description}</p></div><button onClick={onClose} aria-label="Close selected evidence">×</button></header>
    <div className="detail-rail-summary"><div><span>Turns</span><strong>{visible.length}</strong></div><div><span>Spend</span><strong>{money.format(totalSpend / 1_000_000)}</strong></div><div><span>Tools</span><strong>{integer.format(visible.reduce((sum, run) => sum + run.toolCalls, 0))}</strong></div></div>
    <div className="detail-run-list">{visible.slice(0, 20).map((run) => {
      const open = expanded === run.turnId;
      return <article key={run.turnId} className={open ? "expanded" : ""}>
        <button className="detail-run-toggle" onClick={() => setExpanded(open ? null : run.turnId)} aria-expanded={open}>
          <span className={`detail-outcome outcome-${run.outcome}`} />
          <span className="detail-run-identity"><strong>{run.title}</strong><small>{run.repositoryName} · {run.userName}</small></span>
          <span className="detail-run-metrics"><strong>{money.format(numberOrZero(run.spendMicros) / 1_000_000)}</strong><small>{run.toolCalls} tools · {formatDuration(run.durationMs)}</small></span>
          <span className="detail-run-chevron">{open ? "−" : "+"}</span>
        </button>
        {open && <ExpandedRun run={run} selection={selection} />}
      </article>;
    })}</div>
  </aside>;
}

function InsightsSkeleton() {
  return <div className="insights-skeleton" aria-label="Loading insights"><div className="skeleton-grid"><span /><span /></div><div className="skeleton-grid"><span /><span /></div></div>;
}

function QualityStrip({ quality }) {
  const values = [
    ["Unknown outcomes", quality.unknownOutcomes],
    ["Missing usage", quality.missingUsage],
    ["Incomplete sources", quality.incompleteSources],
    ["Pending extraction", quality.pendingExtraction],
    ["Failed extraction", quality.failedExtraction],
  ];
  const total = values.reduce((sum, [, value]) => sum + value, 0);
  return <section className={`quality-strip ${total ? "has-issues" : "clean"}`}><div><span>Data confidence</span><strong>{total ? `${total} quality signals` : "Reporting inputs are complete"}</strong></div><dl>{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>;
}

export default function InsightsDashboard() {
  const [range, setRange] = useState("7d");
  const [filters, setFilters] = useState({ repositoryId: "", userId: "", model: "", workload: "", outcome: "" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState(null);

  const params = useMemo(() => {
    const choice = RANGE_OPTIONS.find((option) => option.value === range) || RANGE_OPTIONS[1];
    const value = new URLSearchParams({ bucket: choice.bucket });
    if (choice.hours) {
      value.set("from", new Date(Date.now() - choice.hours * 3_600_000).toISOString());
      value.set("to", new Date().toISOString());
    }
    for (const [key, filter] of Object.entries(filters)) if (filter) value.set(key, filter);
    return value;
  }, [filters, range]);

  useEffect(() => {
    let cancelled = false;
    data ? setRefreshing(true) : setLoading(true);
    setError("");
    api(`/admin/reporting/insights?${params}`).then((result) => {
      if (!cancelled) setData(result);
    }).catch((caught) => {
      if (!cancelled) setError(caught.message);
    }).finally(() => {
      if (!cancelled) { setLoading(false); setRefreshing(false); }
    });
    return () => { cancelled = true; };
  }, [params]);

  useEffect(() => { setSelection(null); }, [params]);

  const selected = useMemo(() => new Set(selection?.turnIds || []), [selection]);
  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  return <main className={`insights-page ${refreshing ? "is-refreshing" : ""}`}>
    <header className="insights-header"><div><div className="eyebrow">OPERATING INTELLIGENCE / CURRENT ROWS</div><h1>Insights</h1><p>Find expensive execution patterns, coordination overlap, and evidence-backed ways to tighten agent work.</p></div><div className="insights-asof"><span />{data?.window.dataAsOf ? `Updated ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(data.window.dataAsOf))}` : "Reading reporting data"}</div></header>

    <section className="insight-controls" aria-label="Insight filters"><div className="range-control" role="group" aria-label="Date range">{RANGE_OPTIONS.map((option) => <button key={option.value} className={range === option.value ? "active" : ""} onClick={() => setRange(option.value)}>{option.label}</button>)}</div><div className="insight-selects">
      <label>Repository<select value={filters.repositoryId} onChange={(event) => setFilter("repositoryId", event.target.value)}><option value="">All repositories</option>{data?.facets.repositories.map((item) => <option key={item.value} value={item.value}>{item.label} · {item.count}</option>)}</select></label>
      <label>User<select value={filters.userId} onChange={(event) => setFilter("userId", event.target.value)}><option value="">All users</option>{data?.facets.users.map((item) => <option key={item.value} value={item.value}>{item.label} · {item.count}</option>)}</select></label>
      <label>Model<select value={filters.model} onChange={(event) => setFilter("model", event.target.value)}><option value="">All models</option>{data?.facets.models.map((item) => <option key={item.value} value={item.value}>{item.label} · {item.count}</option>)}</select></label>
      <label>Workload<select value={filters.workload} onChange={(event) => setFilter("workload", event.target.value)}><option value="">All workloads</option>{data?.facets.workloads.map((item) => <option key={item.value} value={item.value}>{item.label} · {item.count}</option>)}</select></label>
      <label>Outcome<select value={filters.outcome} onChange={(event) => setFilter("outcome", event.target.value)}><option value="">All outcomes</option>{data?.facets.outcomes.map((item) => <option key={item.value} value={item.value}>{item.label} · {item.count}</option>)}</select></label>
    </div></section>

    {error && <div className="insights-error"><strong>Insights couldn’t be loaded.</strong><span>{error}</span><button onClick={() => setFilters({ repositoryId: "", userId: "", model: "", workload: "", outcome: "" })}>Reset filters</button></div>}
    {loading && !data ? <InsightsSkeleton /> : data && data.summary.turns === 0 ? <section className="insights-empty"><span>NO SIGNAL</span><h2>No turns match this window</h2><p>Broaden the date range or clear one of the filters. Insights appear after normalized reporting rows are available.</p><button onClick={() => { setRange("all"); setFilters({ repositoryId: "", userId: "", model: "", workload: "", outcome: "" }); }}>Show all reporting data</button></section> : data && <>
      <section className="insight-story-grid"><OpportunityFeed opportunities={data.opportunities} selected={selected} onSelect={setSelection} /><WorkloadRadar groups={data.workloadOutcomes} selected={selected} onSelect={setSelection} /></section>
      <section className="insight-analysis-grid"><OverlapHeatmap overlap={data.overlap} selected={selected} onSelect={setSelection} /><EfficiencyScatter points={data.runPoints} selected={selected} onSelect={setSelection} /></section>
      <OutcomeBars groups={data.workloadOutcomes} selected={selected} onSelect={setSelection} />
      <QualityStrip quality={data.dataQuality} />
      {selection && <DetailRail selection={selection} runs={data.runPoints} onClose={() => setSelection(null)} />}
    </>}
  </main>;
}
