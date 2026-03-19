import { useMemo, useState } from "react";

// Colina Reserve Transfer Explorer
// Single-file React app intended for a Google AI Studio Build app / starter app.
// Paste into App.tsx (or equivalent) and run.
//
// Model assumptions baked into the app:
// - Reserves on Jan 1, 2026: $1.6M
// - UC-owned homes on Jan 1, 2026: 8 of 58
// - Faculty-owned homes on Jan 1, 2026: 50 of 58
// - 43 faculty homes are in the 2046-expiration pool; 7 remain faculty-owned through 2069
// - Starting Jan 1, 2046, UC owns all homes except the 7 homes with 2069 expirations
// - 10% of annual dues are contributed to reserves until the repair year
// - Equal dues per home
// - Benefit is measured in "house-years" during the useful life of the repair
//
// Added control:
// - Useful life (years). This was not in the original control list, but it is
//   required to translate a repair cost into a benefit window.

const TOTAL_HOMES = 58;
const UC_HOMES_2026 = 8;
const UC_HOME_CAP = 51; // after all 2046 homes are UC-owned, 7 faculty homes remain
const INITIAL_RESERVES = 1_600_000;
const MONTHLY_DUES_2026 = 790;
const CLIFF_YEAR = 2046;
const CURRENT_FACULTY_OWNERS = 50;

const YEAR_MIN = 2026;
const YEAR_MAX = 2046;
const RATE_MIN = 0;
const RATE_MAX = 5;
const RATE_STEP = 0.25;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function currency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function ucHomesAtTimeYearsAfter2026(tYears: number, buybackRate: number) {
  const absoluteYear = YEAR_MIN + tYears;
  if (absoluteYear >= CLIFF_YEAR) return UC_HOME_CAP;
  return clamp(UC_HOMES_2026 + buybackRate * tYears, UC_HOMES_2026, UC_HOME_CAP);
}

function monthlyDuesForYear(year: number, annualPctChange: number) {
  const yearsAfter2026 = year - YEAR_MIN;
  return MONTHLY_DUES_2026 * Math.pow(1 + annualPctChange / 100, yearsAfter2026);
}

function integrateUCBenefitHomeYears(
  repairYear: number,
  usefulLifeYears: number,
  buybackRate: number,
) {
  const months = Math.max(1, Math.round(usefulLifeYears * 12));
  let ucHomeYears = 0;

  for (let m = 0; m < months; m += 1) {
    const tYears = (repairYear - YEAR_MIN) + m / 12;
    const ucHomes = ucHomesAtTimeYearsAfter2026(tYears, buybackRate);
    ucHomeYears += ucHomes / 12;
  }

  return ucHomeYears;
}

function accumulateReserveContributions(
  repairYear: number,
  annualPctChange: number,
  buybackRate: number,
  ucInitialReservePct: number,
  reserveContributionRate: number,
) {
  const yearsToAccumulate = Math.max(0, repairYear - YEAR_MIN);
  const months = yearsToAccumulate * 12;

  let totalReserves = INITIAL_RESERVES;
  let ucEmbeddedReserves = INITIAL_RESERVES * (ucInitialReservePct / 100);

  for (let m = 0; m < months; m += 1) {
    const tYears = m / 12;
    const year = YEAR_MIN + Math.floor(m / 12);
    const monthlyDues = monthlyDuesForYear(year, annualPctChange);
    const monthlyReserveContribution = TOTAL_HOMES * monthlyDues * (reserveContributionRate / 100);
    const ucHomes = ucHomesAtTimeYearsAfter2026(tYears, buybackRate);
    const ucShare = ucHomes / TOTAL_HOMES;

    totalReserves += monthlyReserveContribution;
    ucEmbeddedReserves += monthlyReserveContribution * ucShare;
  }

  return { totalReserves, ucEmbeddedReserves };
}

