"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { generateRoomCode } from "@/lib/room-code";
import { unlockAudio } from "@/lib/sounds";

interface SavedJoin {
  roomCode: string;
  teamCode: string;
  playerName: string;
}

const STORAGE_KEY = "quiz-last-join";

function saveJoin(data: SavedJoin) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function loadJoin(): SavedJoin | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedJoin) : null;
  } catch {
    return null;
  }
}

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<"home" | "join">("home");
  const [roomCode, setRoomCode] = useState("");
  const [teamCode, setTeamCode] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [savedJoin, setSavedJoin] = useState<SavedJoin | null>(null);

  useEffect(() => {
    setSavedJoin(loadJoin());
  }, []);

  function handleHost() {
    unlockAudio();
    const code = generateRoomCode();
    router.push(`/host/${code}`);
  }

  function rejoin(saved: SavedJoin) {
    unlockAudio();
    saveJoin(saved);
    const params = new URLSearchParams({ tc: saved.teamCode, name: saved.playerName });
    router.push(`/play/${saved.roomCode}?${params.toString()}`);
  }

  function handleJoin() {
    unlockAudio();
    if (mode === "home") {
      // Pre-fill form with last session if available
      if (savedJoin) {
        setRoomCode(savedJoin.roomCode);
        setTeamCode(savedJoin.teamCode);
        setPlayerName(savedJoin.playerName);
      }
      setMode("join");
      return;
    }
    if (!roomCode.trim() || !teamCode.trim() || !playerName.trim()) return;
    const join: SavedJoin = {
      roomCode: roomCode.trim().toUpperCase(),
      teamCode: teamCode.trim().toUpperCase(),
      playerName: playerName.trim(),
    };
    saveJoin(join);
    const params = new URLSearchParams({ tc: join.teamCode, name: join.playerName });
    router.push(`/play/${join.roomCode}?${params.toString()}`);
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 gap-8">
      <div className="text-center">
        <h1 className="text-5xl sm:text-7xl font-bold tracking-tighter mb-2">
          BUZZ
        </h1>
        <p className="text-zinc-500 text-sm tracking-widest uppercase">
          Quiz Night Buzzer
        </p>
      </div>

      {mode === "home" ? (
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <button
            onClick={handleHost}
            className="w-full py-4 px-6 bg-white text-black font-bold text-lg rounded-xl
              hover:bg-zinc-200 active:scale-95 transition-all duration-150"
          >
            HOST A QUIZ
          </button>

          <button
            onClick={handleJoin}
            className="w-full py-4 px-6 bg-zinc-800 text-white font-bold text-lg rounded-xl
              border border-zinc-700 hover:bg-zinc-700 active:scale-95 transition-all duration-150"
          >
            JOIN A QUIZ
          </button>

          {/* Quick rejoin — only shown when the player has a previous session saved */}
          {savedJoin && (
            <button
              onClick={() => rejoin(savedJoin)}
              className="w-full py-3 px-4 rounded-xl border border-zinc-700 bg-zinc-900
                hover:bg-zinc-800 active:scale-95 transition-all duration-150 text-left"
            >
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-0.5">
                Rejoin last session
              </div>
              <div className="text-white font-bold text-sm">{savedJoin.playerName}</div>
              <div className="text-zinc-500 text-xs">
                Room {savedJoin.roomCode} &middot; Team {savedJoin.teamCode}
              </div>
            </button>
          )}

          <button
            onClick={() => {
              unlockAudio();
              const code = generateRoomCode();
              router.push(`/shared/${code}`);
            }}
            className="w-full py-3 px-6 text-zinc-500 text-sm rounded-xl
              border border-zinc-800 hover:border-zinc-600 hover:text-zinc-300
              active:scale-95 transition-all duration-150"
          >
            SHARED SCREEN MODE
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <input
            type="text"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="ROOM CODE"
            maxLength={4}
            className="w-full py-3 px-4 bg-zinc-900 border border-zinc-700 rounded-xl
              text-center text-2xl tracking-[0.3em] font-bold placeholder:text-zinc-600
              placeholder:tracking-normal placeholder:text-base placeholder:font-normal
              focus:outline-none focus:border-zinc-500"
            autoFocus
          />

          <input
            type="text"
            value={teamCode}
            onChange={(e) => setTeamCode(e.target.value.toUpperCase())}
            placeholder="TEAM CODE (e.g. A1)"
            maxLength={2}
            className="w-full py-3 px-4 bg-zinc-900 border border-zinc-700 rounded-xl
              text-center text-xl tracking-[0.2em] font-bold placeholder:text-zinc-600
              placeholder:tracking-normal placeholder:text-sm placeholder:font-normal
              focus:outline-none focus:border-zinc-500"
          />

          <input
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Your Name"
            maxLength={30}
            className="w-full py-3 px-4 bg-zinc-900 border border-zinc-700 rounded-xl
              text-center text-lg placeholder:text-zinc-600
              focus:outline-none focus:border-zinc-500"
          />

          <button
            onClick={handleJoin}
            disabled={!roomCode.trim() || !teamCode.trim() || !playerName.trim()}
            className="w-full py-4 px-6 bg-white text-black font-bold text-lg rounded-xl
              hover:bg-zinc-200 active:scale-95 transition-all duration-150
              disabled:opacity-30 disabled:cursor-not-allowed"
          >
            JOIN
          </button>

          <button
            onClick={() => setMode("home")}
            className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors"
          >
            Back
          </button>
        </div>
      )}
    </div>
  );
}
