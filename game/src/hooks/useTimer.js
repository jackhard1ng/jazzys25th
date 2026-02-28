import { useState, useEffect } from 'react';

// ============================================================
// useTimer — countdown timer synced to a Firebase timerEnd
// Returns { timeLeft, formatted, isUrgent, isExpired }
// ============================================================
export default function useTimer(timerEnd) {
  const [timeLeft, setTimeLeft] = useState(0);

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
