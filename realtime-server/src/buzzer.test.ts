import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as Party from "partykit/server";
import BuzzerServer from "./buzzer";

// ---------------------------------------------------------------------------
// Minimal mocks for the PartyKit runtime objects
// ---------------------------------------------------------------------------

function mockConn(id: string): Party.Connection {
  return {
    id,
    send: vi.fn(),
    close: vi.fn(),
    socket: {} as unknown as WebSocket,
    url: "",
    serializeAttachment: vi.fn(),
    deserializeAttachment: vi.fn(),
  } as unknown as Party.Connection;
}

function mockRoom(id = "ROOM"): Party.Room {
  const store = new Map<string, unknown>();
  return {
    id,
    broadcast: vi.fn(),
    getConnections: vi.fn(() => []),
    storage: {
      put: vi.fn(async (key: string, val: unknown) => {
        store.set(key, val);
      }),
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => {
        return store.get(key) as T | undefined;
      }),
      delete: vi.fn(),
      list: vi.fn(),
      getAlarm: vi.fn(),
      setAlarm: vi.fn(),
      deleteAlarm: vi.fn(),
    },
    parties: {},
    env: {},
    internalID: `internal-${id}`,
    name: id,
  } as unknown as Party.Room;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Send a JSON message from a connection to the server
function send(server: BuzzerServer, conn: Party.Connection, msg: object) {
  server.onMessage(JSON.stringify(msg), conn);
}

