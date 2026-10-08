'use client';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceLine, Cell,
} from 'recharts';

const INK = '#12211F';
const TEAL = '#0F5B57';
const TEAL_2 = '#5C9B96';
const SIGNAL = '#A82F17';
const LINE = '#DEDCD5';
const MUTED = '#6C7B78';

const axis = { stroke: MUTED, fontSize: 12, tickLine: false };
const tip = {
  contentStyle: {
    border: `1px solid ${LINE}`, borderRadius: 4, fontSize: 13,
    boxShadow: '0 2px 8px rgba(18,33,31,.09)',
  },
  labelStyle: { color: INK, fontWeight: 600 },
};

/** Trend over time. A line, because the eye reads its slope as rate of change. */
export function TrendChart({ data, height = 260, dataKey = 'cases', label = 'Cases' }) {
  if (!data?.length) return <p className="empty">No data for this selection.</p>;
  const step = Math.max(1, Math.ceil(data.length / 12));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 26, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={LINE} vertical={false} />
        <XAxis dataKey="label" {...axis} interval={step - 1} />
        <YAxis {...axis} width={52} />
        <Tooltip {...tip} />
        <Line type="monotone" dataKey={dataKey} name={label} stroke={TEAL}
              strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Ranked magnitudes. Horizontal bars share a baseline, so length is comparable. */
export function BurdenChart({ data, height = 300 }) {
  if (!data?.length) return <p className="empty">No data for this selection.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
        <CartesianGrid stroke={LINE} horizontal={false} />
        <XAxis type="number" {...axis} />
        <YAxis type="category" dataKey="disease_name" width={150} {...axis} />
        <Tooltip {...tip} />
        <Bar dataKey="cases" name="Cases" radius={[0, 2, 2, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.is_notifiable ? SIGNAL : TEAL} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Age and sex. Grouped columns across an ordered category. */
export function DemographicsChart({ data, height = 260 }) {
  if (!data?.length) return <p className="empty">No data for this selection.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={LINE} vertical={false} />
        <XAxis dataKey="age_group" {...axis} />
        <YAxis {...axis} width={52} />
        <Tooltip {...tip} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Male" fill={TEAL} radius={[2, 2, 0, 0]} />
        <Bar dataKey="Female" fill={TEAL_2} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Seasonal profile: the average shape of the year, with observed range. */
export function SeasonalChart({ data, height = 260 }) {
  if (!data?.length) return <p className="empty">Choose a disease to see its seasonal profile.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={LINE} vertical={false} />
        <XAxis dataKey="month" {...axis} />
        <YAxis {...axis} width={52} />
        <Tooltip {...tip} />
        <Bar dataKey="mean" name="Average cases" fill={TEAL} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Same month, this year against last. Two lines on shared axes. */
export function YearOnYearChart({ data, years, height = 260 }) {
  if (!data?.length || !years?.length) return <p className="empty">Not enough history to compare.</p>;
  const colours = [TEAL_2, TEAL];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={LINE} vertical={false} />
        <XAxis dataKey="month" {...axis} />
        <YAxis {...axis} width={52} />
        <Tooltip {...tip} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {years.map((y, i) => (
          <Line key={y} type="monotone" dataKey={y} stroke={colours[i % 2]}
                strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** A single disease against its own threshold, so a breach is visible. */
export function ThresholdChart({ data, threshold, height = 240 }) {
  if (!data?.length) return <p className="empty">No data for this selection.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={LINE} vertical={false} />
        <XAxis dataKey="label" {...axis} interval={Math.max(0, Math.ceil(data.length / 12) - 1)} />
        <YAxis {...axis} width={52} />
        <Tooltip {...tip} />
        {threshold > 0 && (
          <ReferenceLine y={threshold} stroke={SIGNAL} strokeDasharray="5 4"
            label={{ value: 'Alert threshold', position: 'insideTopRight', fill: SIGNAL, fontSize: 11 }} />
        )}
        <Line type="monotone" dataKey="cases" name="Cases" stroke={TEAL}
              strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