type ScenarioResult = {
  repairYear: number;
  buybackRate: number;
  usefulLifeYears: number;
  cost: number;
  annualPctChange: number;
  ucInitialReservePct: number;
  totalReservesAtRepair: number;
  ucEmbeddedReservesAtRepair: number;
  ucReserveShare: number;
  ucCost: number;
  facultyCost: number;
  ucBenefitShare: number;
  ucBenefit: number;
  facultyBenefit: number;
  ucNet: number;
  facultyNet: number;
  avgPerCurrentFacultyOwner: number;
};

function evaluateScenario(
  repairYear: number,
  buybackRate: number,
  usefulLifeYears: number,
  cost2026: number,
  annualPctChange: number,
  ucInitialReservePct: number,
  costInflationPct: number,
  reserveContributionRate: number,
): ScenarioResult {
  const { totalReserves, ucEmbeddedReserves } = accumulateReserveContributions(
    repairYear,
    annualPctChange,
    buybackRate,
    ucInitialReservePct,
    reserveContributionRate,
  );

  const yearsAfter2026 = repairYear - YEAR_MIN;
  const inflatedCost = cost2026 * Math.pow(1 + costInflationPct / 100, yearsAfter2026);

  const ucReserveShare = clamp(ucEmbeddedReserves / totalReserves, 0, 1);
  const ucCost = inflatedCost * ucReserveShare;
  const facultyCost = inflatedCost - ucCost;

  const totalBenefitHomeYears = TOTAL_HOMES * usefulLifeYears;
  const ucBenefitHomeYears = integrateUCBenefitHomeYears(repairYear, usefulLifeYears, buybackRate);
  const ucBenefitShare = clamp(ucBenefitHomeYears / totalBenefitHomeYears, 0, 1);
  const ucBenefit = inflatedCost * ucBenefitShare;
  const facultyBenefit = inflatedCost - ucBenefit;

  const ucNet = ucBenefit - ucCost;
  const facultyNet = facultyBenefit - facultyCost;
  const avgPerCurrentFacultyOwner = facultyNet / CURRENT_FACULTY_OWNERS;

  return {
    repairYear,
    buybackRate,
    usefulLifeYears,
    cost: inflatedCost,
    annualPctChange,
    ucInitialReservePct,
    totalReservesAtRepair: totalReserves,
    ucEmbeddedReservesAtRepair: ucEmbeddedReserves,
    ucReserveShare,
    ucCost,
    facultyCost,
    ucBenefitShare,
    ucBenefit,
    facultyBenefit,
    ucNet,
    facultyNet,
    avgPerCurrentFacultyOwner,
  };
}

function netToColor(value: number, min: number, max: number) {
  const mid = 0;
  const safeMin = Math.min(min, mid);
  const safeMax = Math.max(max, mid);

  if (value >= 0) {
    const t = safeMax === 0 ? 0 : value / safeMax;
    const r = Math.round(lerp(245, 140, t));
    const g = Math.round(lerp(248, 32, t));
    const b = Math.round(lerp(250, 32, t));
    return `rgb(${r}, ${g}, ${b})`;
  }

  const t = safeMin === 0 ? 0 : value / safeMin;
  const r = Math.round(lerp(239, 30, t));
  const g = Math.round(lerp(68, 110, t));
  const b = Math.round(lerp(68, 180, t));
  return `rgb(${r}, ${g}, ${b})`;
}

