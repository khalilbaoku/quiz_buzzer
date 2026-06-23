"use client";

import { motion } from "framer-motion";
import type { Team, Player } from "@/lib/types";

interface ScoreBoardProps {
  teams: Team[];
  players?: Player[];
  compact?: boolean;
}

export default function ScoreBoard({ teams, players, compact }: ScoreBoardProps) {
  const sorted = [...teams].sort((a, b) => b.score - a.score);

  if (compact) {
    return (
      <div className="flex flex-wrap gap-2">
        {sorted.map((team) => (
          <div
            key={team.id}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 rounded-lg text-sm"
          >
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: team.color }}
            />
            <span className="text-zinc-400">{team.name}</span>
            <span className="font-bold text-white tabular-nums">
              {team.score}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map((team, i) => {
        const teamPlayers = players?.filter((p) => p.teamId === team.id) || [];
        const onlineCount = teamPlayers.filter((p) => p.connected).length;

        return (
          <div key={team.id}>
            <motion.div
              layout
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-900/50"
            >
              <span className="text-zinc-600 text-sm w-5 text-right">
                {i + 1}.
              </span>
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: team.color }}
              />
              <span className="flex-1 font-medium text-zinc-300">
                {team.name}
              </span>
              {teamPlayers.length > 0 && (
                <span className="text-zinc-600 text-xs">
                  {onlineCount}/{teamPlayers.length}
                </span>
              )}
              <motion.span
                key={team.score}
                initial={{ scale: 1.3, color: "#22c55e" }}
                animate={{ scale: 1, color: "#ffffff" }}
                className="font-bold tabular-nums text-lg"
              >
                {team.score}
              </motion.span>
            </motion.div>

            {/* Player names */}
            {teamPlayers.length > 0 && (
              <div className="ml-11 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                {teamPlayers.map((p) => (
                  <span
                    key={p.id}
                    className={`text-xs ${
                      p.connected ? "text-zinc-500" : "text-zinc-700"
                    }`}
                  >
                    {p.name}
                    {!p.connected && " (off)"}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
