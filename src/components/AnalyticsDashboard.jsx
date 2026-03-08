/**
 * AnalyticsDashboard.jsx  —  STR/VOL Weekly Analytics
 *
 * Visualises the relationship between training volume, sleep,
 * and nutrition across the last 30–60 days.
 *
 * Charts (all via recharts):
 *   1. Volume vs. Sleep  — ComposedChart (Bar + Line)
 *   2. Calories vs. Target — AreaChart with reference line
 *   3. Weekly Volume Trend — AreaChart (7-day rolling average)
 *   4. Macro Split Trend — StackedBar (protein / carbs / fats)
 *
 * Summary cards:
 *   Avg Weekly Volume · Avg Sleep · Avg Calories · Training Days
 *
 * Supabase helper required (append to src/lib/supabase.js):
 *   fetchAnalyticsData
 *
 * Props:
 *   user            — Supabase User object (display only)
 *   calorieTarget   — number, default 2500 (passed from parent
 *                     or hardcoded; no Supabase column for it)
 */

import { useState, useEffect, useMemo } from "react";
import {
    ComposedChart,
    AreaChart,
    BarChart,
    Bar,
    Area,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ReferenceLine,
    ResponsiveContainer,
} from "recharts";
import { fetchAnalyticsData } from "../lib/supabase";

// ── Theme tokens ───────────────────────────────────────────────
const C = {
    volume:    "#f59e0b",   // amber-500
    sleep:     "#818cf8",   // indigo-400
    calories:  "#34d399",   // emerald-400
    protein:   "#60a5fa",   // blue-400
    carbs:     "#34d399",   // emerald-400
    fats:      "#f472b6",   // pink-400
    target:    "#f43f5e",   // rose-500
    grid:      "#27272a",   // zinc-800
    axis:      "#52525b",   // zinc-600
    tooltip:   "#18181b",   // zinc-900
    border:    "#3f3f46",   // zinc-700
    bg:        "#09090b",   // zinc-950
    cardBg:    "#18181b",   // zinc-900
};

const FONT = "'IBM Plex Mono', monospace";

// ── Shared recharts style objects ──────────────────────────────
const axisStyle  = { fill: C.axis, fontSize: 10, fontFamily: FONT };
const gridProps  = { stroke: C.grid, strokeDasharray: "3 3" };
const legendStyle = { fontSize: 10, fontFamily: FONT };

// ── Tooltip wrapper ────────────────────────────────────────────
function DarkTooltip({ active, payload, label, unit = "", valueFormatter }) {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            background: C.tooltip, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "10px 14px", fontFamily: FONT,
        }}>
            <p style={{ color: C.axis, fontSize: 10, marginBottom: 6 }}>{label}</p>
            {payload.map((p, i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap: 8, marginBottom: 2 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, display:"inline-block" }} />
                    <span style={{ color: "#a1a1aa", fontSize: 10 }}>{p.name}</span>
                    <span style={{ color: "#f4f4f5", fontSize: 11, fontWeight: "bold", marginLeft: "auto", paddingLeft: 12 }}>
            {valueFormatter ? valueFormatter(p.value, p.name) : `${p.value}${unit}`}
          </span>
                </div>
            ))}
        </div>
    );
}

