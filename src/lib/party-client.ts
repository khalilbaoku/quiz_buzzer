"use client";

import PartySocket from "partysocket";

export function connectToRoom(roomCode: string): PartySocket {
  const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "localhost:1999";
  return new PartySocket({
    host,
    room: roomCode.toUpperCase(),
  });
}
