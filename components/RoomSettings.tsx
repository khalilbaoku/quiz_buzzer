"use client";

import { useState } from "react";
import type { RoomConfig } from "@/lib/types";

interface RoomSettingsProps {
  config: RoomConfig;
  onChange: (updates: Partial<RoomConfig>) => void;
}

export default function RoomSettings({ config, onChange }: RoomSettingsProps) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1.5 transition-colors"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>Settings</span>
      </button>

      {open && (
        <div className="mt-3 space-y-4 p-4 bg-zinc-900 rounded-xl border border-zinc-800">
          {/* Answer Timer */}
          <div>
            <label className="text-sm text-zinc-400 block mb-1.5">
              Points per question
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={0}
                step={1}
                value={config.pointsPerQuestion}
                onChange={(e) =>
                  onChange({ pointsPerQuestion: Number(e.target.value) })
                }
                className="w-24 py-2 px-3 bg-zinc-950 border border-zinc-700 rounded-lg
                  text-sm text-white focus:outline-none focus:border-zinc-500"
              />
              <span className="text-zinc-500 text-sm">awarded for correct answers</span>
            </div>
          </div>

          <div>
            <label className="text-sm text-zinc-400 block mb-1.5">
              Answer timer (seconds)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={60}
                step={5}
                value={config.answerTimerSeconds}
                onChange={(e) =>
                  onChange({ answerTimerSeconds: Number(e.target.value) })
                }
                className="flex-1 accent-white"
              />
              <span className="text-white font-bold w-10 text-right tabular-nums">
                {config.answerTimerSeconds || "OFF"}
              </span>
            </div>
          </div>

          {/* Second Chance Mode */}
          <div>
            <label className="text-sm text-zinc-400 block mb-1.5">
              On incorrect answer
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => onChange({ secondChanceMode: "queue" })}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  config.secondChanceMode === "queue"
                    ? "bg-white text-black"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                }`}
              >
                Next in queue
              </button>
              <button
                onClick={() => onChange({ secondChanceMode: "reset" })}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  config.secondChanceMode === "reset"
                    ? "bg-white text-black"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                }`}
              >
                Re-buzz
              </button>
            </div>
          </div>

          {/* Track Points */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              className={`w-10 h-6 rounded-full transition-colors relative ${
                config.trackPoints ? "bg-white" : "bg-zinc-700"
              }`}
              onClick={() => onChange({ trackPoints: !config.trackPoints })}
            >
              <div
                className={`w-4 h-4 rounded-full absolute top-1 transition-all ${
                  config.trackPoints
                    ? "left-5 bg-black"
                    : "left-1 bg-zinc-400"
                }`}
              />
            </div>
            <span className="text-sm text-zinc-400">Track points</span>
          </label>
        </div>
      )}
    </div>
  );
}
