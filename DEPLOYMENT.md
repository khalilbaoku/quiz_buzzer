# Deployment Guide

This app has two deployable pieces that must both be running for the game to work:

| Piece | What it does | Where it runs |
|---|---|---|
| **Next.js website** | Everything players and hosts see | Vercel (free) |
| **PartyKit server** | Real-time game logic, buzz detection, state | PartyKit / Cloudflare (free tier) |

Think of PartyKit as the engine room. The website is the front door. Both need to be live.

---

## Step-by-step deployment

### Step 1 — Create accounts (10 minutes)

1. **GitHub** — make sure your code is pushed to a repository. You already have git history so just push if you haven't:
   ```sh
   git push origin main
   ```

2. **Vercel** — go to [vercel.com](https://vercel.com) and sign up using your GitHub account (free).

3. **PartyKit** — go to [partykit.io](https://partykit.io) and create an account (free). Then log in from your terminal:
   ```sh
   npx partykit login
   ```

---

### Step 2 — Deploy the PartyKit server (5 minutes)

This is the real-time engine. Run this from the `quiz_buzzer` folder:

```sh
npm run party:deploy
```

When it finishes it will print a URL like:

```
https://buzzer.YOUR-USERNAME.partykit.dev
```

**Save that URL** — you need it in the next step. The important part is everything after `https://` — e.g. `buzzer.your-username.partykit.dev`.

---

### Step 3 — Deploy the website to Vercel (10 minutes)

1. Go to [vercel.com](https://vercel.com) → click **Add New → Project**
2. Connect your GitHub account and import the `quiz_buzzer` repository
3. Before clicking Deploy, scroll down to **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_PARTYKIT_HOST` | `buzzer.your-username.partykit.dev` (no `https://`) |

4. Click **Deploy**

Vercel will build and host the site. You'll get a URL like `quiz-buzzer.vercel.app`.

---

### Step 4 — Test it end to end (5 minutes)

1. Open your Vercel URL on a laptop → click **Host a Quiz** → create teams
2. Open the same URL on your phone → click **Join a Quiz** → enter the room code + team code + your name
3. On the host screen, click **Open Buzzers**
4. On the phone, tap the big button

If the buzz appears on the host screen within milliseconds, everything is working.

---

### Step 5 — Custom domain (optional, ~5 minutes)

If you own a domain (e.g. `quiznight.co.uk`):

1. In Vercel → your project → **Settings → Domains** → add your domain
2. Follow Vercel's DNS instructions (you add a CNAME record at your domain registrar)
3. Vercel handles HTTPS automatically

---

## Local development

To run everything locally (useful for testing changes before deploying):

**Terminal 1 — PartyKit server:**
```sh
npm run party:dev
```
This starts the real-time server on port 1999.

**Terminal 2 — Next.js website:**
```sh
npm run dev
```
This starts the website on port 3000.

Open [http://localhost:3000](http://localhost:3000). To test on a phone on the same Wi-Fi network, use your laptop's local IP address (e.g. `http://192.168.1.x:3000`).

---

## Running tests

```sh
npm test          # run once
npm run test:watch  # watch mode (re-runs on file save)
```

Tests cover: player join validation, team setup, buzz logic, correct/incorrect flow, rate limiting, score corrections, state persistence, and host controls.

---

## Architecture notes

- Each quiz room is a separate PartyKit "room" identified by the 4-character room code.
- Game state (teams, scores, question history) is persisted to Cloudflare Durable Object storage. This means if the host refreshes the page or briefly loses connection, all state is preserved when they reconnect.
- Two hosts visiting the same room code would connect to the same game. See Security below.
- The Shared Screen mode (`/shared/[roomCode]`) uses the same server infrastructure — the room code still exists internally.

---

## Security notes

**Current state — suitable for trusted/private events only.**

Anyone who knows a room code can visit `/host/ROOM` and take over as host (open/lock buzzers, mark answers, edit scores). This is fine for a quiz night with friends but not for a public event.

**How a host PIN would work (not yet implemented):**

When the host creates a room, the server generates a random 6-digit PIN and returns it only to the original host connection. The host's browser stores this PIN in memory. Every host command (`open-buzzer`, `correct`, etc.) includes the PIN. The server rejects any host command without the correct PIN. A second person visiting the host URL would see the room state but could not issue any commands. This is the right next security step before making the app public.

---

## Known limitations

- Room codes are 4 characters (~1 million combinations). Fine for private use; consider 5+ characters for a public launch.
- No built-in round management — the host manually calls "Next Question".
- No tiebreaker mode.

---

## Nice to haves (future improvements)

These are not implemented yet but are the natural next steps:

| Feature | What it means | Effort |
|---|---|---|
| **Host PIN authentication** | Prevents anyone with the URL from taking over as host | Medium |
| **Round management** | Group questions into rounds with separate scoreboards | Medium |
| **Tiebreaker mode** | A dedicated sudden-death round for tied teams | Small |
| **Longer room codes** | Move from 4 to 6 characters for safer public use | Small |
| **Custom points per question** | Override points on the fly per question (UI already partially supports this) | Small |
| **Spectator mode** | Allow observers to watch without joining a team | Small |
| **Admin dashboard** | See all active rooms from one screen | Large |
| **Mobile app** | Native iOS/Android wrapper around the web app (e.g. via Capacitor) | Large |
| **Persistent rooms** | Save a room and resume the same game another day | Medium |