function ContourPlot({
  selectedYear,
  selectedRate,
  usefulLifeYears,
  cost2026,
  annualPctChange,
  ucInitialReservePct,
  costInflationPct,
  reserveContributionRate,
}: {
  selectedYear: number;
  selectedRate: number;
  usefulLifeYears: number;
  cost2026: number;
  annualPctChange: number;
  ucInitialReservePct: number;
  costInflationPct: number;
  reserveContributionRate: number;
}) {
  const width = 840;
  const height = 430;
  const margin = { top: 20, right: 100, bottom: 55, left: 70 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const years = Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, i) => YEAR_MIN + i);
  const rates = Array.from(
    { length: Math.round((RATE_MAX - RATE_MIN) / RATE_STEP) + 1 },
    (_, i) => Number((RATE_MIN + i * RATE_STEP).toFixed(2)),
  );

  const grid = useMemo(() => {
    const cells: Array<{ year: number; rate: number; net: number }> = [];
    let min = Infinity;
    let max = -Infinity;

    for (const rate of rates) {
      for (const year of years) {
        const result = evaluateScenario(
          year,
          rate,
          usefulLifeYears,
          cost2026,
          annualPctChange,
          ucInitialReservePct,
          costInflationPct,
          reserveContributionRate,
        );
        min = Math.min(min, result.ucNet);
        max = Math.max(max, result.ucNet);
        cells.push({ year, rate, net: result.ucNet });
      }
    }

    return { cells, min, max };
  }, [years, rates, usefulLifeYears, cost2026, annualPctChange, ucInitialReservePct, costInflationPct, reserveContributionRate]);

  const xStep = plotWidth / years.length;
  const yStep = plotHeight / rates.length;

  const xForYear = (year: number) => margin.left + (year - YEAR_MIN + 0.5) * xStep;
  const yForRate = (rate: number) => margin.top + plotHeight - (rate - RATE_MIN + RATE_STEP / 2) * (plotHeight / (RATE_MAX - RATE_MIN + RATE_STEP));

  const legendHeight = 220;
  const legendX = width - 55;
  const legendY = 60;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full rounded-2xl bg-white shadow-sm border">
      <text x={width / 2} y={16} textAnchor="middle" className="fill-slate-700 text-[13px] font-medium">
        UC return on investment (benefit-cost)
      </text>

      {grid.cells.map((cell) => {
        const x = margin.left + (cell.year - YEAR_MIN) * xStep;
        const y = margin.top + plotHeight - (cell.rate - RATE_MIN + RATE_STEP) * (plotHeight / (RATE_MAX - RATE_MIN + RATE_STEP));

        return (
          <rect
            key={`${cell.year}-${cell.rate}`}
            x={x}
            y={y}
            width={xStep + 0.2}
            height={yStep + 0.2}
            fill={netToColor(cell.net, grid.min, grid.max)}
          />
        );
      })}

      {[0, 1, 2, 3, 4, 5].map((tick) => {
        const y = margin.top + plotHeight - (tick / RATE_MAX) * plotHeight;
        return (
          <g key={`ytick-${tick}`}>
            <line x1={margin.left} x2={margin.left + plotWidth} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
            <text x={margin.left - 10} y={y + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
              {tick.toFixed(0)}
            </text>
          </g>
        );
      })}

      {years.filter((year) => year % 2 === 0).map((year) => {
        const x = xForYear(year);
        return (
          <g key={`xtick-${year}`}>
            <line x1={x} x2={x} y1={margin.top} y2={margin.top + plotHeight} stroke="#f1f5f9" strokeWidth="1" />
            <text x={x} y={height - 20} textAnchor="middle" className="fill-slate-500 text-[10px]">
              {year}
            </text>
          </g>
        );
      })}

      <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} fill="none" stroke="#334155" strokeWidth="1.2" />

      <circle
        cx={xForYear(selectedYear)}
        cy={yForRate(selectedRate)}
        r={6}
        fill="#0f172a"
        stroke="white"
        strokeWidth={2}
      />

      <text x={width / 2} y={height - 2} textAnchor="middle" className="fill-slate-700 text-[12px]">
        Year of repair job
      </text>
      <text
        x={18}
        y={margin.top + plotHeight / 2}
        textAnchor="middle"
        transform={`rotate(-90 18 ${margin.top + plotHeight / 2})`}
        className="fill-slate-700 text-[12px]"
      >
        Average homes per year bought back by UC
      </text>

      <defs>
        <linearGradient id="legendGradient" x1="0" x2="0" y1="1" y2="0">
          <stop offset="0%" stopColor={netToColor(grid.min, grid.min, grid.max)} />
          <stop offset="50%" stopColor={netToColor(0, grid.min, grid.max)} />
          <stop offset="100%" stopColor={netToColor(grid.max, grid.min, grid.max)} />
        </linearGradient>
      </defs>

      <rect x={legendX} y={legendY} width={18} height={legendHeight} fill="url(#legendGradient)" rx={6} />
      <text x={legendX + 24} y={legendY + 4} className="fill-slate-500 text-[10px]">
        {currency(grid.max)}
      </text>
      <text x={legendX + 24} y={legendY + legendHeight / 2 + 4} className="fill-slate-500 text-[10px]">
        {currency(0)}
      </text>
      <text x={legendX + 24} y={legendY + legendHeight} className="fill-slate-500 text-[10px]">
        {currency(grid.min)}
      </text>
    </svg>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}) {
  return (
    <label className="block rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-2 text-sm font-medium text-slate-800">{label}</div>
      <div className="mb-2 text-lg font-semibold text-slate-900">
        {value}
        {suffix ?? ""}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-900"
      />
      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span>
          {min}
          {suffix ?? ""}
        </span>
        <span>
          {max}
          {suffix ?? ""}
        </span>
      </div>
    </label>
  );
}

function MoneyInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <label className="block rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-2 text-sm font-medium text-slate-800">{label}</div>
      <div className="mb-2 text-lg font-semibold text-slate-900">{currency(value)}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-900"
      />
      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span>{currency(min)}</span>
        <span>{currency(max)}</span>
      </div>
    </label>
  );
}

function StatCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {note ? <div className="mt-1 text-xs text-slate-500">{note}</div> : null}
    </div>
  );
}

export default function App() {
  const [ucInitialReservePct, setUcInitialReservePct] = useState(3.125);
  const [annualPctChange, setAnnualPctChange] = useState(0);
  const [reserveContributionRate, setReserveContributionRate] = useState(10);
  const [cost2026, setCost2026] = useState(300_000);
  const [costInflationPct, setCostInflationPct] = useState(3);
  const [repairYear, setRepairYear] = useState(2026);
  const [buybackRate, setBuybackRate] = useState(2.5);
  const [usefulLifeYears, setUsefulLifeYears] = useState(16);

  const result = useMemo(
    () =>
      evaluateScenario(
        repairYear,
        buybackRate,
        usefulLifeYears,
        cost2026,
        annualPctChange,
        ucInitialReservePct,
        costInflationPct,
        reserveContributionRate,
      ),
    [repairYear, buybackRate, usefulLifeYears, cost2026, annualPctChange, ucInitialReservePct, costInflationPct, reserveContributionRate],
  );

  const reserveWarning = result.cost > result.totalReservesAtRepair;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-3xl border bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-semibold tracking-tight">Colina Reserve Transfer Explorer</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Explore how reserve-funded repair spending shifts benefit versus cost between UC and faculty under adjustable assumptions.
            UC return on investment is computed as UC benefit-cost, where benefit is allocated by house-years during the repair’s useful life and cost is allocated by UC’s embedded share of reserves at the repair date.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
              <div className="font-medium text-slate-800">Fixed assumptions</div>
              <div className="mt-2">Reserves on Jan 1, 2026: {currency(INITIAL_RESERVES)}</div>
              <div>UC-owned homes on Jan 1, 2026: {UC_HOMES_2026}</div>
              <div>HOA dues in 2026: {currency(MONTHLY_DUES_2026)}/month</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
              <div className="font-medium text-slate-800">Structural assumptions</div>
              <div className="mt-2">A portion of dues are added to reserves until the repair year.</div>
              <div>Starting in 2046, UC owns all homes except the 7 homes with 2069 expirations.</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
              <div className="font-medium text-slate-800">Faculty metrics</div>
              <div className="mt-2">Aggregate faculty values refer to the non-UC side of the ledger.</div>
              <div>Per-owner values are shown per current faculty-owned home as of Jan 1, 2026 ({CURRENT_FACULTY_OWNERS} homes).</div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[360px,1fr]">
          <div className="space-y-4">
            <NumberInput
              label="UC share of existing $1.6M reserves"
              value={ucInitialReservePct}
              onChange={setUcInitialReservePct}
              min={0}
              max={10}
              step={0.125}
              suffix="%"
            />
            <NumberInput
              label="Annual % change in HOA dues"
              value={annualPctChange}
              onChange={setAnnualPctChange}
              min={-5}
              max={10}
              step={0.25}
              suffix="%"
            />
            <NumberInput
              label="% of dues added to reserves annually"
              value={reserveContributionRate}
              onChange={setReserveContributionRate}
              min={0}
              max={30}
              step={1}
              suffix="%"
            />
            <MoneyInput
              label="Cost of repair job (2026 dollars)"
              value={cost2026}
              onChange={setCost2026}
              min={200_000}
              max={2_000_000}
              step={25_000}
            />
            <NumberInput
              label="Annual inflation rate of repair cost"
              value={costInflationPct}
              onChange={setCostInflationPct}
              min={0}
              max={10}
              step={0.25}
              suffix="%"
            />

            <NumberInput
              label="Year of repair job"
              value={repairYear}
              onChange={setRepairYear}
              min={2026}
              max={2046}
              step={1}
            />
            <NumberInput
              label="Average homes per year bought back by UC"
              value={buybackRate}
              onChange={setBuybackRate}
              min={0}
              max={5}
              step={0.25}
            />
            <NumberInput
              label="Useful life of repair"
              value={usefulLifeYears}
              onChange={setUsefulLifeYears}
              min={5}
              max={30}
              step={1}
            />
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border bg-white p-4 shadow-sm">
              <ContourPlot
                selectedYear={repairYear}
                selectedRate={buybackRate}
                usefulLifeYears={usefulLifeYears}
                cost2026={cost2026}
                annualPctChange={annualPctChange}
                ucInitialReservePct={ucInitialReservePct}
                costInflationPct={costInflationPct}
                reserveContributionRate={reserveContributionRate}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="UC return on investment" value={currency(result.ucNet)} note="Benefit-cost for UC" />
              <StatCard label="UC benefit" value={currency(result.ucBenefit)} note={`${percent(result.ucBenefitShare)} of total benefit`} />
              <StatCard label="UC cost" value={currency(result.ucCost)} note={`${percent(result.ucReserveShare)} of reserves at repair`} />
              <StatCard
                label="Return on investment per faculty homeowner"
                value={currency(result.avgPerCurrentFacultyOwner)}
                note="Benefit-cost per faculty homeowner"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold">Cost side</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <StatCard label="Reserves at repair year" value={currency(result.totalReservesAtRepair)} />
                  <StatCard label="UC embedded reserves" value={currency(result.ucEmbeddedReservesAtRepair)} />
                  <StatCard label="UC cost share" value={currency(result.ucCost)} />
                  <StatCard label="Faculty cost share" value={currency(result.facultyCost)} />
                </div>
                {reserveWarning ? (
                  <div className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800 border border-amber-200">
                    Warning: selected repair cost exceeds projected reserves at the repair date. The model still allocates cost by reserve share, but a real association would need other funding.
                  </div>
                ) : null}
              </div>

              <div className="rounded-3xl border bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold">Benefit side</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <StatCard label="UC benefit" value={currency(result.ucBenefit)} />
                  <StatCard label="Faculty benefit" value={currency(result.facultyBenefit)} />
                  <StatCard label="UC ROI" value={currency(result.ucNet)} />
                  <StatCard label="Faculty ROI" value={currency(result.facultyNet)} />
                </div>
                <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                  <div><span className="font-medium text-slate-800">Selected point:</span> year {repairYear}, buyback rate {buybackRate.toFixed(2)} homes/year</div>
                  <div className="mt-1">Useful life: {usefulLifeYears} years</div>
                  <div>2026-to-repair reserve contributions are modeled at {reserveContributionRate}% of dues with annual dues growth of {annualPctChange.toFixed(2)}%.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
