import { useEffect, useState } from 'react';
import { api } from './api';

let serverOffsetMs = 0;
let initialSyncDone = false;

export async function syncServerClock(): Promise<number> {
  try {
    const t0 = Date.now();
    const data = await api.getTime();
    const t1 = Date.now();
    const roundTrip = (t1 - t0) / 2;
    serverOffsetMs = (data.server_time_ms + roundTrip) - t1;
    initialSyncDone = true;
    return serverOffsetMs;
  } catch {
    return serverOffsetMs;
  }
}

export function getServerNow(): Date {
  return new Date(Date.now() + serverOffsetMs);
}

export function formatIST(dateInput: string | Date | number | null | undefined): string {
  if (!dateInput) return '—';
  const d = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '—';

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d) + ' IST';
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export function useCountdown(targetIsoDate: string | null | undefined, isPaused = false) {
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!initialSyncDone) {
      syncServerClock();
    }

    if (!targetIsoDate) {
      setSecondsRemaining(null);
      return;
    }

    const targetTime = new Date(targetIsoDate).getTime();
    if (isNaN(targetTime)) {
      setSecondsRemaining(null);
      return;
    }

    const update = () => {
      if (isPaused) return;
      const now = getServerNow().getTime();
      const diff = Math.max(0, Math.floor((targetTime - now) / 1000));
      setSecondsRemaining(diff);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetIsoDate, isPaused]);

  return {
    secondsRemaining,
    formatted: secondsRemaining !== null ? formatDuration(secondsRemaining) : '—',
    isExpired: secondsRemaining !== null && secondsRemaining <= 0,
  };
}
