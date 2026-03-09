/**
 * NutritionTracker.jsx  —  STR/VOL Nutrition & Macro Tracker
 *
 * Features:
 *   • Log daily calories + macros (protein, carbs, fats) for any date
 *   • Upsert behaviour — re-logging the same date updates the record
 *   • Barcode scanner (html5-qrcode) → Open Food Facts lookup
 *   • Macro extraction with per-serving multiplier
 *   • Macro target rings + calorie gauge
 *   • 7-day history bar chart
 *   • Delete / edit individual entries
 *
 * Dependencies:
 *   npm install html5-qrcode
 *
 * Props:
 *   user  — Supabase User object (used for display only; auth via client)
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
    saveDailyNutrition,
    fetchNutritionHistory,
    deleteNutritionEntry,
} from "../lib/supabase";

// ── Default macro targets ──────────────────────────────────────
const DEFAULT_TARGETS = { calories: 2500, protein_g: 180, carbs_g: 280, fats_g: 80 };

// ── Macro colour palette ───────────────────────────────────────
const MACRO_META = [
    { key: "protein_g", label: "PROTEIN", unit: "g", color: "#60a5fa", trackColor: "#1e3a5f", textColor: "text-blue-400"    },
    { key: "carbs_g",   label: "CARBS",   unit: "g", color: "#34d399", trackColor: "#064e3b", textColor: "text-emerald-400" },
    { key: "fats_g",    label: "FATS",    unit: "g", color: "#f472b6", trackColor: "#500724", textColor: "text-pink-400"    },
];

// ── Pure helpers ───────────────────────────────────────────────
const todayISO  = () => new Date().toISOString().split("T")[0];
const clamp01   = (v, max) => Math.min(1, Math.max(0, max > 0 ? v / max : 0));

function fmtDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
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

// ── MacroRing ──────────────────────────────────────────────────
function MacroRing({ value, target, meta, size = 72 }) {
    const r   = (size - 12) / 2;
    const cx  = size / 2;
    const cy  = size / 2;
    const pct = clamp01(value, target);
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
                              fill="none" stroke={meta.color} strokeWidth="6" strokeLinecap="round"
                              style={{ transition: "d 0.5s ease" }} />
                    )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-bold text-sm leading-none" style={{ color: meta.color }}>{value}</span>
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
    const pct      = clamp01(value, target) * 100;
    const over     = value > target;
    const barColor = over ? "#ef4444" : value / target > 0.85 ? "#f59e0b" : "#22c55e";
    return (
        <div className="space-y-1.5">
            <div className="flex justify-between items-baseline">
                <span className="text-zinc-400 text-xs tracking-widest">CALORIES</span>
                <div className="flex items-baseline gap-1">
                    <span className="font-bold text-xl" style={{ color: barColor }}>{value.toLocaleString()}</span>
                    <span className="text-zinc-600 text-xs">/ {target.toLocaleString()} kcal</span>
                    {over && <span className="text-red-400 text-xs font-bold ml-1">+{(value - target).toLocaleString()} OVER</span>}
                </div>
            </div>
            <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                     style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }} />
            </div>
        </div>
    );
}

// ── HistoryChart ───────────────────────────────────────────────
function HistoryChart({ entries, targets }) {
    const W = 560, H = 140, PAD = { top: 8, right: 8, bottom: 28, left: 40 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    const days = useMemo(() => {
        const result = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const iso = d.toISOString().split("T")[0];
            result.push({ iso, entry: entries.find(e => e.log_date === iso) ?? null });
        }
        return result;
    }, [entries]);

    const maxCal = Math.max(targets.calories * 1.2, ...days.map(d => d.entry?.calories ?? 0));
    const colW   = innerW / 7;
    const toY    = (cal) => PAD.top + innerH - (cal / maxCal) * innerH;
    const yTicks = [0, 0.5, 1].map(f => ({ val: Math.round(maxCal * f), y: toY(maxCal * f) }));

    return (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="text-zinc-500 text-xs tracking-widest uppercase mb-3">7-Day Calorie Overview</div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
                {yTicks.map(({ val, y }) => (
                    <g key={val}>
                        <line x1={PAD.left} y1={y} x2={PAD.left + innerW} y2={y} stroke="#27272a" strokeWidth="1" strokeDasharray="4 4" />
                        <text x={PAD.left - 5} y={y + 4} textAnchor="end" fill="#52525b" fontSize="9" fontFamily="'IBM Plex Mono',monospace">
                            {val === 0 ? "" : `${Math.round(val/100)*100}`}
                        </text>
                    </g>
                ))}
                <line x1={PAD.left} y1={toY(targets.calories)} x2={PAD.left + innerW} y2={toY(targets.calories)}
                      stroke="#f59e0b" strokeWidth="1" strokeDasharray="6 3" strokeOpacity="0.5" />
                {days.map(({ iso, entry }, i) => {
                    const x        = PAD.left + i * colW;
                    const cal      = entry?.calories ?? 0;
                    const barH     = cal > 0 ? Math.max(2, (cal / maxCal) * innerH) : 0;
                    const barY     = PAD.top + innerH - barH;
                    const isToday  = iso === todayISO();
                    const over     = cal > targets.calories;
                    const barColor = !cal ? "#27272a" : over ? "#ef4444" : "#22c55e";
                    const dayLabel = new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday:"short" }).slice(0,2).toUpperCase();
                    return (
                        <g key={iso}>
                            <rect x={x + colW * 0.18} y={barY} width={colW * 0.64} height={barH} rx="3" fill={barColor} opacity={cal ? 0.85 : 0.3} />
                            {entry && (
                                <rect x={x + colW * 0.18} y={barY} width={colW * 0.64} height={Math.min(barH * 0.22, barH)} rx="3" fill="#60a5fa" opacity="0.4" />
                            )}
                            <text x={x + colW / 2} y={H - 8} textAnchor="middle"
                                  fill={isToday ? "#f59e0b" : "#52525b"} fontSize="9" fontFamily="'IBM Plex Mono',monospace"
                                  fontWeight={isToday ? "bold" : "normal"}>
                                {dayLabel}
                            </text>
                            {cal > 0 && (
                                <text x={x + colW / 2} y={barY - 3} textAnchor="middle" fill="#a1a1aa" fontSize="8" fontFamily="'IBM Plex Mono',monospace">
                                    {cal >= 1000 ? `${(cal/1000).toFixed(1)}k` : cal}
                                </text>
                            )}
                        </g>
                    );
                })}
            </svg>
            <div className="flex items-center gap-4 mt-1">
                <div className="flex items-center gap-1.5">
                    <span className="w-3 h-1.5 rounded-full bg-green-500 inline-block" />
                    <span className="text-zinc-600 text-xs">Under target</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="w-3 h-1.5 rounded-full bg-red-500 inline-block" />
                    <span className="text-zinc-600 text-xs">Over target</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="w-6 border-t border-dashed border-amber-500/50 inline-block" />
                    <span className="text-zinc-600 text-xs">Calorie target</span>
                </div>
            </div>
        </div>
    );
}

// ── MacroInput field ───────────────────────────────────────────
function MacroInput({ label, unit, value, onChange, color, placeholder = "0" }) {
    return (
        <div className="flex flex-col gap-1">
            <label className="text-zinc-600 text-xs tracking-widest">{label}</label>
            <div className="relative">
                <input
                    type="number" min="0" max="9999" value={value}
                    onChange={e => onChange(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value) || 0))}
                    placeholder={placeholder}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm outline-none transition-colors pr-7"
                    style={{
                        color,
                        caretColor: color,
                        borderColor: value > 0 ? color + "60" : undefined,
                        boxShadow: value > 0 ? `0 0 0 1px ${color}18` : undefined,
                    }} />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 text-xs pointer-events-none">{unit}</span>
            </div>
        </div>
    );
}

// ── HistoryRow ─────────────────────────────────────────────────
function HistoryRow({ entry, onDelete, onEdit, deleting }) {
    return (
        <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg p-3.5 transition-colors">
            <div className="flex items-start justify-between gap-3 mb-2.5">
                <div>
                    <div className="text-zinc-200 font-bold text-sm">{fmtDate(entry.log_date)}</div>
                    {entry.notes && <div className="text-zinc-600 text-xs mt-0.5 italic">{entry.notes}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => onEdit(entry)}
                            className="text-zinc-600 hover:text-amber-400 text-xs border border-zinc-700 hover:border-amber-500/40 rounded px-2 py-1 transition-colors">
                        EDIT
                    </button>
                    <button onClick={() => onDelete(entry.id)} disabled={deleting}
                            className="text-zinc-600 hover:text-red-400 text-xs border border-zinc-700 hover:border-red-800 rounded px-2 py-1 transition-colors disabled:opacity-40">
                        {deleting ? "…" : "DEL"}
                    </button>
                </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
                <div className="bg-zinc-800 rounded px-2 py-1.5 text-center">
                    <div className="text-zinc-500 text-xs">KCAL</div>
                    <div className="text-amber-400 font-bold text-sm leading-tight">{(entry.calories ?? 0).toLocaleString()}</div>
                </div>
                {MACRO_META.map(m => (
                    <div key={m.key} className="bg-zinc-800 rounded px-2 py-1.5 text-center">
                        <div className="text-zinc-500 text-xs">{m.label.slice(0,4)}</div>
                        <div className="font-bold text-sm leading-tight" style={{ color: m.color }}>
                            {entry[m.key] ?? 0}<span className="text-zinc-600 text-xs font-normal">g</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════
// ── BarcodeScannerModal ────────────────────────────────────────
//
// Lifecycle:
//   phase "scanning"    — camera active, waiting for barcode
//   phase "fetching"    — barcode detected, calling Open Food Facts
//   phase "confirm"     — product data shown, user picks serving size
//   phase "error"       — something went wrong (shows message)
// ══════════════════════════════════════════════════════════════
function BarcodeScannerModal({ onAdd, onClose }) {
    const scannerDivId = "barcode-scanner-viewport";
    const scannerRef   = useRef(null);   // Html5Qrcode instance
    const [phase,      setPhase]   = useState("scanning"); // scanning | fetching | confirm | error
    const [errorMsg,   setErrorMsg] = useState("");
    const [product,    setProduct]  = useState(null);  // { name, calories100, protein100, carbs100, fats100, servingKcal }
    const [servings,   setServings] = useState("1");
    const [cameraErr,  setCameraErr] = useState("");

    // ── Start the Html5Qrcode scanner ─────────────────────────
    useEffect(() => {
        let scanner = null;
        let stopped = false;

        async function startScanner() {
            try {
                // Dynamic import so the app doesn't crash if the package isn't installed yet
                const { Html5Qrcode } = await import("html5-qrcode");
                if (stopped) return;

                scanner = new Html5Qrcode(scannerDivId);
                scannerRef.current = scanner;

                await scanner.start(
                    { facingMode: "environment" },
                    {
                        fps: 10,
                        qrbox: { width: 260, height: 140 },
                        aspectRatio: 1.6,
                        formatsToSupport: [
                            // EAN-13, EAN-8, UPC-A, UPC-E cover essentially all retail food barcodes
                            0,  // QR_CODE (keep for convenience)
                            8,  // EAN_13
                            9,  // EAN_8
                            11, // UPC_A
                            12, // UPC_E
                            1,  // CODE_128 — covers longer US barcodes
                        ],
                    },
                    (decodedText) => {
                        // Barcode detected — hand off to fetch phase
                        if (phase === "scanning") {
                            handleBarcodeDetected(decodedText);
                        }
                    },
                    (_err) => {
                        // Per-frame scan errors are normal and can be ignored
                    }
                );
            } catch (err) {
                if (!stopped) {
                    setCameraErr(
                        err?.message?.includes("Permission")
                            ? "Camera permission denied. Please allow camera access and try again."
                            : `Camera error: ${err?.message ?? "unknown"}`
                    );
                }
            }
        }

        startScanner();

        return () => {
            stopped = true;
            if (scannerRef.current) {
                scannerRef.current.stop().catch(() => {});
                scannerRef.current = null;
            }
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Stop scanner cleanly ───────────────────────────────────
    const stopScanner = useCallback(async () => {
        if (scannerRef.current) {
            await scannerRef.current.stop().catch(() => {});
            scannerRef.current = null;
        }
    }, []);

    // ── Barcode detected → fetch from Open Food Facts ──────────
    const handleBarcodeDetected = useCallback(async (barcode) => {
        setPhase("fetching");
        await stopScanner();

        try {
            const res  = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
            const json = await res.json();

            if (json.status !== 1 || !json.product) {
                setErrorMsg(`No product found for barcode ${barcode}.\nTry scanning again or enter macros manually.`);
                setPhase("error");
                return;
            }

            const p   = json.product;
            const n   = p.nutriments ?? {};

            // Open Food Facts stores values per 100g as "energy-kcal_100g" etc.
            // Fall back to "energy_100g" (kJ) → convert, or 0 if nothing found.
            const cal100  = n["energy-kcal_100g"]
                ?? (n["energy_100g"] ? Math.round(n["energy_100g"] / 4.184) : 0);
            const prot100 = n["proteins_100g"]      ?? n["protein_100g"]      ?? 0;
            const carb100 = n["carbohydrates_100g"] ?? n["carbohydrate_100g"] ?? 0;
            const fat100  = n["fat_100g"]           ?? n["fats_100g"]         ?? 0;

            // Serving size in grams if provided — used to suggest a sensible default
            const servingG = p.serving_quantity ? parseFloat(p.serving_quantity) : null;

            const productName = p.product_name || p.product_name_en || `Barcode ${barcode}`;

            setProduct({
                name:      productName,
                brand:     p.brands || "",
                cal100:    Math.round(cal100),
                prot100:   Math.round(prot100 * 10) / 10,
                carb100:   Math.round(carb100 * 10) / 10,
                fat100:    Math.round(fat100  * 10) / 10,
                servingG,
                // Pre-compute "per serving" numbers if serving size is available
                servingKcal:  servingG ? Math.round(cal100  * servingG / 100) : null,
                servingProt:  servingG ? Math.round(prot100 * servingG / 100 * 10) / 10 : null,
                servingCarb:  servingG ? Math.round(carb100 * servingG / 100 * 10) / 10 : null,
                servingFat:   servingG ? Math.round(fat100  * servingG / 100 * 10) / 10 : null,
            });

            // Default the multiplier to grams (100g = 1 "serving" unit) unless a serving size exists
            setServings(servingG ? "1" : "100");
            setPhase("confirm");
        } catch (err) {
            setErrorMsg(`Network error: ${err?.message ?? "Could not reach Open Food Facts."}`);
            setPhase("error");
        }
    }, [stopScanner]);

    // ── Build the preview macros based on current serving input ─
    const preview = useMemo(() => {
        if (!product) return null;
        const qty = parseFloat(servings) || 0;
        if (product.servingG) {
            // qty = number of servings
            const factor = (product.servingG * qty) / 100;
            return {
                calories:  Math.round(product.cal100  * factor),
                protein_g: Math.round(product.prot100 * factor * 10) / 10,
                carbs_g:   Math.round(product.carb100 * factor * 10) / 10,
                fats_g:    Math.round(product.fat100  * factor * 10) / 10,
            };
        } else {
            // qty = grams
            const factor = qty / 100;
            return {
                calories:  Math.round(product.cal100  * factor),
                protein_g: Math.round(product.prot100 * factor * 10) / 10,
                carbs_g:   Math.round(product.carb100 * factor * 10) / 10,
                fats_g:    Math.round(product.fat100  * factor * 10) / 10,
            };
        }
    }, [product, servings]);

    const handleAdd = () => {
        if (preview) onAdd(preview);
    };

    const handleRetry = async () => {
        setPhase("scanning");
        setErrorMsg("");
        setProduct(null);

        // Re-mount scanner
        try {
            const { Html5Qrcode } = await import("html5-qrcode");
            const scanner = new Html5Qrcode(scannerDivId);
            scannerRef.current = scanner;
            await scanner.start(
                { facingMode: "environment" },
                { fps: 10, qrbox: { width: 260, height: 140 }, aspectRatio: 1.6 },
                (decodedText) => { handleBarcodeDetected(decodedText); },
                () => {}
            );
        } catch (err) {
            setCameraErr(`Camera error: ${err?.message ?? "unknown"}`);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
             style={{ fontFamily:"'IBM Plex Mono',monospace" }}>
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={onClose} />

            <div className="relative w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                 style={{ maxHeight:"90vh" }}>

                {/* ── Header ── */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950 shrink-0">
                    <div>
                        <div className="text-amber-400 font-bold text-sm tracking-wide flex items-center gap-2">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h.01M7 12h.01M7 17h.01M12 7h.01M12 12h.01M12 17h.01M17 7h.01M17 12h.01M17 17h.01"/>
                            </svg>
                            SCAN FOOD
                        </div>
                        <div className="text-zinc-600 text-xs mt-0.5">
                            {phase === "scanning" ? "Point camera at a barcode" :
                                phase === "fetching" ? "Looking up product…" :
                                    phase === "confirm"  ? "Confirm & add to log" :
                                        "Scan error"}
                        </div>
                    </div>
                    <button onClick={onClose}
                            className="text-zinc-600 hover:text-zinc-200 text-xl leading-none transition-colors w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800">
                        ×
                    </button>
                </div>

                <div className="overflow-y-auto flex-1">

                    {/* ══ SCANNING PHASE ══ */}
                    {(phase === "scanning" || phase === "fetching") && (
                        <div className="flex flex-col">
                            {/* Camera viewport */}
                            <div className="relative bg-zinc-950 w-full" style={{ minHeight: 240 }}>
                                {cameraErr ? (
                                    <div className="flex items-center justify-center p-8 text-center">
                                        <div className="space-y-3">
                                            <svg className="mx-auto text-zinc-700" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                <path d="M23 7l-7-5-3 7.5L10 2 3 9l2.5 3L1 16l4 1-1 6 6-3 1 4 4-7 4 3V7z"/>
                                            </svg>
                                            <p className="text-red-400 text-sm">{cameraErr}</p>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {/* html5-qrcode mounts its video element here */}
                                        <div id={scannerDivId} className="w-full" />

                                        {/* Scanning frame overlay */}
                                        {phase === "scanning" && !cameraErr && (
                                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                                <div className="relative w-64 h-36">
                                                    {/* Corner brackets */}
                                                    {[
                                                        "top-0 left-0 border-t-2 border-l-2 rounded-tl-lg",
                                                        "top-0 right-0 border-t-2 border-r-2 rounded-tr-lg",
                                                        "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg",
                                                        "bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg",
                                                    ].map((cls, i) => (
                                                        <div key={i} className={`absolute w-7 h-7 border-amber-400 ${cls}`} />
                                                    ))}
                                                    {/* Scan line */}
                                                    <div className="absolute inset-x-2 h-0.5 bg-amber-400/60 rounded-full animate-bounce" style={{ top: "50%" }} />
                                                </div>
                                            </div>
                                        )}

                                        {/* Fetching overlay */}
                                        {phase === "fetching" && (
                                            <div className="absolute inset-0 bg-zinc-950/80 flex flex-col items-center justify-center gap-3">
                                                <svg className="animate-spin text-amber-500" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                    <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round"/>
                                                </svg>
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

                    {/* ══ CONFIRM PHASE ══ */}
                    {phase === "confirm" && product && (
                        <div className="px-5 py-5 space-y-5">
                            {/* Product identity */}
                            <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
                                            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                                            <line x1="7" y1="7" x2="7.01" y2="7"/>
                                        </svg>
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-zinc-100 font-bold text-sm leading-tight truncate">{product.name}</div>
                                        {product.brand && <div className="text-zinc-500 text-xs mt-0.5">{product.brand}</div>}
                                        <div className="text-zinc-600 text-xs mt-1.5">
                                            Per 100g: {product.cal100} kcal · {product.prot100}g P · {product.carb100}g C · {product.fat100}g F
                                        </div>
                                        {product.servingG && (
                                            <div className="text-zinc-600 text-xs">
                                                Per serving ({product.servingG}g): {product.servingKcal} kcal · {product.servingProt}g P · {product.servingCarb}g C · {product.servingFat}g F
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Serving input */}
                            <div className="space-y-2">
                                <label className="text-zinc-500 text-xs tracking-widest">
                                    {product.servingG ? `SERVINGS (1 serving = ${product.servingG}g)` : "AMOUNT (grams)"}
                                </label>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setServings(s => String(Math.max(0.25, parseFloat(s || 1) - (product.servingG ? 0.5 : 25))))}
                                            className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-zinc-300 text-lg font-bold flex items-center justify-center transition-colors">
                                        −
                                    </button>
                                    <input
                                        type="number" min="0.1" step={product.servingG ? "0.5" : "10"}
                                        value={servings}
                                        onChange={e => setServings(e.target.value)}
                                        className="flex-1 bg-zinc-800 border border-amber-500/40 rounded-lg px-3 py-2.5 text-amber-300 text-center font-bold text-base outline-none" />
                                    <button onClick={() => setServings(s => String(parseFloat(s || 1) + (product.servingG ? 0.5 : 25)))}
                                            className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-zinc-300 text-lg font-bold flex items-center justify-center transition-colors">
                                        +
                                    </button>
                                </div>
                            </div>

                            {/* Live macro preview */}
                            {preview && (
                                <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-4 space-y-3">
                                    <div className="text-zinc-500 text-xs tracking-widest">WILL ADD TO FORM</div>
                                    <div className="grid grid-cols-4 gap-2">
                                        <div className="text-center">
                                            <div className="text-zinc-500 text-xs">KCAL</div>
                                            <div className="text-amber-400 font-bold text-lg leading-tight">{preview.calories}</div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-zinc-500 text-xs">PROT</div>
                                            <div className="text-blue-400 font-bold text-lg leading-tight">{preview.protein_g}<span className="text-xs text-zinc-600 font-normal">g</span></div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-zinc-500 text-xs">CARB</div>
                                            <div className="text-emerald-400 font-bold text-lg leading-tight">{preview.carbs_g}<span className="text-xs text-zinc-600 font-normal">g</span></div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-zinc-500 text-xs">FATS</div>
                                            <div className="text-pink-400 font-bold text-lg leading-tight">{preview.fats_g}<span className="text-xs text-zinc-600 font-normal">g</span></div>
                                        </div>
                                    </div>
                                    {/* Mini macro bar */}
                                    {(preview.protein_g + preview.carbs_g + preview.fats_g) > 0 && (() => {
                                        const totalCal = preview.protein_g*4 + preview.carbs_g*4 + preview.fats_g*9;
                                        const segs = [
                                            { color:"#60a5fa", pct: totalCal > 0 ? preview.protein_g*4/totalCal*100 : 0 },
                                            { color:"#34d399", pct: totalCal > 0 ? preview.carbs_g*4/totalCal*100 : 0 },
                                            { color:"#f472b6", pct: totalCal > 0 ? preview.fats_g*9/totalCal*100 : 0 },
                                        ];
                                        return (
                                            <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-700 gap-px">
                                                {segs.map((s, i) => (
                                                    <div key={i} style={{ width: `${s.pct}%`, backgroundColor: s.color }} className="transition-all duration-300" />
                                                ))}
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}

                            {/* Action buttons */}
                            <div className="flex gap-3 pb-1">
                                <button onClick={handleRetry}
                                        className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs font-bold rounded-lg transition-colors tracking-widest border border-zinc-700">
                                    ← RESCAN
                                </button>
                                <button onClick={handleAdd}
                                        className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-900 text-sm font-bold rounded-lg transition-colors tracking-widest">
                                    ADD TO TODAY
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ══ ERROR PHASE ══ */}
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

// ══════════════════════════════════════════════════════════════
// ── Main NutritionTracker ─────────────────────────────────────
// ══════════════════════════════════════════════════════════════
export default function NutritionTracker({ user }) {
    // ── Form state ───────────────────────────────────────────
    const [logDate,   setLogDate]   = useState(todayISO);
    const [calories,  setCalories]  = useState("");
    const [proteinG,  setProteinG]  = useState("");
    const [carbsG,    setCarbsG]    = useState("");
    const [fatsG,     setFatsG]     = useState("");
    const [notes,     setNotes]     = useState("");
    const [editingId, setEditingId] = useState(null);

    // ── Targets ───────────────────────────────────────────────
    const [targets,      setTargets]      = useState(DEFAULT_TARGETS);
    const [showTargets,  setShowTargets]  = useState(false);
    const [draftTargets, setDraftTargets] = useState(DEFAULT_TARGETS);

    // ── Data + loading ────────────────────────────────────────
    const [history,    setHistory]    = useState([]);
    const [loading,    setLoading]    = useState(true);
    const [saving,     setSaving]     = useState(false);
    const [deletingId, setDeletingId] = useState(null);
    const [toast,      setToast]      = useState(null);
    const [error,      setError]      = useState(null);

    // ── Scanner ───────────────────────────────────────────────
    const [showScanner, setShowScanner] = useState(false);

    const showToast = (msg, isError = false) => {
        setToast({ msg, isError });
        setTimeout(() => setToast(null), 2800);
    };

    // ── Fetch history on mount ────────────────────────────────
    useEffect(() => {
        setLoading(true);
        fetchNutritionHistory(30)
            .then(({ data, error: err }) => {
                if (err) { setError(err.message); return; }
                setHistory(data ?? []);
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    // ── Pre-fill form when date matches an existing entry ──────
    useEffect(() => {
        const existing = history.find(e => e.log_date === logDate);
        if (existing && !editingId) {
            setCalories(existing.calories ?? "");
            setProteinG(existing.protein_g ?? "");
            setCarbsG(existing.carbs_g ?? "");
            setFatsG(existing.fats_g ?? "");
            setNotes(existing.notes ?? "");
            setEditingId(existing.id);
        } else if (!existing && !editingId) {
            clearForm(false);
        }
    }, [logDate, history]); // eslint-disable-line react-hooks/exhaustive-deps

    const clearForm = (keepDate = true) => {
        if (!keepDate) setLogDate(todayISO());
        setCalories(""); setProteinG(""); setCarbsG(""); setFatsG(""); setNotes("");
        setEditingId(null);
    };

    const handleEdit = (entry) => {
        setLogDate(entry.log_date);
        setCalories(entry.calories ?? "");
        setProteinG(entry.protein_g ?? "");
        setCarbsG(entry.carbs_g ?? "");
        setFatsG(entry.fats_g ?? "");
        setNotes(entry.notes ?? "");
        setEditingId(entry.id);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    // ── Handle scanned macros — ADD to existing form values ───
    const handleScanAdd = useCallback((scanned) => {
        setShowScanner(false);
        setCalories(prev => String((parseInt(prev) || 0) + scanned.calories));
        setProteinG(prev  => String(Math.round(((parseFloat(prev) || 0) + scanned.protein_g) * 10) / 10));
        setCarbsG(prev    => String(Math.round(((parseFloat(prev) || 0) + scanned.carbs_g)   * 10) / 10));
        setFatsG(prev     => String(Math.round(((parseFloat(prev) || 0) + scanned.fats_g)    * 10) / 10));
        showToast(`+${scanned.calories} kcal added from scan ✓`);
    }, []);

    const handleSave = async () => {
        if (!calories && !proteinG && !carbsG && !fatsG) {
            showToast("Enter at least one value before saving.", true); return;
        }
        setSaving(true);
        try {
            const { data, error: err } = await saveDailyNutrition({
                log_date:  logDate,
                calories:  parseInt(calories)  || 0,
                protein_g: parseInt(proteinG)  || 0,
                carbs_g:   parseInt(carbsG)    || 0,
                fats_g:    parseInt(fatsG)     || 0,
                notes:     notes.trim() || null,
            });
            if (err) throw err;
            setHistory(prev => {
                const idx = prev.findIndex(e => e.log_date === logDate);
                if (idx >= 0) { const next = [...prev]; next[idx] = data; return next; }
                return [data, ...prev].sort((a, b) => b.log_date.localeCompare(a.log_date));
            });
            setEditingId(data.id);
            showToast(`${editingId ? "Updated" : "Logged"} ${fmtDate(logDate)} ✓`);
        } catch (e) {
            showToast(`Save failed: ${e.message}`, true);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm("Delete this nutrition entry?")) return;
        setDeletingId(id);
        try {
            const { error: err } = await deleteNutritionEntry(id);
            if (err) throw err;
            setHistory(prev => prev.filter(e => e.id !== id));
            if (editingId === id) clearForm();
            showToast("Entry deleted.");
        } catch (e) {
            showToast(`Delete failed: ${e.message}`, true);
        } finally {
            setDeletingId(null);
        }
    };

    const liveTotals = useMemo(() => ({
        calories:  parseInt(calories)  || 0,
        protein_g: parseInt(proteinG)  || 0,
        carbs_g:   parseInt(carbsG)    || 0,
        fats_g:    parseInt(fatsG)     || 0,
    }), [calories, proteinG, carbsG, fatsG]);

    const isToday = logDate === todayISO();

    return (
        <div className="space-y-5" style={{ fontFamily:"'IBM Plex Mono',monospace" }}>

            {/* Toast */}
            {toast && (
                <div className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded text-sm font-bold shadow-xl animate-pulse
                    ${toast.isError ? "bg-red-500 text-white" : "bg-amber-500 text-zinc-900"}`}>
                    {toast.msg}
                </div>
            )}

            {/* Barcode scanner modal */}
            {showScanner && (
                <BarcodeScannerModal
                    onAdd={handleScanAdd}
                    onClose={() => setShowScanner(false)} />
            )}

            {/* Section header */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-zinc-300 font-bold text-base tracking-tight">Nutrition & Macros</div>
                    <div className="text-zinc-600 text-xs mt-0.5">Daily macro log · upsert by date</div>
                </div>
                <button onClick={() => { setShowTargets(t => !t); setDraftTargets(targets); }}
                        className="flex items-center gap-2 text-xs text-zinc-500 hover:text-amber-400 border border-zinc-700 hover:border-amber-500/40 rounded-lg px-3 py-1.5 transition-colors">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
                    </svg>
                    TARGETS
                </button>
            </div>

            {/* Targets editor */}
            {showTargets && (
                <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 space-y-3">
                    <div className="text-zinc-400 text-xs tracking-widest uppercase mb-1">Daily Macro Targets</div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <MacroInput label="CALORIES" unit="kcal" color="#f59e0b" value={draftTargets.calories}
                                    onChange={v => setDraftTargets(t => ({ ...t, calories: parseInt(v) || 0 }))} />
                        <MacroInput label="PROTEIN" unit="g" color="#60a5fa" value={draftTargets.protein_g}
                                    onChange={v => setDraftTargets(t => ({ ...t, protein_g: parseInt(v) || 0 }))} />
                        <MacroInput label="CARBS" unit="g" color="#34d399" value={draftTargets.carbs_g}
                                    onChange={v => setDraftTargets(t => ({ ...t, carbs_g: parseInt(v) || 0 }))} />
                        <MacroInput label="FATS" unit="g" color="#f472b6" value={draftTargets.fats_g}
                                    onChange={v => setDraftTargets(t => ({ ...t, fats_g: parseInt(v) || 0 }))} />
                    </div>
                    <div className="flex gap-2 pt-1">
                        <button onClick={() => { setTargets(draftTargets); setShowTargets(false); showToast("Targets updated ✓"); }}
                                className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-900 text-xs font-bold rounded-lg transition-colors tracking-widest">
                            SAVE TARGETS
                        </button>
                        <button onClick={() => setShowTargets(false)}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs font-bold rounded-lg transition-colors">
                            CANCEL
                        </button>
                    </div>
                </div>
            )}

            {/* Live macro rings */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
                <div className="text-zinc-500 text-xs tracking-widest uppercase">
                    {isToday ? "Today's Progress" : `Progress · ${fmtDate(logDate)}`}
                </div>
                <CalorieGauge value={liveTotals.calories} target={targets.calories} />
                <div className="flex justify-around">
                    {MACRO_META.map(m => (
                        <MacroRing key={m.key} value={liveTotals[m.key]} target={targets[m.key]} meta={m} size={76} />
                    ))}
                </div>
                {(liveTotals.protein_g + liveTotals.carbs_g + liveTotals.fats_g) > 0 && (
                    <div className="space-y-1.5 pt-1 border-t border-zinc-800">
                        <div className="text-zinc-700 text-xs tracking-widest">MACRO SPLIT</div>
                        {(() => {
                            const totalCal = liveTotals.protein_g*4 + liveTotals.carbs_g*4 + liveTotals.fats_g*9;
                            return MACRO_META.map(m => {
                                const cal = m.key === "fats_g" ? liveTotals[m.key]*9 : liveTotals[m.key]*4;
                                const pct = totalCal > 0 ? Math.round(cal / totalCal * 100) : 0;
                                return (
                                    <div key={m.key} className="flex items-center gap-2">
                                        <span className="text-xs w-14" style={{ color: m.color }}>{m.label}</span>
                                        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                            <div className="h-full rounded-full transition-all duration-500"
                                                 style={{ width: `${pct}%`, backgroundColor: m.color }} />
                                        </div>
                                        <span className="text-zinc-500 text-xs w-8 text-right">{pct}%</span>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                )}
            </div>

            {/* Log form */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <div className="text-zinc-500 text-xs tracking-widest uppercase">
                        {editingId ? "Update Entry" : "Log Macros"}
                    </div>
                    {editingId && (
                        <button onClick={() => clearForm(false)}
                                className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors">
                            ← NEW ENTRY
                        </button>
                    )}
                </div>

                {/* Date picker */}
                <div className="flex flex-col gap-1">
                    <label className="text-zinc-600 text-xs tracking-widest">DATE</label>
                    <input type="date" value={logDate}
                           onChange={e => { setLogDate(e.target.value); setEditingId(null); }}
                           max={todayISO()}
                           className="bg-zinc-800 border border-zinc-700 focus:border-amber-500 rounded-lg px-3 py-2.5 text-zinc-200 text-sm outline-none transition-colors w-full" />
                </div>

                {/* Calorie input + Scan Food button */}
                <div className="space-y-3">
                    <MacroInput label="CALORIES" unit="kcal" color="#f59e0b" value={calories} onChange={setCalories} />

                    {/* ── Scan Food button ── */}
                    <button
                        onClick={() => setShowScanner(true)}
                        className="w-full flex items-center justify-center gap-2.5 py-2.5 border border-dashed border-zinc-600 hover:border-amber-500 text-zinc-500 hover:text-amber-400 text-xs font-bold rounded-lg transition-colors tracking-widest group">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                             className="group-hover:scale-110 transition-transform">
                            <rect x="3" y="3" width="18" height="18" rx="2"/>
                            <path d="M7 7h.01M7 12h.01M7 17h.01M12 7h.01M12 12h.01M12 17h.01M17 7h.01M17 12h.01M17 17h.01"/>
                        </svg>
                        SCAN FOOD BARCODE
                        <span className="text-zinc-700 font-normal text-xs">(adds to current values)</span>
                    </button>
                </div>

                {/* Macro grid */}
                <div className="grid grid-cols-3 gap-3">
                    {MACRO_META.map(m => (
                        <MacroInput key={m.key} label={m.label} unit={m.unit} color={m.color}
                                    value={m.key === "protein_g" ? proteinG : m.key === "carbs_g" ? carbsG : fatsG}
                                    onChange={m.key === "protein_g" ? setProteinG : m.key === "carbs_g" ? setCarbsG : setFatsG} />
                    ))}
                </div>

                {/* Notes */}
                <div className="flex flex-col gap-1">
                    <label className="text-zinc-600 text-xs tracking-widest">NOTES <span className="text-zinc-700">(optional)</span></label>
                    <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                           placeholder="e.g. Cheat day, high stress, traveling…"
                           maxLength={120}
                           className="bg-zinc-800 border border-zinc-700 focus:border-amber-500 rounded-lg px-3 py-2.5 text-zinc-300 text-sm outline-none transition-colors placeholder-zinc-700" />
                </div>

                {/* Save */}
                <button onClick={handleSave} disabled={saving}
                        className={`w-full py-3 font-bold text-sm rounded-lg transition-colors tracking-widest flex items-center justify-center gap-2
                        ${saving ? "bg-amber-600 cursor-not-allowed text-zinc-900" : "bg-amber-500 hover:bg-amber-400 text-zinc-900"}`}>
                    {saving
                        ? <><svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round"/></svg> SAVING…</>
                        : editingId ? "UPDATE ENTRY" : "LOG MACROS"
                    }
                </button>
            </div>

            {/* 7-day chart */}
            {!loading && <HistoryChart entries={history} targets={targets} />}

            {/* Entry history */}
            <div className="space-y-2">
                <div className="text-zinc-500 text-xs tracking-widest uppercase">
                    Recent Entries
                    {loading && <span className="ml-2 text-zinc-700">loading…</span>}
                </div>
                {error && (
                    <div className="text-red-400 text-xs px-3 py-2 bg-red-950/40 border border-red-900 rounded-lg">{error}</div>
                )}
                {!loading && history.length === 0 && (
                    <div className="text-center py-10 text-zinc-700 text-sm border border-dashed border-zinc-800 rounded-lg">
                        No nutrition entries yet.<br />
                        <span className="text-zinc-600">Log your first day above.</span>
                    </div>
                )}
                {history.map(entry => (
                    <HistoryRow key={entry.id} entry={entry}
                                onEdit={handleEdit}
                                onDelete={handleDelete}
                                deleting={deletingId === entry.id} />
                ))}
            </div>
        </div>
    );
}