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

3. Open <http://127.0.0.1:3000>.

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
saves/<game-id>/
  session.json     chat history
  files/           this game's private copy of game/ and world/
```

`game/` and `world/` in the project root are the pristine templates. Play never modifies them.

## How a turn works

The server sends the model:
- the system prompt and host rules,
- the recent chat,
- a manifest of the save's files,
- `game/state.md`, plus the files linked from its Player Character section (the character sheet and current location).

Every other file is loaded only when the model asks for it with `read_file`. The model resolves uncertain actions with `roll_dice`, records changes with `write_file`, and ends the turn with `finish_turn`. All tools are confined to that game's `files/` folder, and each turn's writes are staged and committed atomically.

Transient model failures are retried within a three-minute turn budget. An interrupted browser request keeps the same pending action and turn ID for the Retry button.

## Configuration

- `API_KEY` or `OPENROUTER_API_KEY`: OpenRouter key
- `RPG_MODEL`: model slug; defaults to `inclusionai/ling-3.0-flash-vl:free`
- `HOST`: bind address; defaults to `127.0.0.1`
- `PORT`: port; defaults to `3000`

## Test

```sh
npm test
```
# rpg-ai-server