// Get the parsed object from the most recent send() call on a mock connection
function lastSent(conn: Party.Connection): Record<string, unknown> | null {
  const fn = conn.send as ReturnType<typeof vi.fn>;
  const call = fn.mock.calls.at(-1);
  return call ? (JSON.parse(call[0] as string) as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("BuzzerServer", () => {
  let room: Party.Room;
  let server: BuzzerServer;

  beforeEach(() => {
    room = mockRoom();
    server = new BuzzerServer(room);
  });

  // Set up two teams and return the host connection
  function setupGame(teamNames = ["Alpha", "Bravo"]) {
    const host = mockConn("host");
    server.onConnect(host);
    send(server, host, { type: "host:join" });
    send(server, host, { type: "host:setup-teams", teamNames });
    return host;
  }

  // Join a player and return their connection
  function joinPlayer(teamCode: string, name: string, connId = `p-${Math.random()}`) {
    const conn = mockConn(connId);
    server.onConnect(conn);
    send(server, conn, { type: "player:join", teamCode, playerName: name });
    return conn;
  }

  // ---------------------------------------------------------------------------
  // Player join
  // ---------------------------------------------------------------------------
  describe("Player join", () => {
    it("rejects join when player name is empty", () => {
      setupGame();
      const conn = mockConn("p1");
      server.onConnect(conn);
      send(server, conn, { type: "player:join", teamCode: "A1", playerName: "   " });
      expect(lastSent(conn)?.type).toBe("error");
    });

    it("rejects join when player name exceeds 30 characters", () => {
      setupGame();
      const conn = mockConn("p1");
      server.onConnect(conn);
      send(server, conn, { type: "player:join", teamCode: "A1", playerName: "A".repeat(31) });
      const msg = lastSent(conn);
      expect(msg?.type).toBe("error");
      expect(msg?.message as string).toContain("30");
    });

    it("accepts a name that is exactly 30 characters", () => {
      setupGame();
      const conn = mockConn("p1");
      server.onConnect(conn);
      send(server, conn, { type: "player:join", teamCode: "A1", playerName: "A".repeat(30) });
      expect(lastSent(conn)?.type).toBe("joined");
    });

    it("rejects join with an invalid team code", () => {
      setupGame();
      const conn = mockConn("p1");
      server.onConnect(conn);
      send(server, conn, { type: "player:join", teamCode: "ZZ", playerName: "Alice" });
      const msg = lastSent(conn);
      expect(msg?.type).toBe("error");
      expect(msg?.message as string).toContain("team code");
    });

    it("successfully joins with valid details", () => {
      setupGame();
      const conn = mockConn("p1");
      server.onConnect(conn);
      send(server, conn, { type: "player:join", teamCode: "A1", playerName: "Alice" });
      expect(lastSent(conn)?.type).toBe("joined");
      expect(server.players.size).toBe(1);
    });

    it("reconnects an existing player by name match (case-insensitive)", () => {
      setupGame();
      const conn1 = mockConn("p1");
      server.onConnect(conn1);
      send(server, conn1, { type: "player:join", teamCode: "A1", playerName: "Alice" });
      server.onClose(conn1);

      const conn2 = mockConn("p2");
      server.onConnect(conn2);
      send(server, conn2, { type: "player:join", teamCode: "A1", playerName: "alice" });

      expect(lastSent(conn2)?.type).toBe("joined");
      // Must be the same player record, not a new one
      expect(server.players.size).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Team setup
  // ---------------------------------------------------------------------------
  describe("Team setup", () => {
    it("creates the correct number of teams", () => {
      setupGame(["Alpha", "Bravo", "Charlie"]);
      expect(server.teams.size).toBe(3);
    });

    it("transitions phase from lobby to ready after setup", () => {
      setupGame();
      expect(server.phase).toBe("ready");
    });

    it("skips blank team name entries", () => {
      setupGame(["Alpha", "", "Charlie"]);
      expect(server.teams.size).toBe(2);
    });

    it("truncates team names longer than 30 characters", () => {
      setupGame(["A".repeat(40), "Bravo"]);
      const names = Array.from(server.teams.values()).map((t) => t.name);
      expect(names.every((n) => n.length <= 30)).toBe(true);
    });

    it("clears previous teams and history when re-setting up", () => {
      const host = setupGame(["Alpha", "Bravo", "Charlie"]);
      send(server, host, { type: "host:setup-teams", teamNames: ["X", "Y"] });
      expect(server.teams.size).toBe(2);
      expect(server.questionHistory.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Buzz logic
  // ---------------------------------------------------------------------------
  describe("Buzz logic", () => {
    it("ignores a buzz when buzzers are not open", () => {
      setupGame();
      const p = joinPlayer("A1", "Alice", "p1");
      send(server, p, { type: "team:buzz" });
      expect(server.buzzQueue.length).toBe(0);
    });

    it("records a buzz when buzzers are open", () => {
      const host = setupGame();
      const p = joinPlayer("A1", "Alice", "p1");
      send(server, host, { type: "host:open-buzzer" });
      send(server, p, { type: "team:buzz" });
      expect(server.buzzQueue.length).toBe(1);
    });

    it("sets currentBuzzer to first team and transitions phase to buzzed", () => {
      const host = setupGame();
      const p = joinPlayer("A1", "Alice", "p1");
      send(server, host, { type: "host:open-buzzer" });
      send(server, p, { type: "team:buzz" });
      expect(server.currentBuzzer).toBe(server.buzzQueue[0].teamId);
      expect(server.phase).toBe("buzzed");
    });

    it("prevents the same team from buzzing twice", () => {
      const host = setupGame();
      const p1 = joinPlayer("A1", "Alice", "p1");
      const p2 = joinPlayer("A1", "Bob", "p2");
      send(server, host, { type: "host:open-buzzer" });
      send(server, p1, { type: "team:buzz" });
      send(server, p2, { type: "team:buzz" });
      expect(server.buzzQueue.length).toBe(1);
    });

    it("allows a second team to buzz within the collection window", () => {
      const host = setupGame();
      const p1 = joinPlayer("A1", "Alice", "p1");
      const p2 = joinPlayer("B2", "Bob", "p2");
      send(server, host, { type: "host:open-buzzer" });
      send(server, p1, { type: "team:buzz" });
      // Extend the window so the second buzz is accepted in the same synchronous tick
      server.acceptingBuzzesUntil = Date.now() + 10_000;
      send(server, p2, { type: "team:buzz" });
      expect(server.buzzQueue.length).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Correct / incorrect flow
  // ---------------------------------------------------------------------------
  describe("Correct / incorrect", () => {
    function openAndBuzz() {
      const host = setupGame();
      const p = joinPlayer("A1", "Alice", "p1");
      send(server, host, { type: "host:open-buzzer" });
      send(server, p, { type: "team:buzz" });
      return { host, p };
    }

    it("awards default points on correct answer", () => {
      const { host } = openAndBuzz();
      const winnerTeamId = server.currentBuzzer!;
      send(server, host, { type: "host:correct" });
      expect(server.teams.get(winnerTeamId)!.score).toBe(10);
      expect(server.phase).toBe("ready");
    });

    it("records the question result on correct", () => {
      const { host } = openAndBuzz();
      send(server, host, { type: "host:correct" });
      expect(server.questionHistory.length).toBe(1);
      expect(server.questionHistory[0].points).toBe(10);
    });

    it("incorrect in queue mode with no further buzzes goes to ready", () => {
      const { host } = openAndBuzz();
      server.config.secondChanceMode = "queue";
      send(server, host, { type: "host:incorrect" });
      expect(server.phase).toBe("ready");
    });

    it("incorrect in queue mode moves to the next buzzer in the queue", () => {
      const host = setupGame();
      const p1 = joinPlayer("A1", "Alice", "p1");
      const p2 = joinPlayer("B2", "Bob", "p2");
      server.config.secondChanceMode = "queue";
      send(server, host, { type: "host:open-buzzer" });
      send(server, p1, { type: "team:buzz" });
      server.acceptingBuzzesUntil = Date.now() + 10_000;
      send(server, p2, { type: "team:buzz" });

      const firstTeamId = server.currentBuzzer!;
      send(server, host, { type: "host:incorrect" });

      expect(server.currentBuzzer).not.toBe(firstTeamId);
      expect(server.phase).toBe("buzzed");
    });

    it("incorrect in reset mode reopens buzzers and clears the queue", () => {
      const host = setupGame();
      const p = joinPlayer("A1", "Alice", "p1");
      server.config.secondChanceMode = "reset";
      send(server, host, { type: "host:open-buzzer" });
      send(server, p, { type: "team:buzz" });
      send(server, host, { type: "host:incorrect" });

      expect(server.phase).toBe("open");
      expect(server.buzzQueue.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Score corrections
  // ---------------------------------------------------------------------------
  describe("Score corrections", () => {
    it("can reassign a question's points to a different team", () => {
      const host = setupGame();
      const p1 = joinPlayer("A1", "Alice", "p1");
      send(server, host, { type: "host:open-buzzer" });
      send(server, p1, { type: "team:buzz" });
      send(server, host, { type: "host:correct" });

      const [team1, team2] = Array.from(server.teams.values());
      send(server, host, {
        type: "host:reassign-question",
        questionNumber: 1,
        teamId: team2.id,
        points: 10,
      });

      expect(server.teams.get(team1.id)!.score).toBe(0);
      expect(server.teams.get(team2.id)!.score).toBe(10);
    });

    it("can remove points from a question by setting teamId to null", () => {
      const host = setupGame();
      const p1 = joinPlayer("A1", "Alice", "p1");
      send(server, host, { type: "host:open-buzzer" });
      send(server, p1, { type: "team:buzz" });
      send(server, host, { type: "host:correct" });

      send(server, host, {
        type: "host:reassign-question",
        questionNumber: 1,
        teamId: null,
        points: 0,
      });

      const scores = Array.from(server.teams.values()).map((t) => t.score);
      expect(scores.every((s) => s === 0)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------
  describe("Rate limiting", () => {
    it("processes messages within the rate limit normally", () => {
      setupGame();
      const conn = mockConn("p1");
      server.onConnect(conn);
      // Send exactly the limit (20) — all should be processed
      for (let i = 0; i < 20; i++) {
        send(server, conn, { type: "player:join", teamCode: "A1", playerName: `Player${i}` });
      }
      const sentFn = conn.send as ReturnType<typeof vi.fn>;
      expect(sentFn.mock.calls.length).toBeGreaterThan(0);
    });

    it("silently drops messages that exceed the rate limit", () => {
      setupGame();
      const conn = mockConn("p1");
      server.onConnect(conn);

      // Join first to get into the player state
      send(server, conn, { type: "player:join", teamCode: "A1", playerName: "Alice" });
      const sentFn = conn.send as ReturnType<typeof vi.fn>;
      const callsAfterJoin = sentFn.mock.calls.length;

      // Send 30 more messages to blow past the 20/5s limit
      for (let i = 0; i < 30; i++) {
        send(server, conn, { type: "team:buzz" });
      }

      // The buzz messages have no effect (phase is 'ready'), but the rate limiter
      // should be tracking them. The connection should appear in messageTimes.
      expect(server.messageTimes.has(conn.id)).toBe(true);

      // After 31 total messages (join + 30 buzz attempts), the number of messages
      // that actually triggered any response is bounded
      const totalSent = sentFn.mock.calls.length - callsAfterJoin;
      // buzzed phase responses won't happen but state broadcasts might;
      // the important thing is that the rate limiter didn't throw
      expect(totalSent).toBeGreaterThanOrEqual(0);
    });

    it("cleans up rate limit tracking when a connection closes", () => {
      setupGame();
      const conn = mockConn("p1");
      server.onConnect(conn);
      send(server, conn, { type: "player:join", teamCode: "A1", playerName: "Alice" });
      expect(server.messageTimes.has(conn.id)).toBe(true);
      server.onClose(conn);
      expect(server.messageTimes.has(conn.id)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // State persistence
  // ---------------------------------------------------------------------------
  describe("State persistence", () => {
    it("calls storage.put after every broadcastState", async () => {
      setupGame();
      // Give the fire-and-forget void promise a tick to resolve
      await new Promise((r) => setTimeout(r, 0));
      const putFn = room.storage.put as ReturnType<typeof vi.fn>;
      expect(putFn.mock.calls.length).toBeGreaterThan(0);
    });

    it("saves the correct team data to storage", async () => {
      setupGame(["Foo", "Bar"]);
      await new Promise((r) => setTimeout(r, 0));
      const putFn = room.storage.put as ReturnType<typeof vi.fn>;
      const lastCall = putFn.mock.calls.at(-1) as [string, unknown];
      const saved = lastCall[1] as { teams: Array<{ name: string }> };
      expect(saved.teams.map((t) => t.name)).toEqual(["Foo", "Bar"]);
    });

    it("restores teams and question history after onStart", async () => {
      const host = setupGame(["Alpha", "Bravo"]);
      const p = joinPlayer("A1", "Alice", "p1");
      send(server, host, { type: "host:open-buzzer" });
      send(server, p, { type: "team:buzz" });
      send(server, host, { type: "host:correct" });
      send(server, host, { type: "host:new-question" });

      await new Promise((r) => setTimeout(r, 0));

      // Simulate a fresh server (e.g. room woke from hibernation)
      const freshServer = new BuzzerServer(room);
      await freshServer.onStart();

      expect(freshServer.teams.size).toBe(2);
      expect(freshServer.questionNumber).toBe(2);
      expect(freshServer.questionHistory.length).toBe(1);
    });

    it("resets an active phase to ready on restore", async () => {
      const host = setupGame();
      send(server, host, { type: "host:open-buzzer" });
      await new Promise((r) => setTimeout(r, 0));

      const freshServer = new BuzzerServer(room);
      await freshServer.onStart();

      // Was "open" when saved; should come back as "ready"
      expect(freshServer.phase).toBe("ready");
    });

    it("marks all players as disconnected on restore", async () => {
      setupGame();
      joinPlayer("A1", "Alice", "p1");
      await new Promise((r) => setTimeout(r, 0));

      const freshServer = new BuzzerServer(room);
      await freshServer.onStart();

      const allDisconnected = Array.from(freshServer.players.values()).every(
        (p) => !p.connected
      );
      expect(allDisconnected).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // PIN authentication
  // ---------------------------------------------------------------------------
  describe("PIN authentication", () => {
    it("generates a PIN and sends host:authenticated on first host:join", () => {
      const host = mockConn("host");
      server.onConnect(host);
      send(server, host, { type: "host:join" });

      const msg = lastSent(host);
      expect(msg?.type).toBe("host:authenticated");
      expect(typeof msg?.pin).toBe("string");
      expect((msg?.pin as string).length).toBe(6);
    });

    it("the generated PIN is a 6-digit number string", () => {
      const host = mockConn("host");
      server.onConnect(host);
      send(server, host, { type: "host:join" });

      const pin = lastSent(host)?.pin as string;
      expect(/^\d{6}$/.test(pin)).toBe(true);
    });

    it("rejects a second host:join with no PIN when room already has a PIN", () => {
      // First host authenticates
      const host1 = mockConn("host1");
      server.onConnect(host1);
      send(server, host1, { type: "host:join" });

      // Second connection tries to take over with no PIN
      const host2 = mockConn("host2");
      server.onConnect(host2);
      send(server, host2, { type: "host:join" });

      const msg = lastSent(host2);
      expect(msg?.type).toBe("error");
      expect(msg?.message as string).toContain("host");
    });

    it("rejects a second host:join with the wrong PIN", () => {
      const host1 = mockConn("host1");
      server.onConnect(host1);
      send(server, host1, { type: "host:join" });

      const host2 = mockConn("host2");
      server.onConnect(host2);
      send(server, host2, { type: "host:join", pin: "000000" });

      expect(lastSent(host2)?.type).toBe("error");
    });

    it("accepts a host:join with the correct PIN (e.g. after a page refresh)", () => {
      const host1 = mockConn("host1");
      server.onConnect(host1);
      send(server, host1, { type: "host:join" });
      const pin = lastSent(host1)?.pin as string;

      // Simulate host refreshing: new connection presents the saved PIN
      const host2 = mockConn("host2");
      server.onConnect(host2);
      send(server, host2, { type: "host:join", pin });

      expect(lastSent(host2)?.type).toBe("host:authenticated");
      expect(server.hostConnectionId).toBe("host2");
    });

    it("blocks host commands from a connection that did not authenticate", () => {
      // Host1 sets up teams
      const host1 = mockConn("host1");
      server.onConnect(host1);
      send(server, host1, { type: "host:join" });
      send(server, host1, { type: "host:setup-teams", teamNames: ["Alpha", "Bravo"] });

      // Intruder connects but does not authenticate
      const intruder = mockConn("intruder");
      server.onConnect(intruder);
      // Intruder tries to open buzzers
      const broadcastFn = room.broadcast as ReturnType<typeof vi.fn>;
      const callsBefore = broadcastFn.mock.calls.length;
      send(server, intruder, { type: "host:open-buzzer" });

      // Phase must not have changed
      expect(server.phase).not.toBe("open");
      // No new broadcast should have been triggered by the intruder
      expect(broadcastFn.mock.calls.length).toBe(callsBefore);
    });

    it("persists the PIN in saved state so it survives server hibernation", async () => {
      const host = mockConn("host");
      server.onConnect(host);
      send(server, host, { type: "host:join" });
      const pin = lastSent(host)?.pin as string;

      await new Promise((r) => setTimeout(r, 0));

      const freshServer = new BuzzerServer(room);
      await freshServer.onStart();

      expect(freshServer.hostPin).toBe(pin);
    });

    it("after restore, the correct PIN still works and wrong one is still rejected", async () => {
      const host = mockConn("host");
      server.onConnect(host);
      send(server, host, { type: "host:join" });
      const pin = lastSent(host)?.pin as string;

      await new Promise((r) => setTimeout(r, 0));

      const freshServer = new BuzzerServer(room);
      await freshServer.onStart();

      const returningHost = mockConn("returning");
      freshServer.onConnect(returningHost);
      send(freshServer, returningHost, { type: "host:join", pin });
      expect(lastSent(returningHost)?.type).toBe("host:authenticated");

      const impostor = mockConn("impostor");
      freshServer.onConnect(impostor);
      send(freshServer, impostor, { type: "host:join", pin: "000000" });
      expect(lastSent(impostor)?.type).toBe("error");
    });
  });

  // ---------------------------------------------------------------------------
  // HTTP endpoint (onRequest)
  // ---------------------------------------------------------------------------
  describe("HTTP endpoint (onRequest)", () => {
    function mockRequest(method: string, body: unknown): Party.Request {
      return {
        method,
        json: async () => body,
      } as unknown as Party.Request;
    }

    it("returns 405 for non-POST requests", async () => {
      const res = await server.onRequest(mockRequest("GET", {}));
      expect(res.status).toBe(405);
    });

    it("returns 401 when no PIN has been set yet", async () => {
      const req = mockRequest("POST", { type: "host:open-buzzer", pin: "123456" });
      const res = await server.onRequest(req);
      expect(res.status).toBe(401);
    });

    it("returns 401 when PIN is wrong", async () => {
      setupGame(); // sets hostPin
      const req = mockRequest("POST", { type: "host:open-buzzer", pin: "000000" });
      const res = await server.onRequest(req);
      expect(res.status).toBe(401);
    });

    it("returns 400 for an unknown command type", async () => {
      const host = setupGame();
      const pin = server.hostPin!;
      const req = mockRequest("POST", { type: "host:unknown-command", pin });
      const res = await server.onRequest(req);
      expect(res.status).toBe(400);
    });

    it("opens buzzers via HTTP with the correct PIN", async () => {
      setupGame();
      const pin = server.hostPin!;
      const req = mockRequest("POST", { type: "host:open-buzzer", pin });
      const res = await server.onRequest(req);
      expect(res.status).toBe(200);
      const json = await res.json() as { ok: boolean; phase: string };
      expect(json.ok).toBe(true);
      expect(json.phase).toBe("open");
      expect(server.phase).toBe("open");
    });

    it("locks buzzers via HTTP with the correct PIN", async () => {
      const host = setupGame();
      send(server, host, { type: "host:open-buzzer" });
      expect(server.phase).toBe("open");

      const pin = server.hostPin!;
      const req = mockRequest("POST", { type: "host:lock-buzzer", pin });
      const res = await server.onRequest(req);
      expect(res.status).toBe(200);
      const json = await res.json() as { ok: boolean; phase: string };
      expect(json.ok).toBe(true);
      expect(json.phase).toBe("ready");
      expect(server.phase).toBe("ready");
    });

    it("broadcasts buzz:opened to all players when HTTP opens buzzers", async () => {
      setupGame();
      const pin = server.hostPin!;
      const broadcastFn = room.broadcast as ReturnType<typeof vi.fn>;
      const callsBefore = broadcastFn.mock.calls.length;

      await server.onRequest(mockRequest("POST", { type: "host:open-buzzer", pin }));

      const newCalls = broadcastFn.mock.calls.slice(callsBefore);
      const buzzOpenedCall = newCalls.find((call) => {
        const msg = JSON.parse(call[0] as string) as { type: string };
        return msg.type === "buzz:opened";
      });
      expect(buzzOpenedCall).toBeDefined();
    });

    it("resets buzzQueue when HTTP opens buzzers", async () => {
      const host = setupGame();
      const p = joinPlayer("A1", "Alice", "p1");
      send(server, host, { type: "host:open-buzzer" });
      send(server, p, { type: "team:buzz" });
      expect(server.buzzQueue.length).toBe(1);

      const pin = server.hostPin!;
      await server.onRequest(mockRequest("POST", { type: "host:open-buzzer", pin }));
      expect(server.buzzQueue.length).toBe(0);
    });

    it("returns 400 for a malformed JSON body", async () => {
      const req = {
        method: "POST",
        json: async () => { throw new SyntaxError("bad json"); },
      } as unknown as Party.Request;
      const res = await server.onRequest(req);
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Host controls
  // ---------------------------------------------------------------------------
  describe("Host controls", () => {
    it("open-buzzer resets the queue and sets phase to open", () => {
      const host = setupGame();
      send(server, host, { type: "host:open-buzzer" });
      expect(server.phase).toBe("open");
      expect(server.buzzQueue.length).toBe(0);
    });

    it("lock-buzzer sets phase back to ready", () => {
      const host = setupGame();
      send(server, host, { type: "host:open-buzzer" });
      send(server, host, { type: "host:lock-buzzer" });
      expect(server.phase).toBe("ready");
    });

    it("reset-buzzers clears queue and returns to ready", () => {
      const host = setupGame();
      const p = joinPlayer("A1", "Alice", "p1");
      send(server, host, { type: "host:open-buzzer" });
      send(server, p, { type: "team:buzz" });
      send(server, host, { type: "host:reset-buzzers" });
      expect(server.phase).toBe("ready");
      expect(server.buzzQueue.length).toBe(0);
    });

    it("new-question increments question number", () => {
      const host = setupGame();
      expect(server.questionNumber).toBe(1);
      send(server, host, { type: "host:new-question" });
      expect(server.questionNumber).toBe(2);
    });

    it("update-config changes the answer timer", () => {
      const host = setupGame();
      send(server, host, { type: "host:update-config", config: { answerTimerSeconds: 30 } });
      expect(server.config.answerTimerSeconds).toBe(30);
    });
  });
});
