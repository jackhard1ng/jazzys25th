import { useState, useEffect } from 'react';

// ============================================================
// useTimer — countdown timer synced to a Firebase timerEnd
// Returns { timeLeft, formatted, isUrgent, isExpired }
// ============================================================
export default function useTimer(timerEnd) {
  // CRITICAL: compute timeLeft synchronously on first render. If we
  // initialized to 0, then isExpired = (timerEnd && timeLeft === 0)
  // would evaluate to TRUE during the very first render of any consumer
  // — and any effect that auto-submits when isExpired flips to true
  // would fire before the timer's own effect had a chance to set the
  // real remaining time. This caused traitors' phones to auto-submit
  // empty scrolls the instant the night phase started.
  const [timeLeft, setTimeLeft] = useState(() => {
    if (!timerEnd) return 0;
    return Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000));
  });

  useEffect(() => {
    if (!timerEnd) {
      setTimeLeft(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000));
      setTimeLeft(remaining);
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [timerEnd]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const isUrgent = timeLeft > 0 && timeLeft <= 30;
  const isExpired = timerEnd && timeLeft === 0;

  return { timeLeft, formatted, isUrgent, isExpired };
}
