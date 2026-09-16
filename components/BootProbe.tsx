'use client';

import { useEffect } from 'react';

/**
 * Sets a flag the moment React actually hydrates, and clears the
 * "did not finish loading" notice the inline boot guard in app/layout.tsx
 * puts up if that never happens.
 *
 * Why this exists: every page in this app is server-rendered, so a
 * hydration failure is completely silent — the login form (or any page)
 * renders and looks perfectly normal, but no onClick/onSubmit handler is
 * ever attached, so every button quietly does nothing. That's how a 2026-09
 * report of "not even able to login" on an old Windows laptop reached us
 * with no error to go on: Next was shipping ES2022 class static blocks in
 * its core router chunk, which an older Chrome refuses to parse, so the
 * router never initialised. The browserslist floor in package.json fixes
 * that specific cause; this exists so the *next* cause of a dead-but-
 * normal-looking page announces itself on the machine it happens on
 * instead of being invisible to whoever can't reproduce it.
 */
export default function BootProbe() {
  useEffect(() => {
    (window as unknown as { __APP_HYDRATED?: boolean }).__APP_HYDRATED = true;
    const notice = document.getElementById('legacy-boot-notice');
    notice?.parentNode?.removeChild(notice);
  }, []);

  return null;
}