// ── Summary stat card ──────────────────────────────────────────
function StatCard({ label, value, sub, color = C.volume, icon }) {
    return (
        <div style={{
            background: C.cardBg, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: "16px 20px",
            borderLeft: `3px solid ${color}`,
        }}>
            <div style={{ display:"flex", alignItems:"center", gap: 8, marginBottom: 8 }}>
                {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
                <span style={{ color: C.axis, fontSize: 10, letterSpacing: "0.1em", fontFamily: FONT }}>
          {label}
        </span>
            </div>
            <div style={{ color, fontSize: 26, fontWeight: "bold", fontFamily: FONT, lineHeight: 1 }}>
                {value}
            </div>
            {sub && (
                <div style={{ color: "#52525b", fontSize: 10, fontFamily: FONT, marginTop: 4 }}>{sub}</div>
            )}
        </div>
    );
}

// ── Section header ─────────────────────────────────────────────
function SectionHeader({ title, sub }) {
    return (
        <div style={{ marginBottom: 12 }}>
            <div style={{ color: "#d4d4d8", fontSize: 12, fontWeight: "bold", fontFamily: FONT, letterSpacing: "0.05em" }}>
                {title}
            </div>
            {sub && <div style={{ color: C.axis, fontSize: 10, fontFamily: FONT, marginTop: 2 }}>{sub}</div>}
        </div>
    );
}

// ── Chart card wrapper ─────────────────────────────────────────
function ChartCard({ title, sub, children, height = 240 }) {
    return (
        <div style={{
            background: C.cardBg, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: "20px 16px 12px",
        }}>
            <SectionHeader title={title} sub={sub} />
            <div style={{ height }}>{children}</div>
        </div>
    );
}

// ── Range selector ─────────────────────────────────────────────
function RangeSelector({ value, onChange }) {
    return (
        <div style={{ display:"flex", gap: 4 }}>
            {[
                { label:"30D", days: 30 },
                { label:"60D", days: 60 },
            ].map(({ label, days }) => (
                <button key={days} onClick={() => onChange(days)}
                        style={{
                            padding: "4px 12px", fontSize: 10, fontFamily: FONT,
                            borderRadius: 6, border: `1px solid ${value === days ? C.volume : C.border}`,
                            background: value === days ? C.volume + "20" : "transparent",
                            color: value === days ? C.volume : C.axis,
                            fontWeight: value === days ? "bold" : "normal",
                            cursor: "pointer", letterSpacing: "0.08em",
                            transition: "all 0.15s",
                        }}>
                    {label}
                </button>
            ))}
        </div>
    );
}

// ── Insight pill ───────────────────────────────────────────────
function Insight({ text, color = C.volume }) {
    return (
        <div style={{
            display:"inline-flex", alignItems:"center", gap: 6,
            background: color + "14", border: `1px solid ${color}30`,
            borderRadius: 20, padding: "4px 10px",
            color, fontSize: 10, fontFamily: FONT,
        }}>
            <span style={{ width: 5, height: 5, borderRadius:"50%", background: color }} />
            {text}
        </div>
    );
}

// ── Date formatting helpers ────────────────────────────────────
/** "2024-03-15" → "Mar 15" */
const shortDate = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month:"short", day:"numeric" });
};

