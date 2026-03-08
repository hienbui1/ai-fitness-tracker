/**
 * App.jsx  —  STR/VOL application root  (updated for AI Coach tab)
 *
 * Auth logic is unchanged. The only additions are:
 *   1. Import AICoach
 *   2. Pass <AICoach user={authState} /> to StrengthTracker as
 *      a `coachComponent` prop so the dashboard's own header
 *      tab bar can mount it — keeping the nav, wordmark, avatar,
 *      and sign-out button visible on every tab.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase, signOut }  from "./lib/supabase";
import AuthScreen             from "./components/AuthScreen";
import StrengthTracker from "./components/strength-tracker";
import AICoach                from "./components/AICoach";   // NEW
import NutritionTracker from "./components/NutritionTracker";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
import Leaderboard from "./components/Leaderboard";
// ── Loading splash ─────────────────────────────────────────────
function LoadingSplash() {
    return (
        <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-5"
             style={{ fontFamily:"'IBM Plex Mono',monospace" }}>
            <p className="text-amber-500 font-bold text-2xl tracking-tight leading-none">
                STR<span className="text-zinc-700">/</span>VOL
            </p>
            <div className="flex gap-[3px] items-end h-5">
                {[0,1,2,3].map(i => (
                    <div key={i} className="w-[3px] bg-amber-500 rounded-sm"
                         style={{ animation:`barPulse 0.9s ease-in-out ${i*0.14}s infinite alternate`, minHeight:"4px" }} />
                ))}
            </div>
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&display=swap');
        @keyframes barPulse { from{height:4px;opacity:.35} to{height:20px;opacity:1} }
      `}</style>
        </div>
    );
}

// ── App root ───────────────────────────────────────────────────
export default function App() {
    const [authState, setAuthState] = useState(null);

    useEffect(() => {
        const { data:{ subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setAuthState(session?.user ?? false);
        });
        return () => subscription.unsubscribe();
    }, []);

    const handleSignOut = useCallback(async () => { await signOut(); }, []);

    if (authState === null)  return <LoadingSplash />;
    if (authState === false) return <AuthScreen onAuthSuccess={u => setAuthState(u)} />;

    return (
        <StrengthTracker
            user={authState}
            onSignOut={handleSignOut}
            coachComponent={<AICoach user={authState} />}
            nutritionComponent={<NutritionTracker user={authState} />}
            analyticsComponent={<AnalyticsDashboard user={authState} calorieTarget={2500} />}
            leaderboardComponent={<Leaderboard user={authState} />}
        />
    );
}
