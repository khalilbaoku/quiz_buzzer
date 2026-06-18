"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { BuzzEntry } from "@/lib/types";

interface BuzzQueueProps {
  queue: BuzzEntry[];
  currentBuzzer: string | null;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default function BuzzQueue({ queue, currentBuzzer }: BuzzQueueProps) {
  if (queue.length === 0) {
    return (
      <div className="text-zinc-600 text-center py-8 text-sm">
        No buzzes yet
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <AnimatePresence>
        {queue.map((entry, i) => {
          const isCurrent = entry.teamId === currentBuzzer;
          return (
            <motion.div
              key={entry.teamId}
              initial={{ opacity: 0, x: -20, height: 0 }}
              animate={{ opacity: 1, x: 0, height: "auto" }}
              transition={{ duration: 0.2, delay: i * 0.05 }}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg ${
                isCurrent
                  ? "bg-zinc-800 border border-zinc-600"
                  : "bg-zinc-900/50"
              }`}
            >
              <span className="text-xl w-8 text-center">
                {i < 3 ? MEDALS[i] : `#${entry.position}`}
              </span>

              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: entry.teamColor }}
              />

              <div className="flex-1 min-w-0">
                <span
                  className={`font-bold ${
                    isCurrent ? "text-white" : "text-zinc-400"
                  }`}
                >
                  {entry.playerName}
                </span>
                <span className="text-zinc-600 text-xs ml-1.5">
                  {entry.teamName}
                </span>
              </div>

              <span className="text-zinc-500 text-sm font-mono tabular-nums">
                {entry.position === 1
                  ? "FIRST"
                  : `+${(entry.timestamp / 1000).toFixed(3)}s`}
              </span>

              {isCurrent && (
                <motion.div
                  className="w-2 h-2 rounded-full bg-green-500"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                />
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
