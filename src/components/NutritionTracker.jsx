/**
 * NutritionTracker.jsx  —  STR/VOL Itemized Food Log
 *
 * Architecture:
 *   Each day owns a `entries` JSONB array in daily_nutrition.
 *   Macro totals are always derived from that array — never set directly.
 *   The macro rings and calorie gauge reflect the live sum of entries
 *   for the currently selected date with zero extra Supabase round-trips.
 *
 * New features vs previous version:
 *   • Itemized Food Log — every food item logged individually, shown as a
 *     named row with per-item macros and a Delete button
 *   • Manual Add form — inline panel for foods without barcodes
 *   • Barcode scanner — same html5-qrcode / Open Food Facts flow, now
 *     creates a structured food-item object and pushes it into entries
 *   • All macro rings / progress bars driven entirely from entries sum
 *
 * Dependencies:
 *   npm install html5-qrcode
 *
 * Supabase helpers (nutrition_itemized_helpers.js):
 *   saveDailyNutrition, logFoodItem, removeFoodItem,
 *   fetchNutritionHistory, deleteNutritionEntry
 *
 * Props:
 *   user  — Supabase User object
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
    saveDailyNutrition,
    removeFoodItem,
    fetchNutritionHistory,
    deleteNutritionEntry,
} from "../lib/supabase";

// ── Default macro targets ──────────────────────────────────────
const DEFAULT_TARGETS = { calories: 2500, protein_g: 180, carbs_g: 280, fats_g: 80 };

// ── Macro colour palette ───────────────────────────────────────
const MACRO_META = [
    { key: "protein_g", label: "PROTEIN", short: "PROT", unit: "g", color: "#60a5fa", trackColor: "#1e3a5f", textColor: "text-blue-400"    },
    { key: "carbs_g",   label: "CARBS",   short: "CARB", unit: "g", color: "#34d399", trackColor: "#064e3b", textColor: "text-emerald-400" },
    { key: "fats_g",    label: "FATS",    short: "FATS", unit: "g", color: "#f472b6", trackColor: "#500724", textColor: "text-pink-400"    },
];

// ── Pure helpers ───────────────────────────────────────────────
const todayISO = () => new Date().toISOString().split("T")[0];
const clamp01  = (v, max) => Math.min(1, Math.max(0, max > 0 ? v / max : 0));
const uuid     = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function fmtDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
}

/** Sum all food-item entries into a single macro total object */
function sumEntries(entries = []) {
    return entries.reduce(
        (acc, item) => ({
            calories:  acc.calories  + (item.calories  ?? 0),
            protein_g: acc.protein_g + (item.protein_g ?? 0),
            carbs_g:   acc.carbs_g   + (item.carbs_g   ?? 0),
            fats_g:    acc.fats_g    + (item.fats_g    ?? 0),
        }),
        { calories: 0, protein_g: 0, carbs_g: 0, fats_g: 0 }
    );
}

