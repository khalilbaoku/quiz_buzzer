"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { buzzHaptic } from "@/lib/haptics";
import type { RoomPhase } from "@/lib/types";

interface BuzzButtonProps {
  phase: RoomPhase;
  onBuzz: () => void;
  myBuzzPosition: number | null;
  currentBuzzerIsMe: boolean;
  teamColor: string;
  disabled?: boolean;
}

export default function BuzzButton({
  phase,
  onBuzz,
  myBuzzPosition,
  currentBuzzerIsMe,
  teamColor,
  disabled,
}: BuzzButtonProps) {
  const [pressing, setPressing] = useState(false);

  const handleBuzz = useCallback(() => {
    if (phase !== "open" || myBuzzPosition !== null || disabled) return;
    buzzHaptic();
    setPressing(true);
    onBuzz();
    setTimeout(() => setPressing(false), 300);
  }, [phase, myBuzzPosition, onBuzz, disabled]);

  const isOpen = phase === "open" && myBuzzPosition === null;
  const hasBuzzed = myBuzzPosition !== null;

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <AnimatePresence mode="wait">
        {isOpen ? (
          <motion.button
            key="buzz"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{
              scale: [1, 1.03, 1],
              opacity: 1,
              boxShadow: [
                `0 0 20px ${teamColor}44`,
                `0 0 50px ${teamColor}88`,
                `0 0 20px ${teamColor}44`,
              ],
            }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{
              scale: { repeat: Infinity, duration: 1.5, ease: "easeInOut" },
              boxShadow: { repeat: Infinity, duration: 1.5, ease: "easeInOut" },
              opacity: { duration: 0.2 },
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              handleBuzz();
            }}
            onMouseDown={handleBuzz}
            whileTap={{ scale: 0.92 }}
            className="w-64 h-64 sm:w-80 sm:h-80 rounded-full flex items-center justify-center
              select-none cursor-pointer touch-manipulation"
            style={{
              background: `radial-gradient(circle at 40% 40%, ${teamColor}, ${teamColor}88)`,
            }}
          >
            <span className="text-4xl sm:text-5xl font-black text-white drop-shadow-lg">
              BUZZ!
            </span>
          </motion.button>
        ) : hasBuzzed ? (
          <motion.div
            key="buzzed"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center"
          >
            {currentBuzzerIsMe ? (
              <>
                <motion.div
                  className="text-6xl sm:text-8xl font-black mb-4"
                  style={{ color: teamColor }}
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ repeat: Infinity, duration: 0.8 }}
                >
                  #{myBuzzPosition}
                </motion.div>
                <p className="text-2xl font-bold text-white">YOUR TURN!</p>
                <p className="text-zinc-400 mt-2">Answer now</p>
              </>
            ) : (
              <>
                <div
                  className="text-5xl sm:text-7xl font-black mb-4"
                  style={{ color: teamColor }}
                >
                  #{myBuzzPosition}
                </div>
                <p className="text-xl text-zinc-400">
                  You buzzed #{myBuzzPosition}
                </p>
                <p className="text-zinc-500 text-sm mt-2">Waiting...</p>
              </>
            )}
          </motion.div>
        ) : phase === "buzzed" ? (
          <motion.div
            key="locked"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center"
          >
            <div className="text-4xl mb-4 opacity-30">🔒</div>
            <p className="text-zinc-500 text-lg">Buzzers locked</p>
          </motion.div>
        ) : (
          <motion.div
            key="waiting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            className="text-center"
          >
            <div
              className="w-48 h-48 sm:w-64 sm:h-64 rounded-full flex items-center justify-center
                border-2 border-zinc-800"
            >
              <span className="text-2xl text-zinc-600 font-bold">WAIT</span>
            </div>
            <p className="text-zinc-600 text-sm mt-4">
              {phase === "lobby"
                ? "Waiting for host..."
                : "Waiting for next question..."}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
