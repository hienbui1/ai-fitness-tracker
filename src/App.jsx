/**
 * App.jsx  —  STR/VOL application root
 *
 * This is the single component that:
 *   1. Subscribes to Supabase auth state on mount
 *   2. Resolves any persisted session from localStorage on page load
 *      (so a logged-in user is never bounced back to the auth screen)
 *   3. Renders a loading splash → AuthScreen → StrengthTracker
 *      depending on auth state
 *
 * Expected file structure:
 *   src/
 *     App.jsx                        ← this file
 *     lib/
 *       supabase.js                  ← Supabase client + helpers
 *     components/
 *       AuthScreen.jsx               ← login/register gate
 *       StrengthTracker.jsx          ← main workout dashboard
 */

import { useState, useEffect, useCallback } from "react";
import { supabase, signOut }  from "./lib/supabase";        // adjust if needed
import AuthScreen             from "./components/AuthScreen";
import StrengthTracker from "./components/strength-tracker";


// ─────────────────────────────────────────────────────────────
//  Loading splash
//  Shown for the ~150–300 ms Supabase needs to rehydrate a
//  persisted session from localStorage before the first render.
// ─────────────────────────────────────────────────────────────
function LoadingSplash() {
    return (
        <div
            className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-5"
            style={{ fontFamily: "'IBM Plex Mono',monospace" }}>

            {/* Wordmark */}
            <p className="text-amber-500 font-bold text-2xl tracking-tight leading-none">
                STR<span className="text-zinc-700">/</span>VOL
            </p>

            {/* Animated bar loader */}
            <div className="flex gap-[3px] items-end h-5">
                {[0, 1, 2, 3].map(i => (
                    <div
                        key={i}
                        className="w-[3px] bg-amber-500 rounded-sm"
                        style={{
                            animation: `barPulse 0.9s ease-in-out ${i * 0.14}s infinite alternate`,
                            minHeight: "4px",
                        }}
                    />
                ))}
            </div>

            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&display=swap');
        @keyframes barPulse {
          from { height: 4px;  opacity: 0.35; }
          to   { height: 20px; opacity: 1;    }
        }
      `}</style>
        </div>
    );
}


// ─────────────────────────────────────────────────────────────
//  App root
// ─────────────────────────────────────────────────────────────
export default function App() {
    /**
     * authState has three possible values:
     *   null       → still resolving (show splash)
     *   false      → no authenticated session (show AuthScreen)
     *   User obj   → authenticated (show StrengthTracker)
     */
    const [authState, setAuthState] = useState(null);

    useEffect(() => {
        // ── Subscribe to auth state changes ──────────────────────
        //
        // onAuthStateChange fires synchronously-ish with the event:
        //
        //   INITIAL_SESSION   — fired on mount; contains the persisted
        //                       session if the user was previously logged in.
        //                       This is the mechanism that keeps users logged in
        //                       across page refreshes.
        //
        //   SIGNED_IN         — after signIn() / signUp() (when no email
        //                       confirmation is required)
        //
        //   SIGNED_OUT        — after signOut()
        //
        //   TOKEN_REFRESHED   — silent JWT renewal; we update the user object
        //                       so any display_name / metadata changes propagate.
        //
        //   USER_UPDATED      — after supabase.auth.updateUser()
        //
        // We resolve authState from null → user/false as soon as the first
        // event arrives, ending the loading splash.

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((event, session) => {
            if (session?.user) {
                setAuthState(session.user);
            } else {
                // Covers SIGNED_OUT, expired sessions, and "no persisted session"
                setAuthState(false);
            }
        });

        // Cleanup: unsubscribe when App unmounts
        return () => subscription.unsubscribe();
    }, []);


    // ── Sign-out handler ──────────────────────────────────────
    // Passed down to StrengthTracker so the dashboard can offer
    // a sign-out button. onAuthStateChange will update authState
    // to false automatically after signOut() resolves.
    const handleSignOut = useCallback(async () => {
        await signOut();
        // authState → false is handled by the subscription above
    }, []);


    // ── Render ────────────────────────────────────────────────

    if (authState === null) {
        // Session check in progress — show branded splash
        return <LoadingSplash />;
    }

    if (authState === false) {
        // No session — show login / register
        return (
            <AuthScreen
                onAuthSuccess={(user) => setAuthState(user)}
            />
        );
    }

    // Authenticated — render the main dashboard
    // Pass `user` so the dashboard can display the user's name,
    // and `onSignOut` to let them log out from within the app.
    return (
        <StrengthTracker
            user={authState}
            onSignOut={handleSignOut}
        />
    );
}
