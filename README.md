# RPG AI

A small browser RPG. An AI host runs a text adventure in a Markdown world, reading and updating a private copy of that world for each game.

The current world: **The Dry Summer of Merrowdale**. A lake village has had no rain for sixty-one days, its sacred bell is missing, and a witch-finder has come to town. The story is open-ended, with no fixed win condition.

## Run

Requires Node.js 20 or newer and an OpenRouter API key.

1. Add this to `.env`:

   ```text
   API_KEY=your_openrouter_key
   ```
2. Start the server:

   ```sh
   npm start
   ```
3. Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

For a phone on the same Wi-Fi network:

```sh
HOST=0.0.0.0 npm start
```

Then open `http://YOUR_MAC_IP:3000` on the phone. The API key remains on the Mac.

## Play

- A new game opens by listing the characters you can play. Reply with a name or number.
- After that, type what your character does or says, in plain words.
- To ask the host something outside the story (a recap, the rules, your options), put it in parentheses. The host answers with an **(Out of character)** label.
- **New game** starts over from a fresh copy of the world. Earlier games stay saved on disk.

## Layout

```
system_prompt.md   the host's role
host_rules.md      how the host runs play: turn loop, dice, harm, time, secrets
game/
  state.md         the present moment: time, player location, timed world events, open threads
  log.md           append-only chronicle of past events
world/
  player/          selectable player characters (optional; without it one is picked at random from characters/)
  characters/      one file per character
  <Entity>.md      one file per other entity: places, items, spirits…
saves/
  players/<player-id>.json   which game that browser is playing
  <game-id>/
    session.json             chat history, including the owning player id
    files/                   this game's private copy of game/ and world/
```

`game/` and `world/` in the project root are the pristine templates. Play never modifies them.

## Players

Each browser gets an opaque `rpg_player` cookie on its first API request: HttpOnly, SameSite=Lax, and marked Secure behind an HTTPS proxy. Every save records the player that owns it, and a game belonging to another player reads as "not found". A visitor with no cookie always starts a fresh story, so nobody lands in someone else's game.

This identifies a browser, not a person: clearing cookies starts over, and a shared browser profile shares the games. `ACCESS_PASSWORD`, if set, is a single shared gate in front of everything and does not distinguish players.

## How a turn works

The server sends the model:

- the system prompt and host rules,
- the recent chat,
- a manifest of the save's files,
- `game/state.md`, plus the files linked from its Player Character section (the character sheet and current location).

Every other file is loaded only when the model asks for it with `read_file`. The model resolves uncertain actions with `roll_dice` and records changes with `write_file`, then ends the turn by replying with the narration as plain text. All tools are confined to that game's `files/` folder, and each turn's writes are staged and committed atomically.

The narration streams to the browser as the model writes it. The turn request (with `Accept: application/x-ndjson`) returns newline-delimited JSON events:

- `delta`: the next piece of narration text;
- `reset`: discard the text so far (the model was thinking aloud before a tool call, or a failed request is being retried);
- `ping`: a heartbeat every 15 seconds, so proxies keep the connection open;
- `done`: the final narration, once the turn has committed;
- `error`: the turn failed and changed nothing.

Streamed text is provisional: the world only changes when the turn commits. Clients that don't ask for NDJSON get a single JSON response instead.

Transient model failures are retried within a one-minute turn budget (the server gives up at 55 seconds, the browser at 60). An interrupted browser request keeps the same pending action and turn ID for the Retry button.

## Configuration

- `API_KEY` or `OPENROUTER_API_KEY`: OpenRouter key
- `RPG_MODEL`: model slug; defaults to `inclusionai/ling-3.0-flash-vl:free`
- `HOST`: bind address; defaults to `127.0.0.1`
- `PORT`: port; defaults to `3000`
- `ACCESS_PASSWORD`: shared password for the site; required when binding to anything but localhost
- `SAVE_DIR`: where games are stored; defaults to `saves/` in the project. Point it at a mounted volume (e.g. `/data/saves`) on hosts with ephemeral disks, or every deploy wipes the saves.

## Test

```sh
npm test
```
