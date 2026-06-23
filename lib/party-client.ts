"use client";

import PartySocket from "partysocket";

export function getPartyKitHost(): string {
  const configuredHost = process.env.NEXT_PUBLIC_PARTYKIT_HOST;
  if (configuredHost) return configuredHost;

  if (typeof window !== "undefined") {
    const { hostname } = window.location;
    if (hostname && hostname !== "localhost" && hostname !== "127.0.0.1") {
      return `${hostname}:1999`;
    }
  }

  return "localhost:1999";
}

export function connectToRoom(roomCode: string): PartySocket {
  return new PartySocket({
    host: getPartyKitHost(),
    room: roomCode.toUpperCase(),
  });
}