/** "2024-03-15T..." → "YYYY-WW" ISO week key for grouping */
function isoWeekKey(dateStr) {
    const d = new Date(dateStr);
    const jan4 = new Date(d.getFullYear(), 0, 4);
    const week = Math.ceil(((d - jan4) / 86400000 + jan4.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Week key → "Mon 10 Mar" label */
function weekLabel(key) {
    const [year, wStr] = key.split("-W");
    const week = parseInt(wStr);
    const jan4 = new Date(parseInt(year), 0, 4);
    const weekStart = new Date(jan4.getTime() + (week - 1) * 7 * 86400000);
    return weekStart.toLocaleDateString(undefined, { month:"short", day:"numeric" });
}

// ── Main component ─────────────────────────────────────────────
export default function AnalyticsDashboard({ user, calorieTarget = 2500 }) {
    const [range, setRange]     = useState(30);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);
    const [raw, setRaw]         = useState({ sessions: [], nutrition: [] });

    // ── Fetch ────────────────────────────────────────────────────
    useEffect(() => {
        setLoading(true);
        setError(null);
        fetchAnalyticsData(range)
            .then(({ sessions, nutrition, error: err }) => {
                if (err) { setError(err.message); return; }
                setRaw({ sessions, nutrition });
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [range]);

    // ── Build a unified daily map ────────────────────────────────
    const dailyMap = useMemo(() => {
        const map = {};

        // Index sessions by date (YYYY-MM-DD)
        for (const s of raw.sessions) {
            const key = s.session_date.split("T")[0];
            if (!map[key]) map[key] = { date: key };
            // Sum volume if multiple sessions on same day (rare but possible)
            map[key].volume    = (map[key].volume ?? 0) + Number(s.total_volume_kg);
            map[key].sleep     = s.sleep_hours != null ? Number(s.sleep_hours) : map[key].sleep ?? null;
            map[key].trainDay  = true;
        }

        // Index nutrition by date
        for (const n of raw.nutrition) {
            const key = n.log_date;
            if (!map[key]) map[key] = { date: key };
            map[key].calories  = Number(n.calories);
            map[key].protein_g = Number(n.protein_g);
            map[key].carbs_g   = Number(n.carbs_g);
            map[key].fats_g    = Number(n.fats_g);
        }

        return map;
    }, [raw]);

    // ── Daily series — sorted chronologically ───────────────────
    const dailySeries = useMemo(() =>
            Object.values(dailyMap)
                .sort((a, b) => a.date.localeCompare(b.date))
                .map(d => ({ ...d, dateLabel: shortDate(d.date) })),
        [dailyMap]
    );

    // ── Weekly aggregates ────────────────────────────────────────
    const weeklySeries = useMemo(() => {
        const weeks = {};
        for (const d of dailySeries) {
            const wk = isoWeekKey(d.date);
            if (!weeks[wk]) weeks[wk] = { week: wk, volume: 0, calories: [], sleep: [], days: 0 };
            if (d.volume)   weeks[wk].volume   += d.volume;
            if (d.calories) weeks[wk].calories.push(d.calories);
            if (d.sleep != null) weeks[wk].sleep.push(d.sleep);
            weeks[wk].days++;
        }
        return Object.entries(weeks)
            .sort(([a],[b]) => a.localeCompare(b))
            .map(([wk, v]) => ({
                week:       weekLabel(wk),
                volume:     Math.round(v.volume),
                avgCal:     v.calories.length ? Math.round(v.calories.reduce((a,x)=>a+x,0)/v.calories.length) : null,
                avgSleep:   v.sleep.length    ? +(v.sleep.reduce((a,x)=>a+x,0)/v.sleep.length).toFixed(1)     : null,
                days:       v.days,
            }));
    }, [dailySeries]);

    // ── 30-day averages for summary cards ───────────────────────
    const stats = useMemo(() => {
        const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recent = dailySeries.filter(d => new Date(d.date) >= thirtyDaysAgo);

        const trainDays  = recent.filter(d => d.trainDay).length;
        const totalVol   = recent.reduce((a, d) => a + (d.volume ?? 0), 0);
        const sleepArr   = recent.filter(d => d.sleep != null).map(d => d.sleep);
        const calArr     = recent.filter(d => d.calories).map(d => d.calories);

        const avgWeekVol = trainDays > 0 ? Math.round((totalVol / 30) * 7) : 0;
        const avgSleep   = sleepArr.length ? +(sleepArr.reduce((a,x)=>a+x,0)/sleepArr.length).toFixed(1) : null;
        const avgCal     = calArr.length   ? Math.round(calArr.reduce((a,x)=>a+x,0)/calArr.length)       : null;

        // Correlation hint: sessions where prior-day sleep >= 7.5
        const goodSleepSessions = recent.filter(d => {
            const prevKey = new Date(d.date); prevKey.setDate(prevKey.getDate()-1);
            const prev = dailyMap[prevKey.toISOString().split("T")[0]];
            return d.trainDay && prev?.sleep >= 7.5;
        });
        const badSleepSessions  = recent.filter(d => {
            const prevKey = new Date(d.date); prevKey.setDate(prevKey.getDate()-1);
            const prev = dailyMap[prevKey.toISOString().split("T")[0]];
            return d.trainDay && prev?.sleep != null && prev.sleep < 6;
        });

        const avgVolGoodSleep = goodSleepSessions.length
            ? Math.round(goodSleepSessions.reduce((a,d)=>a+(d.volume??0),0)/goodSleepSessions.length)
            : null;
        const avgVolBadSleep  = badSleepSessions.length
            ? Math.round(badSleepSessions.reduce((a,d)=>a+(d.volume??0),0)/badSleepSessions.length)
            : null;

        return { trainDays, avgWeekVol, avgSleep, avgCal, avgVolGoodSleep, avgVolBadSleep, goodSleepSessions, badSleepSessions };
    }, [dailySeries, dailyMap]);

    // ── Volume vs sleep — show only training days ────────────────
    const volSleepSeries = useMemo(() =>
            dailySeries
                .filter(d => d.trainDay)
                .map(d => ({
                    dateLabel: d.dateLabel,
                    volume:    d.volume ? Math.round(d.volume) : null,
                    sleep:     d.sleep,
                })),
        [dailySeries]
    );

    // ── Calories vs target — all nutrition days ──────────────────
    const calSeries = useMemo(() =>
            dailySeries
                .filter(d => d.calories != null)
                .map(d => ({
                    dateLabel: d.dateLabel,
                    calories:  d.calories,
                    target:    calorieTarget,
                    surplus:   d.calories >= calorieTarget ? d.calories - calorieTarget : 0,
                    deficit:   d.calories < calorieTarget  ? calorieTarget - d.calories : 0,
                })),
        [dailySeries, calorieTarget]
    );

    // ── Macro trend — stacked bars ───────────────────────────────
    const macroSeries = useMemo(() =>
            dailySeries
                .filter(d => d.calories != null)
                .map(d => ({
                    dateLabel: d.dateLabel,
                    protein:   d.protein_g ?? 0,
                    carbs:     d.carbs_g   ?? 0,
                    fats:      d.fats_g    ?? 0,
                })),
        [dailySeries]
    );

    // ── Insights ─────────────────────────────────────────────────
    const insights = useMemo(() => {
        const list = [];
        if (stats.avgSleep !== null) {
            if (stats.avgSleep < 6.5) list.push({ text: `Avg sleep ${stats.avgSleep}h — below optimal`, color: "#f43f5e" });
            else if (stats.avgSleep >= 7.5) list.push({ text: `Avg sleep ${stats.avgSleep}h — well rested`, color: "#34d399" });
        }
        if (stats.avgCal !== null) {
            const diff = stats.avgCal - calorieTarget;
            if (diff < -300)       list.push({ text: `Avg ${Math.abs(diff)} kcal under target — potential recovery gap`, color: "#f43f5e" });
            else if (diff > 200)   list.push({ text: `Avg ${diff} kcal over target — fuelled for growth`, color: "#34d399" });
        }
        if (stats.avgVolGoodSleep != null && stats.avgVolBadSleep != null) {
            const delta = stats.avgVolGoodSleep - stats.avgVolBadSleep;
            if (Math.abs(delta) > 500)
                list.push({ text: `${delta > 0 ? "+" : ""}${Math.round(delta/1000*10)/10}t volume after ${delta>0?"good":"poor"} sleep`, color: delta>0 ? "#34d399" : "#f59e0b" });
        }
        if (stats.trainDays > 0)
            list.push({ text: `${stats.trainDays} training day${stats.trainDays!==1?"s":""} in 30 days`, color: C.volume });
        return list;
    }, [stats, calorieTarget]);

    // ── Render ────────────────────────────────────────────────────
    if (loading) {
        return (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding: "64px 0", gap: 12, fontFamily: FONT }}>
                <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round"/>
                </svg>
                <span style={{ color: C.axis, fontSize: 11, letterSpacing: "0.12em" }}>LOADING ANALYTICS…</span>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ padding: 24, background: "#2d0a0a", border: "1px solid #7f1d1d", borderRadius: 12, fontFamily: FONT }}>
                <p style={{ color: "#f87171", fontSize: 12 }}>Failed to load analytics: {error}</p>
            </div>
        );
    }

    const hasData = dailySeries.length > 0;

    return (
        <div style={{ fontFamily: FONT, display:"flex", flexDirection:"column", gap: 24 }}>

            {/* ── Header row ── */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap: 12 }}>
                <div>
                    <div style={{ color:"#d4d4d8", fontSize: 15, fontWeight:"bold", letterSpacing:"0.03em" }}>
                        Performance Analytics
                    </div>
                    <div style={{ color: C.axis, fontSize: 10, marginTop: 2 }}>
                        Volume · Sleep · Nutrition correlation
                    </div>
                </div>
                <RangeSelector value={range} onChange={setRange} />
            </div>

            {/* ── Insights ── */}
            {insights.length > 0 && (
                <div style={{ display:"flex", flexWrap:"wrap", gap: 8 }}>
                    {insights.map((ins, i) => <Insight key={i} text={ins.text} color={ins.color} />)}
                </div>
            )}

            {!hasData && (
                <div style={{ textAlign:"center", padding:"48px 0", color:"#3f3f46", fontSize: 13, border:"1px dashed #27272a", borderRadius: 12 }}>
                    No data in the last {range} days.<br />
                    <span style={{ color:"#52525b", fontSize: 11 }}>Log some sessions and nutrition entries to see your analytics.</span>
                </div>
            )}

            {hasData && (
                <>
                    {/* ── Summary cards ── */}
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                        <StatCard
                            label="AVG VOLUME / WEEK"
                            value={stats.avgWeekVol > 0 ? `${(stats.avgWeekVol/1000).toFixed(1)}t` : "—"}
                            sub="30-day rolling"
                            color={C.volume}
                            icon="🏋️"
                        />
                        <StatCard
                            label="AVG SLEEP"
                            value={stats.avgSleep != null ? `${stats.avgSleep}h` : "—"}
                            sub={stats.avgSleep != null
                                ? stats.avgSleep >= 7.5 ? "Well rested ✓" : stats.avgSleep >= 6.5 ? "Adequate" : "Below optimal"
                                : "No sleep data"}
                            color={stats.avgSleep == null ? C.axis : stats.avgSleep >= 7.5 ? "#34d399" : stats.avgSleep >= 6.5 ? C.volume : "#f43f5e"}
                            icon="😴"
                        />
                        <StatCard
                            label="AVG CALORIES"
                            value={stats.avgCal != null ? stats.avgCal.toLocaleString() : "—"}
                            sub={stats.avgCal != null
                                ? stats.avgCal >= calorieTarget ? `+${stats.avgCal - calorieTarget} over target` : `${calorieTarget - stats.avgCal} under target`
                                : "No nutrition data"}
                            color={stats.avgCal == null ? C.axis : stats.avgCal >= calorieTarget * 0.9 ? "#34d399" : "#f43f5e"}
                            icon="🍽️"
                        />
                        <StatCard
                            label="TRAINING DAYS"
                            value={stats.trainDays}
                            sub="in last 30 days"
                            color={C.sleep}
                            icon="📅"
                        />
                    </div>

                    {/* ── Chart 1: Volume vs Sleep ── */}
                    {volSleepSeries.length > 0 && (
                        <ChartCard
                            title="VOLUME vs. SLEEP"
                            sub="Bar = session volume (kg) · Line = sleep hours logged that day"
                            height={260}
                        >
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={volSleepSeries} margin={{ top:4, right:16, bottom:4, left:0 }}>
                                    <CartesianGrid {...gridProps} />
                                    <XAxis dataKey="dateLabel" tick={axisStyle} axisLine={{ stroke: C.grid }} tickLine={false} interval="preserveStartEnd" />
                                    <YAxis yAxisId="vol" orientation="left"  tick={axisStyle} axisLine={false} tickLine={false}
                                           tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}t` : v}
                                           label={{ value:"VOL (kg)", angle:-90, position:"insideLeft", fill: C.axis, fontSize:9, fontFamily:FONT, dy: 40 }} />
                                    <YAxis yAxisId="sleep" orientation="right" tick={axisStyle} axisLine={false} tickLine={false}
                                           domain={[0, 12]}
                                           label={{ value:"SLEEP (h)", angle:90, position:"insideRight", fill: C.axis, fontSize:9, fontFamily:FONT, dy:-30 }} />
                                    <Tooltip
                                        content={<DarkTooltip valueFormatter={(v, name) =>
                                            name === "Volume" ? (v >= 1000 ? `${(v/1000).toFixed(2)}t` : `${v}kg`) : `${v}h`
                                        } />}
                                    />
                                    <Legend wrapperStyle={legendStyle} formatter={v => <span style={{ color:"#a1a1aa", fontSize:10, fontFamily:FONT }}>{v}</span>} />
                                    <Bar yAxisId="vol" dataKey="volume" name="Volume" fill={C.volume} fillOpacity={0.8} radius={[3,3,0,0]} maxBarSize={40} />
                                    <Line yAxisId="sleep" dataKey="sleep" name="Sleep" stroke={C.sleep} strokeWidth={2}
                                          dot={{ fill: C.sleep, r: 3, strokeWidth: 0 }} activeDot={{ r:5 }} connectNulls />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </ChartCard>
                    )}

                    {/* ── Chart 2: Weekly Volume Trend ── */}
                    {weeklySeries.length > 1 && (
                        <ChartCard
                            title="WEEKLY VOLUME TREND"
                            sub="Total volume lifted per calendar week"
                            height={220}
                        >
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={weeklySeries} margin={{ top:4, right:16, bottom:4, left:0 }}>
                                    <defs>
                                        <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%"  stopColor={C.volume} stopOpacity={0.3} />
                                            <stop offset="95%" stopColor={C.volume} stopOpacity={0.02} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid {...gridProps} />
                                    <XAxis dataKey="week" tick={axisStyle} axisLine={{ stroke: C.grid }} tickLine={false} />
                                    <YAxis tick={axisStyle} axisLine={false} tickLine={false}
                                           tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}t` : v} />
                                    <Tooltip
                                        content={<DarkTooltip valueFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(2)}t` : `${v}kg`} />}
                                    />
                                    <Area dataKey="volume" name="Weekly Volume" stroke={C.volume} strokeWidth={2.5}
                                          fill="url(#volGrad)" dot={{ fill: C.volume, r:3, strokeWidth:0 }} activeDot={{ r:5 }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </ChartCard>
                    )}

                    {/* ── Chart 3: Calories vs Target ── */}
                    {calSeries.length > 0 && (
                        <ChartCard
                            title="CALORIC INTAKE vs. TARGET"
                            sub={`Dashed line = ${calorieTarget.toLocaleString()} kcal daily target`}
                            height={240}
                        >
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={calSeries} margin={{ top:4, right:16, bottom:4, left:0 }}>
                                    <defs>
                                        <linearGradient id="calGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%"  stopColor={C.calories} stopOpacity={0.25} />
                                            <stop offset="95%" stopColor={C.calories} stopOpacity={0.02} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid {...gridProps} />
                                    <XAxis dataKey="dateLabel" tick={axisStyle} axisLine={{ stroke: C.grid }} tickLine={false} interval="preserveStartEnd" />
                                    <YAxis tick={axisStyle} axisLine={false} tickLine={false}
                                           tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} />
                                    <ReferenceLine y={calorieTarget} stroke={C.target} strokeDasharray="6 3" strokeWidth={1.5}
                                                   label={{ value:"TARGET", position:"right", fill: C.target, fontSize:9, fontFamily:FONT }} />
                                    <Tooltip content={<DarkTooltip valueFormatter={(v) => `${v.toLocaleString()} kcal`} />} />
                                    <Area dataKey="calories" name="Calories" stroke={C.calories} strokeWidth={2}
                                          fill="url(#calGrad)" dot={false} activeDot={{ r:4, fill: C.calories }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </ChartCard>
                    )}

                    {/* ── Chart 4: Macro Split trend ── */}
                    {macroSeries.length > 0 && (
                        <ChartCard
                            title="MACRO SPLIT TREND"
                            sub="Stacked daily intake — Protein · Carbs · Fats (grams)"
                            height={240}
                        >
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={macroSeries} margin={{ top:4, right:16, bottom:4, left:0 }} barSize={macroSeries.length > 20 ? 6 : 12}>
                                    <CartesianGrid {...gridProps} />
                                    <XAxis dataKey="dateLabel" tick={axisStyle} axisLine={{ stroke: C.grid }} tickLine={false} interval="preserveStartEnd" />
                                    <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
                                    <Tooltip content={
                                        <DarkTooltip valueFormatter={(v, name) => `${v}g`} />
                                    } />
                                    <Legend wrapperStyle={legendStyle} formatter={v => <span style={{ color:"#a1a1aa", fontSize:10, fontFamily:FONT }}>{v}</span>} />
                                    <Bar dataKey="protein" name="Protein" stackId="a" fill={C.protein}   fillOpacity={0.9} radius={[0,0,0,0]} />
                                    <Bar dataKey="carbs"   name="Carbs"   stackId="a" fill={C.carbs}     fillOpacity={0.85} />
                                    <Bar dataKey="fats"    name="Fats"    stackId="a" fill={C.fats}      fillOpacity={0.85} radius={[3,3,0,0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </ChartCard>
                    )}

                    {/* ── Sleep quality correlation ── */}
                    {(stats.avgVolGoodSleep != null || stats.avgVolBadSleep != null) && (
                        <div style={{
                            background: C.cardBg, border: `1px solid ${C.border}`,
                            borderRadius: 12, padding: "16px 20px",
                        }}>
                            <SectionHeader title="SLEEP → PERFORMANCE CORRELATION" sub="Avg session volume on days following good (≥7.5h) vs poor (<6h) sleep" />
                            <div style={{ display:"flex", gap: 24, flexWrap:"wrap" }}>
                                {stats.avgVolGoodSleep != null && (
                                    <div>
                                        <div style={{ color: C.axis, fontSize: 10, marginBottom: 4 }}>AFTER GOOD SLEEP (≥7.5h)</div>
                                        <div style={{ color:"#34d399", fontSize: 22, fontWeight:"bold" }}>
                                            {(stats.avgVolGoodSleep/1000).toFixed(2)}t
                                        </div>
                                        <div style={{ color: C.axis, fontSize: 10 }}>{stats.goodSleepSessions.length} session{stats.goodSleepSessions.length!==1?"s":""}</div>
                                    </div>
                                )}
                                {stats.avgVolBadSleep != null && (
                                    <div>
                                        <div style={{ color: C.axis, fontSize: 10, marginBottom: 4 }}>AFTER POOR SLEEP (&lt;6h)</div>
                                        <div style={{ color:"#f43f5e", fontSize: 22, fontWeight:"bold" }}>
                                            {(stats.avgVolBadSleep/1000).toFixed(2)}t
                                        </div>
                                        <div style={{ color: C.axis, fontSize: 10 }}>{stats.badSleepSessions.length} session{stats.badSleepSessions.length!==1?"s":""}</div>
                                    </div>
                                )}
                                {stats.avgVolGoodSleep != null && stats.avgVolBadSleep != null && (() => {
                                    const delta = stats.avgVolGoodSleep - stats.avgVolBadSleep;
                                    const pct   = stats.avgVolBadSleep > 0 ? Math.round(Math.abs(delta) / stats.avgVolBadSleep * 100) : 0;
                                    return (
                                        <div style={{ marginLeft:"auto", textAlign:"right" }}>
                                            <div style={{ color: C.axis, fontSize: 10, marginBottom: 4 }}>DIFFERENCE</div>
                                            <div style={{ color: delta > 0 ? "#34d399" : "#f43f5e", fontSize: 22, fontWeight:"bold" }}>
                                                {delta > 0 ? "+" : ""}{(delta/1000).toFixed(2)}t
                                            </div>
                                            <div style={{ color: C.axis, fontSize: 10 }}>{pct}% {delta>0?"more":"less"} volume</div>
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* Mini visual bar */}
                            {stats.avgVolGoodSleep != null && stats.avgVolBadSleep != null && (() => {
                                const maxV = Math.max(stats.avgVolGoodSleep, stats.avgVolBadSleep);
                                return (
                                    <div style={{ marginTop: 16, display:"flex", flexDirection:"column", gap: 8 }}>
                                        {[
                                            { label:"After good sleep", val: stats.avgVolGoodSleep, color:"#34d399" },
                                            { label:"After poor sleep",  val: stats.avgVolBadSleep,  color:"#f43f5e" },
                                        ].map(({ label, val, color }) => (
                                            <div key={label} style={{ display:"flex", alignItems:"center", gap: 10 }}>
                                                <span style={{ color: C.axis, fontSize: 10, width: 120, flexShrink:0 }}>{label}</span>
                                                <div style={{ flex:1, height: 8, background:"#27272a", borderRadius: 4, overflow:"hidden" }}>
                                                    <div style={{ width:`${(val/maxV)*100}%`, height:"100%", background: color, borderRadius:4, transition:"width 0.6s ease" }} />
                                                </div>
                                                <span style={{ color, fontSize: 10, width: 48, textAlign:"right" }}>{(val/1000).toFixed(2)}t</span>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                </>
            )}
        </div>
    );
}