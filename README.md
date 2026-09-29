# RPG AI

A small browser RPG. An AI host runs a text adventure in a Markdown world, reading and updating a private copy of that world for each game.

Two worlds are installed, and a new game picks one:

- **The Dry Summer of Merrowdale** — a lake village has had no rain for sixty-one days, its sacred bell is missing, and a witch-finder has come to town. Four characters to choose from, resolved on 2d6 against four stats.
- **The Mirror of Returning** — a cultivation world. You are a museum conservator from the present day, one thousand and forty-one years the wrong way, Realm 0 among immortals, and the way home hangs at the belt of a Realm 6 elder twenty days south. Advancement through Insight, sect rank and missions; the realm gap decides fights, not dice.

Both are open-ended, with no fixed win condition.

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

- A new game opens by naming the character you play, or listing the choices if the world has several. Reply with a name or number.
- After that, type what your character does or says, in plain words.
- To ask the host something outside the story (a recap, the rules, your options), put it in parentheses. The host answers with an **(Out of character)** label.
- **New game** starts over from a fresh copy of the world. Earlier games stay saved on disk.

## Layout

```
system_prompt.md   the host's role, the file conventions, the turn loop, secrets, craft
worlds/<slug>/
  world.json       slug, title, and one-line blurb shown in the world picker
  rules.md         this world's game system and colour (optional; never copied into saves)
  opening.md       the first message the player reads, shown verbatim before any model request (optional)
  game/
    state.md       the present moment: time, player location, timed world events, open threads
    log.md         append-only chronicle of past events
  world/
    player/        selectable player characters (optional; without it one is picked at random from characters/)
    characters/    one file per character
    <Entity>.md    one file per other entity: places, items, spirits…
saves/
  players/<player-id>.json   which game that browser is playing
  <game-id>/
    session.json             chat history, the owning player id, and the world slug
    files/                   this game's private copy of game/ (state and log) and world/
```

Each folder under `worlds/` is a self-contained, pristine template. Play never modifies them.

## Worlds

Rules come in two layers. `system_prompt.md` holds what every world shares: where files live, how a turn is carried out, how `roll_dice` is used honestly, how secrets and out-of-character questions work, and how to narrate. It defines no game system. `worlds/<slug>/rules.md` holds the system and the colour — what is rolled and what the results mean, harm and healing, time, advancement, tone, and the world's own tables. A world's `rules.md` is appended to the shared prompt for that game's turns and wins wherever the two differ. It lives beside the world, not in the save, so editing it reaches games already in progress.

That split is what lets two worlds disagree: Merrowdale resolves actions with 2d6 against four stats and a flat 6 Health, while a world built on cultivation realms can put a realm gap outside the modifier clamp and scale health by rank, without either file needing to know about the other.

If a world has an `opening.md`, that text is the first message of every new game, shown exactly as written and before the host is ever called — so the player always has something to read and answer, whatever the provider is doing. Without one, the server generates the opening from `world/player/`: the character's name and concept if there is one, a numbered list if there are several. A world with a scripted opening should tell its host so in `game/state.md`, or the first turn will narrate the scene twice.

`GET /api/worlds` lists what's installed. Starting a game posts the chosen slug; with exactly one world installed the slug may be omitted, and the browser skips straight past the picker. A save records the world it came from, and because it holds its own copy of the files, an existing game keeps playing even if that world is later edited or removed.

To add a world, create `worlds/<slug>/` with a `game/` folder (holding `state.md` and `log.md`), a `world/` folder, and a `world.json`:

```json
{ "slug": "ashfall", "title": "Ashfall", "blurb": "A mountain burns and the passes are closing." }
```

A folder without a `game/state.md` is ignored rather than offered as a broken game. Slugs are lower-case letters, digits and hyphens.

## Players

Each browser gets an opaque `rpg_player` cookie on its first API request: HttpOnly, SameSite=Lax, and marked Secure behind an HTTPS proxy. Every save records the player that owns it, and a game belonging to another player reads as "not found". A visitor with no cookie always starts a fresh story, so nobody lands in someone else's game.

This identifies a browser, not a person: clearing cookies starts over, and a shared browser profile shares the games. There is no login and no gate — anyone who can reach the server can start a game, and each browser gets its own.

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
- `HOST`: bind address; defaults to `0.0.0.0`
- `PORT`: port; defaults to `3000`
- `OPENROUTER_URL`: model endpoint; defaults to OpenRouter. Point it at a stub to exercise turns without a provider.
- `SAVE_DIR`: where games are stored; defaults to `saves/` in the project. Point it at a mounted volume (e.g. `/data/saves`) on hosts with ephemeral disks, or every deploy wipes the saves.

## Test

```sh
npm test
```

## Checking a world

```sh
npm run check-worlds
```

Reports each installed world and exits non-zero if any has errors. Errors are things that would break play: a `[[link]]` with no file, a missing `game/state.md` or `game/log.md`, no `## Player Character` section for the host to pin from, a file that isn't Markdown (it would be dropped when the save is copied), a file over 64 KB, a symbolic link, or a `world.json` slug that disagrees with its folder.

Warnings are things worth knowing: no `Present:` line, so characters in a scene never get pinned; a player character with no `**Concept:**` line, so the picker shows only a name; two entity files sharing a name, so links between them are ambiguous; or text still referring to tools that no longer exist. The same checks run as part of `npm test`, so a broken world fails the suite rather than a player's first turn.