function arcPath(cx, cy, r, startAngle, endAngle) {
    const toRad = (deg) => (deg - 90) * (Math.PI / 180);
    const x1 = cx + r * Math.cos(toRad(startAngle));
    const y1 = cy + r * Math.sin(toRad(startAngle));
    const x2 = cx + r * Math.cos(toRad(endAngle));
    const y2 = cy + r * Math.sin(toRad(endAngle));
    const large = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

// ── Spinner ────────────────────────────────────────────────────
function Spinner({ size = 13, className = "" }) {
    return (
        <svg className={`animate-spin ${className}`} width={size} height={size}
             viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round"/>
        </svg>
    );
}

// ── MacroRing ──────────────────────────────────────────────────
function MacroRing({ value, target, meta, size = 76 }) {
    const r      = (size - 12) / 2;
    const cx     = size / 2;
    const cy     = size / 2;
    const pct    = clamp01(value, target);
    const endDeg = pct * 359.99;
    return (
        <div className="flex flex-col items-center gap-1.5">
            <div className="relative" style={{ width: size, height: size }}>
                <svg width={size} height={size} className="absolute inset-0">
                    <circle cx={cx} cy={cy} r={r} fill="none" stroke={meta.trackColor} strokeWidth="6" />
                </svg>
                <svg width={size} height={size} className="absolute inset-0">
                    {pct > 0 && (
                        <path d={arcPath(cx, cy, r, 0, endDeg)}
                              fill="none" stroke={meta.color} strokeWidth="6" strokeLinecap="round" />
                    )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-bold text-sm leading-none" style={{ color: meta.color }}>
                        {Math.round(value)}
                    </span>
                    <span className="text-zinc-600 text-xs leading-none mt-0.5">{meta.unit}</span>
                </div>
            </div>
            <div className="text-center">
                <div className={`text-xs font-bold tracking-widest ${meta.textColor}`}>{meta.label}</div>
                <div className="text-zinc-700 text-xs">/{target}{meta.unit}</div>
            </div>
        </div>
    );
}

// ── CalorieGauge ───────────────────────────────────────────────
function CalorieGauge({ value, target }) {
    const rounded  = Math.round(value);
    const pct      = clamp01(rounded, target) * 100;
    const over     = rounded > target;
    const barColor = over ? "#ef4444" : rounded / target > 0.85 ? "#f59e0b" : "#22c55e";
    return (
        <div className="space-y-1.5">
            <div className="flex justify-between items-baseline">
                <span className="text-zinc-400 text-xs tracking-widest">CALORIES</span>
                <div className="flex items-baseline gap-1">
                    <span className="font-bold text-xl" style={{ color: barColor }}>{rounded.toLocaleString()}</span>
                    <span className="text-zinc-600 text-xs">/ {target.toLocaleString()} kcal</span>
                    {over && <span className="text-red-400 text-xs font-bold ml-1">+{(rounded - target).toLocaleString()} OVER</span>}
                </div>
            </div>
            <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                     style={{ width:`${Math.min(pct,100)}%`, backgroundColor: barColor }} />
            </div>
        </div>
    );
}

// ── MacroSplitBar ──────────────────────────────────────────────
function MacroSplitBar({ totals }) {
    const totalCal = totals.protein_g*4 + totals.carbs_g*4 + totals.fats_g*9;
    if (totalCal === 0) return null;
    return (
        <div className="space-y-1.5 pt-2 border-t border-zinc-800">
            <div className="text-zinc-700 text-xs tracking-widest">MACRO SPLIT</div>
            {MACRO_META.map(m => {
                const cal = m.key === "fats_g" ? totals[m.key]*9 : totals[m.key]*4;
                const pct = totalCal > 0 ? Math.round(cal / totalCal * 100) : 0;
                return (
                    <div key={m.key} className="flex items-center gap-2">
                        <span className="text-xs w-14" style={{ color: m.color }}>{m.label}</span>
                        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500"
                                 style={{ width:`${pct}%`, backgroundColor: m.color }} />
                        </div>
                        <span className="text-zinc-500 text-xs w-8 text-right">{pct}%</span>
                    </div>
                );
            })}
        </div>
    );
}

// ── HistoryChart ───────────────────────────────────────────────
function HistoryChart({ history, targets }) {
    const W = 560, H = 140, PAD = { top:8, right:8, bottom:28, left:40 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    const days = useMemo(() => {
        const result = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const iso = d.toISOString().split("T")[0];
            result.push({ iso, record: history.find(r => r.log_date === iso) ?? null });
        }
        return result;
    }, [history]);

    const maxCal = Math.max(targets.calories * 1.2, ...days.map(d => d.record?.calories ?? 0), 1);
    const colW   = innerW / 7;
    const toY    = (cal) => PAD.top + innerH - (cal / maxCal) * innerH;
    const yTicks = [0, 0.5, 1].map(f => ({ val: Math.round(maxCal * f), y: toY(maxCal * f) }));

    return (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="text-zinc-500 text-xs tracking-widest uppercase mb-3">7-Day Calorie Overview</div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
                {yTicks.map(({ val, y }) => (
                    <g key={val}>
                        <line x1={PAD.left} y1={y} x2={PAD.left+innerW} y2={y} stroke="#27272a" strokeWidth="1" strokeDasharray="4 4" />
                        <text x={PAD.left-5} y={y+4} textAnchor="end" fill="#52525b" fontSize="9" fontFamily="'IBM Plex Mono',monospace">
                            {val === 0 ? "" : `${Math.round(val/100)*100}`}
                        </text>
                    </g>
                ))}
                <line x1={PAD.left} y1={toY(targets.calories)} x2={PAD.left+innerW} y2={toY(targets.calories)}
                      stroke="#f59e0b" strokeWidth="1" strokeDasharray="6 3" strokeOpacity="0.5" />
                {days.map(({ iso, record }, i) => {
                    const x        = PAD.left + i * colW;
                    const cal      = record?.calories ?? 0;
                    const barH     = cal > 0 ? Math.max(2, (cal/maxCal)*innerH) : 0;
                    const barY     = PAD.top + innerH - barH;
                    const isToday  = iso === todayISO();
                    const over     = cal > targets.calories;
                    const barColor = !cal ? "#27272a" : over ? "#ef4444" : "#22c55e";
                    const dayLabel = new Date(iso+"T12:00:00").toLocaleDateString(undefined, { weekday:"short" }).slice(0,2).toUpperCase();
                    return (
                        <g key={iso}>
                            <rect x={x+colW*0.18} y={barY} width={colW*0.64} height={barH} rx="3" fill={barColor} opacity={cal ? 0.85 : 0.3} />
                            {record && barH > 0 && (
                                <rect x={x+colW*0.18} y={barY} width={colW*0.64} height={Math.min(barH*0.22,barH)} rx="3" fill="#60a5fa" opacity="0.4" />
                            )}
                            <text x={x+colW/2} y={H-8} textAnchor="middle"
                                  fill={isToday ? "#f59e0b" : "#52525b"} fontSize="9" fontFamily="'IBM Plex Mono',monospace"
                                  fontWeight={isToday ? "bold" : "normal"}>
                                {dayLabel}
                            </text>
                            {cal > 0 && (
                                <text x={x+colW/2} y={barY-3} textAnchor="middle" fill="#a1a1aa" fontSize="8" fontFamily="'IBM Plex Mono',monospace">
                                    {cal >= 1000 ? `${(cal/1000).toFixed(1)}k` : cal}
                                </text>
                            )}
                        </g>
                    );
                })}
            </svg>
            <div className="flex items-center gap-4 mt-1">
                {[["bg-green-500","Under target"],["bg-red-500","Over target"]].map(([cls,label]) => (
                    <div key={label} className="flex items-center gap-1.5">
                        <span className={`w-3 h-1.5 rounded-full ${cls} inline-block`} />
                        <span className="text-zinc-600 text-xs">{label}</span>
                    </div>
                ))}
                <div className="flex items-center gap-1.5">
                    <span className="w-6 border-t border-dashed border-amber-500/50 inline-block" />
                    <span className="text-zinc-600 text-xs">Target</span>
                </div>
            </div>
        </div>
    );
}

// ── MacroInput ─────────────────────────────────────────────────
function MacroInput({ label, unit, value, onChange, color, placeholder = "0", compact = false }) {
    return (
        <div className="flex flex-col gap-1">
            <label className="text-zinc-600 text-xs tracking-widest">{label}</label>
            <div className="relative">
                <input type="number" min="0" max="9999" value={value} placeholder={placeholder}
                       onChange={e => onChange(e.target.value === "" ? "" : Math.max(0, parseFloat(e.target.value) || 0))}
                       className={`w-full bg-zinc-800 border border-zinc-700 rounded-lg outline-none transition-colors pr-7 ${compact ? "px-2 py-1.5 text-xs" : "px-3 py-2.5 text-sm"}`}
                       style={{ color, caretColor: color,
                           borderColor: value > 0 ? color+"60" : undefined,
                           boxShadow:   value > 0 ? `0 0 0 1px ${color}18` : undefined }} />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 text-xs pointer-events-none">{unit}</span>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────
// ── FoodItemRow  ──────────────────────────────────────────────────
//  One row in the itemized food log for the selected date.
// ─────────────────────────────────────────────────────────────────
function FoodItemRow({ item, onDelete, deleting }) {
    const macroBar = useMemo(() => {
        const totalCal = item.protein_g*4 + item.carbs_g*4 + item.fats_g*9;
        return totalCal > 0 ? [
            { color:"#60a5fa", pct: item.protein_g*4/totalCal*100 },
            { color:"#34d399", pct: item.carbs_g*4/totalCal*100   },
            { color:"#f472b6", pct: item.fats_g*9/totalCal*100    },
        ] : null;
    }, [item]);

    return (
        <div className="group flex items-center gap-3 px-3 py-2.5 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 transition-colors">
            {/* Left: icon */}
            <div className="w-7 h-7 rounded-md bg-zinc-700/60 flex items-center justify-center shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                    <line x1="7" y1="7" x2="7.01" y2="7"/>
                </svg>
            </div>

            {/* Middle: name + macro strip */}
            <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-zinc-200 text-sm font-bold truncate">{item.name}</span>
                    {item.brand && <span className="text-zinc-600 text-xs shrink-0">{item.brand}</span>}
                    <span className="text-zinc-600 text-xs shrink-0">
                        {item.servings}{item.serving_unit ? ` ${item.serving_unit}` : "×"}
                    </span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs">
                    <span className="text-amber-400 font-bold">{Math.round(item.calories)} kcal</span>
                    <span className="text-zinc-700">·</span>
                    <span className="text-blue-400">{item.protein_g}g P</span>
                    <span className="text-zinc-700">·</span>
                    <span className="text-emerald-400">{item.carbs_g}g C</span>
                    <span className="text-zinc-700">·</span>
                    <span className="text-pink-400">{item.fats_g}g F</span>
                </div>
                {macroBar && (
                    <div className="flex h-1 rounded-full overflow-hidden bg-zinc-700 mt-1.5 gap-px">
                        {macroBar.map((s, i) => (
                            <div key={i} style={{ width:`${s.pct}%`, backgroundColor: s.color }} />
                        ))}
                    </div>
                )}
            </div>

            {/* Right: delete */}
            <button onClick={() => onDelete(item.id)} disabled={deleting}
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-zinc-700 hover:text-red-400 hover:bg-red-950/40 transition-colors disabled:opacity-40 opacity-0 group-hover:opacity-100">
                {deleting ? <Spinner size={11} className="text-zinc-600" /> : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                    </svg>
                )}
            </button>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────
// ── ManualAddPanel ────────────────────────────────────────────────
//  Inline collapsible form for logging a food without a barcode.
// ─────────────────────────────────────────────────────────────────
function ManualAddPanel({ onAdd, onClose }) {
    const [name,      setName]      = useState("");
    const [calories,  setCalories]  = useState("");
    const [proteinG,  setProteinG]  = useState("");
    const [carbsG,    setCarbsG]    = useState("");
    const [fatsG,     setFatsG]     = useState("");
    const [servings,  setServings]  = useState("1");
    const nameRef = useRef(null);

    useEffect(() => { nameRef.current?.focus(); }, []);

    const canSubmit = name.trim() && (calories || proteinG || carbsG || fatsG);

    const handleSubmit = () => {
        if (!canSubmit) return;
        const qty = parseFloat(servings) || 1;
        const round1 = v => Math.round((parseFloat(v) || 0) * qty * 10) / 10;
        onAdd({
            id:          uuid(),
            name:        name.trim(),
            brand:       "",
            calories:    Math.round((parseFloat(calories) || 0) * qty),
            protein_g:   round1(proteinG),
            carbs_g:     round1(carbsG),
            fats_g:      round1(fatsG),
            servings:    qty,
            serving_unit: "serving",
            timestamp:   new Date().toISOString(),
        });
    };

    return (
        <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-4 space-y-4"
             style={{ fontFamily:"'IBM Plex Mono',monospace" }}>
            <div className="flex items-center justify-between">
                <span className="text-amber-400 text-xs font-bold tracking-widest">MANUAL ENTRY</span>
                <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg leading-none transition-colors">×</button>
            </div>

            {/* Name */}
            <div className="flex flex-col gap-1">
                <label className="text-zinc-600 text-xs tracking-widest">FOOD NAME</label>
                <input ref={nameRef} type="text" value={name} onChange={e => setName(e.target.value)}
                       onKeyDown={e => e.key === "Enter" && canSubmit && handleSubmit()}
                       placeholder="e.g. Chicken breast, Brown rice…" maxLength={80}
                       className="bg-zinc-800 border border-zinc-700 focus:border-amber-500 rounded-lg px-3 py-2.5 text-zinc-100 text-sm outline-none transition-colors placeholder-zinc-600" />
            </div>

            {/* Servings + Calories row */}
            <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                    <label className="text-zinc-600 text-xs tracking-widest">SERVINGS</label>
                    <input type="number" min="0.1" step="0.5" value={servings}
                           onChange={e => setServings(e.target.value)}
                           className="bg-zinc-800 border border-zinc-700 focus:border-amber-500 rounded-lg px-3 py-2.5 text-amber-300 text-sm outline-none transition-colors" />
                </div>
                <MacroInput label="CALORIES" unit="kcal" color="#f59e0b" value={calories} onChange={setCalories} />
            </div>

            {/* Macro grid */}
            <div className="grid grid-cols-3 gap-3">
                <MacroInput label="PROTEIN" unit="g" color="#60a5fa" value={proteinG} onChange={setProteinG} />
                <MacroInput label="CARBS"   unit="g" color="#34d399" value={carbsG}   onChange={setCarbsG}   />
                <MacroInput label="FATS"    unit="g" color="#f472b6" value={fatsG}    onChange={setFatsG}    />
            </div>

            <p className="text-zinc-700 text-xs">Values above are per serving. Total = value × servings.</p>

            <button onClick={handleSubmit} disabled={!canSubmit}
                    className={`w-full py-2.5 text-sm font-bold rounded-lg transition-colors tracking-widest
                    ${canSubmit ? "bg-amber-500 hover:bg-amber-400 text-zinc-900" : "bg-zinc-800 text-zinc-600 cursor-not-allowed"}`}>
                ADD TO LOG
            </button>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────
// ── BarcodeScannerModal ───────────────────────────────────────────
//  Phases: scanning → fetching → confirm → error
// ─────────────────────────────────────────────────────────────────
function BarcodeScannerModal({ onAdd, onClose }) {
    const SCANNER_DIV = "barcode-scanner-viewport";
    const scannerRef  = useRef(null);

    const [phase,     setPhase]     = useState("scanning");
    const [errorMsg,  setErrorMsg]  = useState("");
    const [product,   setProduct]   = useState(null);
    const [servings,  setServings]  = useState("1");
    const [cameraErr, setCameraErr] = useState("");

    // ── Start scanner on mount ────────────────────────────────
    useEffect(() => {
        let stopped = false;
        (async () => {
            try {
                const { Html5Qrcode } = await import("html5-qrcode");
                if (stopped) return;
                const scanner = new Html5Qrcode(SCANNER_DIV);
                scannerRef.current = scanner;
                await scanner.start(
                    { facingMode: "environment" },
                    { fps:10, qrbox:{ width:260, height:140 }, aspectRatio:1.6,
                        formatsToSupport:[0,8,9,11,12,1] },
                    (text) => { handleDetected(text); },
                    () => {}
                );
            } catch (err) {
                if (!stopped) setCameraErr(
                    err?.message?.includes("Permission")
                        ? "Camera permission denied. Please allow camera access."
                        : `Camera error: ${err?.message ?? "unknown"}`
                );
            }
        })();
        return () => {
            stopped = true;
            scannerRef.current?.stop().catch(() => {});
            scannerRef.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const stopScanner = useCallback(async () => {
        if (scannerRef.current) {
            await scannerRef.current.stop().catch(() => {});
            scannerRef.current = null;
        }
    }, []);

    // ── Barcode detected ──────────────────────────────────────
    const handleDetected = useCallback(async (barcode) => {
        setPhase("fetching");
        await stopScanner();
        try {
            const res  = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
            const json = await res.json();
            if (json.status !== 1 || !json.product) {
                setErrorMsg(`No product found for barcode ${barcode}.\nTry again or use Manual Entry.`);
                setPhase("error"); return;
            }
            const p    = json.product;
            const n    = p.nutriments ?? {};
            const cal100  = n["energy-kcal_100g"] ?? (n["energy_100g"] ? Math.round(n["energy_100g"]/4.184) : 0);
            const prot100 = n["proteins_100g"]      ?? n["protein_100g"]      ?? 0;
            const carb100 = n["carbohydrates_100g"] ?? n["carbohydrate_100g"] ?? 0;
            const fat100  = n["fat_100g"]           ?? n["fats_100g"]         ?? 0;
            const servingG = p.serving_quantity ? parseFloat(p.serving_quantity) : null;
            setProduct({
                name:        p.product_name || p.product_name_en || `Barcode ${barcode}`,
                brand:       p.brands || "",
                cal100:      Math.round(cal100),
                prot100:     Math.round(prot100*10)/10,
                carb100:     Math.round(carb100*10)/10,
                fat100:      Math.round(fat100*10)/10,
                servingG,
                servingUnit: servingG ? "serving" : "g",
            });
            setServings(servingG ? "1" : "100");
            setPhase("confirm");
        } catch (err) {
            setErrorMsg(`Network error: ${err?.message ?? "Could not reach Open Food Facts."}`);
            setPhase("error");
        }
    }, [stopScanner]);

    // ── Preview macros for current serving quantity ───────────
    const preview = useMemo(() => {
        if (!product) return null;
        const qty    = parseFloat(servings) || 0;
        const factor = product.servingG ? (product.servingG * qty) / 100 : qty / 100;
        return {
            calories:  Math.round(product.cal100  * factor),
            protein_g: Math.round(product.prot100 * factor * 10) / 10,
            carbs_g:   Math.round(product.carb100 * factor * 10) / 10,
            fats_g:    Math.round(product.fat100  * factor * 10) / 10,
        };
    }, [product, servings]);

    const handleAdd = () => {
        if (!preview || !product) return;
        const qty = parseFloat(servings) || 1;
        onAdd({
            id:          uuid(),
            name:        product.name,
            brand:       product.brand,
            calories:    preview.calories,
            protein_g:   preview.protein_g,
            carbs_g:     preview.carbs_g,
            fats_g:      preview.fats_g,
            servings:    qty,
            serving_unit: product.servingG ? "serving" : "g",
            timestamp:   new Date().toISOString(),
        });
    };

    const handleRetry = async () => {
        setPhase("scanning"); setErrorMsg(""); setProduct(null); setCameraErr("");
        try {
            const { Html5Qrcode } = await import("html5-qrcode");
            const scanner = new Html5Qrcode(SCANNER_DIV);
            scannerRef.current = scanner;
            await scanner.start(
                { facingMode:"environment" },
                { fps:10, qrbox:{ width:260, height:140 }, aspectRatio:1.6 },
                (text) => { handleDetected(text); },
                () => {}
            );
        } catch (err) {
            setCameraErr(`Camera error: ${err?.message ?? "unknown"}`);
        }
    };

    // ── Helpers for confirm UI ────────────────────────────────
    const nudgeServings = (delta) =>
        setServings(s => String(Math.max(0.25, Math.round((parseFloat(s||1)+delta)*4)/4)));

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
             style={{ fontFamily:"'IBM Plex Mono',monospace" }}>
            <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                 style={{ maxHeight:"90vh" }}>

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950 shrink-0">
                    <div>
                        <div className="text-amber-400 font-bold text-sm tracking-wide flex items-center gap-2">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <rect x="3" y="3" width="18" height="18" rx="2"/>
                                <path d="M7 7h.01M7 12h.01M7 17h.01M12 7h.01M12 12h.01M12 17h.01M17 7h.01M17 12h.01M17 17h.01"/>
                            </svg>
                            SCAN FOOD
                        </div>
                        <div className="text-zinc-600 text-xs mt-0.5">
                            {phase === "scanning" ? "Point camera at a barcode" :
                                phase === "fetching" ? "Looking up product…" :
                                    phase === "confirm"  ? "Confirm & add to log" : "Scan error"}
                        </div>
                    </div>
                    <button onClick={onClose}
                            className="text-zinc-600 hover:text-zinc-200 text-xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800 transition-colors">×</button>
                </div>

                <div className="overflow-y-auto flex-1">

                    {/* SCANNING / FETCHING */}
                    {(phase === "scanning" || phase === "fetching") && (
                        <div className="flex flex-col">
                            <div className="relative bg-zinc-950 w-full" style={{ minHeight:240 }}>
                                {cameraErr ? (
                                    <div className="flex items-center justify-center p-8 text-center">
                                        <p className="text-red-400 text-sm">{cameraErr}</p>
                                    </div>
                                ) : (
                                    <>
                                        <div id={SCANNER_DIV} className="w-full" />
                                        {phase === "scanning" && (
                                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                                <div className="relative w-64 h-36">
                                                    {["top-0 left-0 border-t-2 border-l-2 rounded-tl-lg",
                                                        "top-0 right-0 border-t-2 border-r-2 rounded-tr-lg",
                                                        "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg",
                                                        "bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg",
                                                    ].map((cls,i) => (
                                                        <div key={i} className={`absolute w-7 h-7 border-amber-400 ${cls}`} />
                                                    ))}
                                                    <div className="absolute inset-x-2 h-0.5 bg-amber-400/60 rounded-full animate-bounce" style={{ top:"50%" }} />
                                                </div>
                                            </div>
                                        )}
                                        {phase === "fetching" && (
                                            <div className="absolute inset-0 bg-zinc-950/80 flex flex-col items-center justify-center gap-3">
                                                <Spinner size={28} className="text-amber-500" />
                                                <span className="text-amber-400 text-sm tracking-widest">LOOKING UP PRODUCT…</span>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                            <div className="px-5 py-4 text-center text-zinc-600 text-xs">
                                Supported: EAN-13, EAN-8, UPC-A, UPC-E, Code-128
                            </div>
                        </div>
                    )}

                    {/* CONFIRM */}
                    {phase === "confirm" && product && (
                        <div className="px-5 py-5 space-y-5">
                            {/* Product card */}
                            <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
                                            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                                            <line x1="7" y1="7" x2="7.01" y2="7"/>
                                        </svg>
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-zinc-100 font-bold text-sm leading-tight">{product.name}</div>
                                        {product.brand && <div className="text-zinc-500 text-xs mt-0.5">{product.brand}</div>}
                                        <div className="text-zinc-600 text-xs mt-1.5">
                                            Per 100g: {product.cal100} kcal · {product.prot100}g P · {product.carb100}g C · {product.fat100}g F
                                        </div>
                                        {product.servingG && (
                                            <div className="text-zinc-600 text-xs">
                                                Serving = {product.servingG}g
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Serving stepper */}
                            <div className="space-y-2">
                                <label className="text-zinc-500 text-xs tracking-widest">
                                    {product.servingG ? `SERVINGS (1 serving = ${product.servingG}g)` : "AMOUNT (grams)"}
                                </label>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => nudgeServings(product.servingG ? -0.5 : -25)}
                                            className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-zinc-300 text-lg font-bold flex items-center justify-center transition-colors">−</button>
                                    <input type="number" min="0.1" step={product.servingG ? "0.5" : "10"}
                                           value={servings} onChange={e => setServings(e.target.value)}
                                           className="flex-1 bg-zinc-800 border border-amber-500/40 rounded-lg px-3 py-2.5 text-amber-300 text-center font-bold text-base outline-none" />
                                    <button onClick={() => nudgeServings(product.servingG ? 0.5 : 25)}
                                            className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-zinc-300 text-lg font-bold flex items-center justify-center transition-colors">+</button>
                                </div>
                            </div>

                            {/* Preview */}
                            {preview && (
                                <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-4 space-y-3">
                                    <div className="text-zinc-500 text-xs tracking-widest">WILL BE ADDED AS</div>
                                    <div className="grid grid-cols-4 gap-2 text-center">
                                        <div><div className="text-zinc-500 text-xs">KCAL</div>
                                            <div className="text-amber-400 font-bold text-lg leading-tight">{preview.calories}</div></div>
                                        <div><div className="text-zinc-500 text-xs">PROT</div>
                                            <div className="text-blue-400 font-bold text-lg leading-tight">{preview.protein_g}<span className="text-xs text-zinc-600 font-normal">g</span></div></div>
                                        <div><div className="text-zinc-500 text-xs">CARB</div>
                                            <div className="text-emerald-400 font-bold text-lg leading-tight">{preview.carbs_g}<span className="text-xs text-zinc-600 font-normal">g</span></div></div>
                                        <div><div className="text-zinc-500 text-xs">FATS</div>
                                            <div className="text-pink-400 font-bold text-lg leading-tight">{preview.fats_g}<span className="text-xs text-zinc-600 font-normal">g</span></div></div>
                                    </div>
                                    {(preview.protein_g + preview.carbs_g + preview.fats_g) > 0 && (() => {
                                        const tc = preview.protein_g*4 + preview.carbs_g*4 + preview.fats_g*9;
                                        return (
                                            <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-700 gap-px">
                                                {[[preview.protein_g*4,"#60a5fa"],[preview.carbs_g*4,"#34d399"],[preview.fats_g*9,"#f472b6"]].map(([c,col],i) => (
                                                    <div key={i} style={{ width:`${tc>0?c/tc*100:0}%`, backgroundColor:col }} className="transition-all duration-300" />
                                                ))}
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}

                            <div className="flex gap-3 pb-1">
                                <button onClick={handleRetry}
                                        className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs font-bold rounded-lg transition-colors tracking-widest border border-zinc-700">
                                    ← RESCAN
                                </button>
                                <button onClick={handleAdd}
                                        className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-900 text-sm font-bold rounded-lg transition-colors tracking-widest">
                                    ADD TO LOG
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ERROR */}
                    {phase === "error" && (
                        <div className="px-5 py-8 flex flex-col items-center gap-5 text-center">
                            <div className="w-14 h-14 rounded-full bg-red-950/40 border border-red-900 flex items-center justify-center">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                                </svg>
                            </div>
                            <div className="text-red-400 text-sm whitespace-pre-line">{errorMsg}</div>
                            <div className="flex gap-3 w-full">
                                <button onClick={handleRetry}
                                        className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold rounded-lg transition-colors tracking-widest">
                                    TRY AGAIN
                                </button>
                                <button onClick={onClose}
                                        className="flex-1 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-400 text-xs font-bold rounded-lg transition-colors tracking-widest">
                                    CANCEL
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────
// ── DayHistoryRow  ────────────────────────────────────────────────
//  Compact summary row in the "past days" section at the bottom.
// ─────────────────────────────────────────────────────────────────
function DayHistoryRow({ record, onDeleteDay, deleting }) {
    const entryCount = record.entries?.length ?? 0;
    return (
        <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg p-3.5 transition-colors">
            <div className="flex items-start justify-between gap-3 mb-2.5">
                <div>
                    <div className="text-zinc-200 font-bold text-sm">{fmtDate(record.log_date)}</div>
                    <div className="text-zinc-600 text-xs mt-0.5">
                        {entryCount} item{entryCount !== 1 ? "s" : ""}
                        {record.notes && <span className="ml-2 italic">{record.notes}</span>}
                    </div>
                </div>
                <button onClick={() => onDeleteDay(record.id)} disabled={deleting}
                        className="text-zinc-600 hover:text-red-400 text-xs border border-zinc-700 hover:border-red-800 rounded px-2 py-1 transition-colors disabled:opacity-40">
                    {deleting ? "…" : "DEL"}
                </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
                <div className="bg-zinc-800 rounded px-2 py-1.5 text-center">
                    <div className="text-zinc-500 text-xs">KCAL</div>
                    <div className="text-amber-400 font-bold text-sm leading-tight">{(record.calories ?? 0).toLocaleString()}</div>
                </div>
                {MACRO_META.map(m => (
                    <div key={m.key} className="bg-zinc-800 rounded px-2 py-1.5 text-center">
                        <div className="text-zinc-500 text-xs">{m.short}</div>
                        <div className="font-bold text-sm leading-tight" style={{ color: m.color }}>
                            {Math.round(record[m.key] ?? 0)}<span className="text-zinc-600 text-xs font-normal">g</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────
// ── TargetsEditor ─────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
function TargetsEditor({ targets, onSave, onClose }) {
    const [draft, setDraft] = useState(targets);
    return (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 space-y-3">
            <div className="text-zinc-400 text-xs tracking-widest uppercase mb-1">Daily Macro Targets</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MacroInput label="CALORIES" unit="kcal" color="#f59e0b" value={draft.calories}
                            onChange={v => setDraft(t => ({ ...t, calories: parseInt(v) || 0 }))} />
                <MacroInput label="PROTEIN" unit="g" color="#60a5fa" value={draft.protein_g}
                            onChange={v => setDraft(t => ({ ...t, protein_g: parseInt(v) || 0 }))} />
                <MacroInput label="CARBS" unit="g" color="#34d399" value={draft.carbs_g}
                            onChange={v => setDraft(t => ({ ...t, carbs_g: parseInt(v) || 0 }))} />
                <MacroInput label="FATS" unit="g" color="#f472b6" value={draft.fats_g}
                            onChange={v => setDraft(t => ({ ...t, fats_g: parseInt(v) || 0 }))} />
            </div>
            <div className="flex gap-2 pt-1">
                <button onClick={() => onSave(draft)}
                        className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-900 text-xs font-bold rounded-lg transition-colors tracking-widest">
                    SAVE TARGETS
                </button>
                <button onClick={onClose}
                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs font-bold rounded-lg transition-colors">
                    CANCEL
                </button>
            </div>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════
// ── Main NutritionTracker ─────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════
export default function NutritionTracker({ user }) {
    // ── Date selection ────────────────────────────────────────
    const [logDate, setLogDate] = useState(todayISO);

    // ── The full history from Supabase ────────────────────────
    //  Each record: { id, log_date, entries: [...], calories, protein_g, carbs_g, fats_g, notes }
    const [history,    setHistory]    = useState([]);
    const [loading,    setLoading]    = useState(true);
    const [saving,     setSaving]     = useState(false);
    const [deletingItemId, setDeletingItemId] = useState(null);  // food item uuid
    const [deletingDayId,  setDeletingDayId]  = useState(null);  // row uuid
    const [toast,      setToast]      = useState(null);
    const [globalErr,  setGlobalErr]  = useState(null);

    // ── UI panels ─────────────────────────────────────────────
    const [showScanner,  setShowScanner]  = useState(false);
    const [showManual,   setShowManual]   = useState(false);
    const [showTargets,  setShowTargets]  = useState(false);

    // ── Targets (kept in React state; could be persisted) ─────
    const [targets, setTargets] = useState(DEFAULT_TARGETS);

    const showToast = useCallback((msg, isError = false) => {
        setToast({ msg, isError });
        setTimeout(() => setToast(null), 2800);
    }, []);

    // ── Initial data fetch ────────────────────────────────────
    useEffect(() => {
        setLoading(true);
        fetchNutritionHistory(30)
            .then(({ data, error: err }) => {
                if (err) { setGlobalErr(err.message); return; }
                setHistory(data ?? []);
            })
            .catch(e => setGlobalErr(e.message))
            .finally(() => setLoading(false));
    }, []);

    // ── Current day's record (or null) ────────────────────────
    const todayRecord = useMemo(
        () => history.find(r => r.log_date === logDate) ?? null,
        [history, logDate]
    );

    // ── Entries for the selected date ─────────────────────────
    const entries = useMemo(
        () => todayRecord?.entries ?? [],
        [todayRecord]
    );

    // ── Live macro totals — derived entirely from entries ─────
    const totals = useMemo(() => sumEntries(entries), [entries]);

    // ── Optimistically update history with a new record ───────
    const patchHistory = useCallback((newRecord) => {
        setHistory(prev => {
            const idx = prev.findIndex(r => r.log_date === newRecord.log_date);
            if (idx >= 0) {
                const next = [...prev];
                next[idx]  = newRecord;
                return next;
            }
            return [newRecord, ...prev].sort((a,b) => b.log_date.localeCompare(a.log_date));
        });
    }, []);

    // ── Save the current entries array to Supabase ─────────────
    const persistEntries = useCallback(async (newEntries, notes = todayRecord?.notes ?? null) => {
        setSaving(true);
        try {
            const { data, error: err } = await saveDailyNutrition({
                log_date: logDate,
                entries:  newEntries,
                notes,
            });
            if (err) throw err;
            patchHistory(data);
            return data;
        } catch (e) {
            showToast(`Save failed: ${e.message}`, true);
            return null;
        } finally {
            setSaving(false);
        }
    }, [logDate, todayRecord, patchHistory, showToast]);

    // ── Add a food item (from scanner OR manual entry) ─────────
    const handleAddItem = useCallback(async (item) => {
        setShowScanner(false);
        setShowManual(false);
        const newEntries = [...entries, item];
        const saved = await persistEntries(newEntries);
        if (saved) showToast(`${item.name} added ✓`);
    }, [entries, persistEntries, showToast]);

    // ── Delete a single food item by its uuid ─────────────────
    const handleDeleteItem = useCallback(async (itemId) => {
        setDeletingItemId(itemId);
        try {
            const newEntries = entries.filter(e => e.id !== itemId);
            const saved = await persistEntries(newEntries);
            if (saved) showToast("Item removed.");
        } finally {
            setDeletingItemId(null);
        }
    }, [entries, persistEntries, showToast]);

    // ── Delete an entire day's record ─────────────────────────
    const handleDeleteDay = useCallback(async (rowId) => {
        if (!confirm("Delete this entire day's food log?")) return;
        setDeletingDayId(rowId);
        try {
            const { error: err } = await deleteNutritionEntry(rowId);
            if (err) throw err;
            setHistory(prev => prev.filter(r => r.id !== rowId));
            showToast("Day deleted.");
        } catch (e) {
            showToast(`Delete failed: ${e.message}`, true);
        } finally {
            setDeletingDayId(null);
        }
    }, [showToast]);

    const isToday = logDate === todayISO();

    // ── Rendering ─────────────────────────────────────────────
    return (
        <div className="space-y-5" style={{ fontFamily:"'IBM Plex Mono',monospace" }}>

            {/* Toast */}
            {toast && (
                <div className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded text-sm font-bold shadow-xl animate-pulse
                    ${toast.isError ? "bg-red-500 text-white" : "bg-amber-500 text-zinc-900"}`}>
                    {toast.msg}
                </div>
            )}

            {/* Modals */}
            {showScanner && <BarcodeScannerModal onAdd={handleAddItem} onClose={() => setShowScanner(false)} />}

            {/* ── Page header ── */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-zinc-300 font-bold text-base tracking-tight">Nutrition & Macros</div>
                    <div className="text-zinc-600 text-xs mt-0.5">Itemized food log · per-day entries</div>
                </div>
                <button onClick={() => setShowTargets(t => !t)}
                        className="flex items-center gap-2 text-xs text-zinc-500 hover:text-amber-400 border border-zinc-700 hover:border-amber-500/40 rounded-lg px-3 py-1.5 transition-colors">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
                    </svg>
                    TARGETS
                </button>
            </div>

            {/* Targets editor (collapsible) */}
            {showTargets && (
                <TargetsEditor
                    targets={targets}
                    onSave={(t) => { setTargets(t); setShowTargets(false); showToast("Targets updated ✓"); }}
                    onClose={() => setShowTargets(false)} />
            )}

            {/* ── Date picker ── */}
            <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1 flex-1">
                    <label className="text-zinc-600 text-xs tracking-widest">DATE</label>
                    <input type="date" value={logDate} max={todayISO()}
                           onChange={e => { setLogDate(e.target.value); setShowManual(false); }}
                           className="bg-zinc-900 border border-zinc-700 focus:border-amber-500 rounded-lg px-3 py-2.5 text-zinc-200 text-sm outline-none transition-colors w-full" />
                </div>
                {!isToday && (
                    <button onClick={() => setLogDate(todayISO())}
                            className="self-end mb-0.5 py-2.5 px-3 text-xs text-zinc-500 hover:text-amber-400 border border-zinc-700 hover:border-amber-500/40 rounded-lg transition-colors">
                        TODAY
                    </button>
                )}
            </div>

            {/* ── Macro progress panel ── */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <div className="text-zinc-500 text-xs tracking-widest uppercase">
                        {isToday ? "Today's Progress" : `Progress · ${fmtDate(logDate)}`}
                    </div>
                    {saving && (
                        <div className="flex items-center gap-1.5 text-zinc-600 text-xs">
                            <Spinner size={11} className="text-amber-500" /> saving…
                        </div>
                    )}
                </div>

                <CalorieGauge value={totals.calories} target={targets.calories} />

                <div className="flex justify-around">
                    {MACRO_META.map(m => (
                        <MacroRing key={m.key} value={totals[m.key]} target={targets[m.key]} meta={m} size={76} />
                    ))}
                </div>

                <MacroSplitBar totals={totals} />
            </div>

            {/* ── Food Log for selected date ── */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">

                {/* Log header + action buttons */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950">
                    <div>
                        <div className="text-zinc-300 text-sm font-bold">
                            {isToday ? "Today's Food Log" : `Food Log · ${fmtDate(logDate)}`}
                        </div>
                        <div className="text-zinc-600 text-xs mt-0.5">
                            {entries.length} item{entries.length !== 1 ? "s" : ""}
                            {entries.length > 0 && (
                                <span className="ml-2 text-zinc-700">
                                    · {Math.round(totals.calories).toLocaleString()} kcal total
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Manual add button */}
                        <button
                            onClick={() => { setShowManual(s => !s); setShowScanner(false); }}
                            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors tracking-wide
                                ${showManual
                                ? "bg-zinc-700 border-zinc-600 text-zinc-200"
                                : "bg-zinc-800 border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"}`}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                            </svg>
                            MANUAL
                        </button>
                        {/* Scan button */}
                        <button
                            onClick={() => { setShowScanner(true); setShowManual(false); }}
                            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/50 transition-colors tracking-wide">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <rect x="3" y="3" width="18" height="18" rx="2"/>
                                <path d="M7 7h.01M7 12h.01M7 17h.01M12 7h.01M12 12h.01M12 17h.01M17 7h.01M17 12h.01M17 17h.01"/>
                            </svg>
                            SCAN
                        </button>
                    </div>
                </div>

                {/* Manual add panel (inline, collapsible) */}
                {showManual && (
                    <div className="px-4 py-4 border-b border-zinc-800 bg-zinc-950/40">
                        <ManualAddPanel onAdd={handleAddItem} onClose={() => setShowManual(false)} />
                    </div>
                )}

                {/* Food item list */}
                <div className="p-3 space-y-1.5">
                    {loading && (
                        <div className="flex items-center justify-center py-10 gap-2 text-zinc-600 text-xs">
                            <Spinner size={13} className="text-amber-500" /> Loading…
                        </div>
                    )}

                    {!loading && entries.length === 0 && (
                        <div className="text-center py-10 space-y-3">
                            <div className="text-zinc-700 text-sm">No food logged for this day.</div>
                            <div className="flex items-center justify-center gap-2">
                                <button onClick={() => setShowScanner(true)}
                                        className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors">
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                                        <path d="M7 7h.01M7 12h.01M7 17h.01M12 7h.01M12 12h.01M12 17h.01M17 7h.01M17 12h.01M17 17h.01"/>
                                    </svg>
                                    SCAN A BARCODE
                                </button>
                                <span className="text-zinc-700 text-xs">or</span>
                                <button onClick={() => setShowManual(true)}
                                        className="text-xs font-bold px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
                                    ENTER MANUALLY
                                </button>
                            </div>
                        </div>
                    )}

                    {entries.map(item => (
                        <FoodItemRow
                            key={item.id}
                            item={item}
                            onDelete={handleDeleteItem}
                            deleting={deletingItemId === item.id} />
                    ))}

                    {/* Day total footer — only shown when there are items */}
                    {entries.length > 0 && (
                        <div className="flex items-center justify-between px-3 py-2 mt-1 border-t border-zinc-800 text-xs">
                            <span className="text-zinc-600 tracking-widest">DAY TOTAL</span>
                            <div className="flex items-center gap-3">
                                <span className="text-amber-400 font-bold">{Math.round(totals.calories).toLocaleString()} kcal</span>
                                <span className="text-zinc-700">·</span>
                                <span className="text-blue-400">{Math.round(totals.protein_g)}g P</span>
                                <span className="text-zinc-700">·</span>
                                <span className="text-emerald-400">{Math.round(totals.carbs_g)}g C</span>
                                <span className="text-zinc-700">·</span>
                                <span className="text-pink-400">{Math.round(totals.fats_g)}g F</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ── 7-day history chart ── */}
            {!loading && <HistoryChart history={history} targets={targets} />}

            {/* ── Past-day summary list (excludes the currently viewed date) ── */}
            {(() => {
                const pastDays = history.filter(r => r.log_date !== logDate);
                if (loading || pastDays.length === 0) return null;
                return (
                    <div className="space-y-2">
                        <div className="text-zinc-500 text-xs tracking-widest uppercase">Past Days</div>
                        {globalErr && (
                            <div className="text-red-400 text-xs px-3 py-2 bg-red-950/40 border border-red-900 rounded-lg">{globalErr}</div>
                        )}
                        {pastDays.map(record => (
                            <DayHistoryRow
                                key={record.id}
                                record={record}
                                onDeleteDay={handleDeleteDay}
                                deleting={deletingDayId === record.id} />
                        ))}
                    </div>
                );
            })()}
        </div>
    );
}