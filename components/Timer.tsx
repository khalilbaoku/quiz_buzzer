"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface TimerProps {
  endsAt: number | null;
  totalSeconds: number;
}

export default function Timer({ endsAt, totalSeconds }: TimerProps) {
  const [remaining, setRemaining] = useState<number>(totalSeconds);

  useEffect(() => {
    if (!endsAt) {
      setRemaining(totalSeconds);
      return;
    }

    const tick = () => {
      const left = Math.max(0, (endsAt - Date.now()) / 1000);
      setRemaining(left);
    };

    tick();
    const interval = setInterval(tick, 50);
    return () => clearInterval(interval);
  }, [endsAt, totalSeconds]);

  if (!endsAt) return null;

  const fraction = remaining / totalSeconds;
  const isUrgent = remaining <= 5;
  const display = Math.ceil(remaining);

  return (
    <div className="flex flex-col items-center gap-2">
      <motion.div
        className="text-5xl font-black tabular-nums"
        style={{ color: isUrgent ? "#ef4444" : "#ffffff" }}
        animate={isUrgent ? { scale: [1, 1.1, 1] } : {}}
        transition={isUrgent ? { repeat: Infinity, duration: 0.5 } : {}}
      >
        {display}
      </motion.div>

      <div className="w-48 h-2 bg-zinc-800 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{
            background: isUrgent
              ? "#ef4444"
              : "linear-gradient(90deg, #22c55e, #eab308)",
            width: `${fraction * 100}%`,
          }}
          transition={{ duration: 0.05 }}
        />
      </div>
    </div>
  );
}
