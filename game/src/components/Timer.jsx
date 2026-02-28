import useTimer from '../hooks/useTimer';

export default function Timer({ timerEnd }) {
  const { formatted, isUrgent, timeLeft } = useTimer(timerEnd);

  if (!timerEnd || timeLeft === 0) return null;

  return (
    <div className={`timer-display ${isUrgent ? 'urgent' : ''}`}>
      {formatted}
    </div>
  );
}
