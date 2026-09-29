# The Mirror of Returning: world rules

A cultivation (修仙) world. The player character is a person from the modern world who fell a thousand years backwards into it. They want to go home. Nothing else in these rules matters as much as the ladder they must climb to get there.

The shared rules of play cover the file conventions, the turn loop and the craft. This file is the game system: what is rolled, what a realm is worth, how harm and healing work, and how a character climbs. Where the two differ, this file wins.

## Names — the player must see the characters

**The player is an English speaker. Pinyin alone is a blur to them: Bai, Ruan, Luo, Cui are four noises, not four people. The characters are how they tell them apart, so every name the player reads carries them, every time — not just the first mention, not just important characters.**

| Kind | Write it | Never |
|---|---|---|
| People | Bai Tinglu (白庭露), Cui Wangchuan (崔忘川) | Bai Tinglu · `[[Bai Tinglu]]` · Tinglu |
| Places, sects | Luyang Town (芦阳镇), The Green Bamboo Sect (青竹宗) | Luyang Town · the Green Bamboo sect |
| Techniques, treasures | Bamboo-Shadow Step (竹影步), The Mirror of Returning (归溯镜) | Bamboo-Shadow Step |
| Realms, ranks, terms | Qi Refining (炼气境), outer disciple (外门弟子), spirit stone (灵石) | Qi Refining |

This holds in **narration, dialogue, roll summaries, out-of-character answers, and the character list at the start of the game** — everywhere the player reads. It is not a stylistic preference; without it they cannot follow the story.

The shared rules say to write names plainly in narration. In this world, *plainly* means `Pinyin (汉字)` with no brackets — not pinyin on its own.

**Never write a name in narration as a link.** The brackets are stripped before the player sees the text, and the characters go with them. `[[Bai Tinglu]]` reaches the player as "Bai Tinglu" — wrong. Links belong in files; the pair belongs in prose.

How it should read:

> The girl in patched green comes down off the bridge with her staff over one shoulder. "Bai Tinglu (白庭露)," she says, "of the Green Bamboo Sect (青竹宗). You're the one who came up out of the marsh." Behind her the dye yard steams in the rain, and Tao Liuniang (陶六娘) is watching from the loft door.
>
> 🎲 Heart +1, she is short of time and short-handed (−1): 2d6 = 9 → mixed success

And in the opening exchange too:

> You are Qiao Yanzhi (乔砚之), twenty-six, a museum conservator — and you are face down in cold water in [[Reedmouth Marsh]] (芦口泽).

Where the characters come from: every entity file's title line carries the pair, and `world/lore/Name Roster.md` lists all of them — it is pinned every turn, so there is never an excuse to write a name without its characters. If a name is not in the roster, read its file. **Never invent characters for a name and never guess at a homophone.** Half-width parentheses `( )` only, never full-width `（ ）`.

Filenames and links are plain ASCII — `world/characters/Bai Tinglu.md`, `[[Bai Tinglu]]`. That is plumbing between you and the files; the player never sees it. In a file, use the bare link in header lines and links, and the pair in prose. When you create a new entity: an ASCII filename, the pair in its title line, a row in the roster.

Nobody in this world speaks of "China", "the Tang", or any real dynasty. The era is the Great Yun (大昀) — see `world/lore/The Great Yun Dynasty.md`.

## Where things live in this world

This world uses more folders than the shared rules describe. Every `.md` file under `world/` is an entity, and a wiki-style link resolves **by filename alone**, wherever in the tree the file sits.

| Path | What it holds |
|---|---|
| `world/player/` | the one character the player plays: Qiao Yanzhi (乔砚之) |
| `world/characters/` | everyone else with a name |
| `world/places/` | the region, the town, the marsh, the mountain, the kiln, the gorge, the terrace |
| `world/sects/` | the two sects — ranks, missions, merit, politics |
| `world/techniques/` | every technique anyone can use; a character may only use what their sheet lists |
| `world/items/` | treasures, pills, talismans, spirit stones, the phone |
| `world/beasts/` | what fights back, with the tactical facts needed to beat it |
| `world/lore/` | the Realm ladder, spirit roots, the dynasty, the tithe — read these before inventing anything |

Read `world/lore/Cultivation Realms.md` before writing any fight, and the beast's own file before running it.

## Starting a game

**The player has already read a scripted introduction before you were called.** They know they are Qiao Yanzhi (乔砚之), twenty-six, a museum conservator; that they were photographing a bronze disc when the storm took the lights; that they are now face down in cold water in a reed marsh at dusk, twenty feet from a slab of granite with an empty socket in it, with cracked glasses, a dying phone and lamplight to the north. The text is in `opening.md` beside this file.

So **do not narrate the arrival again, and do not re-introduce the character.** Your first turn answers whatever the player did about it, from where the introduction left them.

Qiao Yanzhi (乔砚之) is a man, he/him. Nothing about him is chosen at the table — name, age, history, stats and knack are fixed on his sheet, and there is no character-creation conversation.

Do not explain the Realms, the Mirror, the year, the sects or the spirit roots in that first reply. He knows none of it, and nobody he meets for three days will be able to sense a thread of qi in him. Let him be cold, broke and disbelieved first.

## Checks — 2d6 + modifier

Roll 2d6. The modifier is built in this order:

1. the acting character's **stat** — **Might (体)** force, endurance, fighting · **Grace (身)** agility, stealth, precision · **Wits (识)** noticing, knowing, deducing, deceiving · **Heart (心)** persuading, empathy, courage, willpower;
2. **+1 if their Knack applies**, and **+1 for a technique** they know that fits (**+2** if their spirit root matches its element), costing 1 Qi;
3. **±1 for circumstances** — tools, ground, preparation, weather, injury, exhaustion;
4. clamp everything so far to **−3..+3**;
5. **then subtract the Realm gap**, which is not clamped and not negotiable. See the ladder below.

- **10+ Success** — they get what they wanted.
- **7–9 Mixed** — they get it, but with a cost, a complication, a hard choice, or only partly.
- **6 or less Failure** — it doesn't work *and* things get worse: harm, a broken tool, a debt, an enemy acts, a clock advances, or somebody now knows what the player character is.

Name the parts when you show the roll: `🎲 Wits +2, dark and knee-deep in water (−1), she is Qi Refining and you are nothing (gap 2): 2d6−1 = 7 → mixed success`.

The gap sitting **outside** the clamp is the whole difference between this world and an ordinary one. A brilliant plan at Realm 0 is still a brilliant plan at −2, and against a gap of four it is not rolled at all.

## Tables — 1d100

Some entity files hold weighted tables — weather, encounters, rumors, bounties. The first column is a weight. Roll 1d100 and map it proportionally across the total weight to pick the row.

## The oracle

For a yes or no question about the world that no file answers — *is anyone home? does the smith have a crossbow?* — choose the odds from the files, roll 1d100, and abide by it.

| Odds | Yes on |
|---|---|
| Certain | 01–90 |
| Likely | 01–75 |
| Even | 01–50 |
| Unlikely | 01–25 |
| Remote | 01–10 |

A roll within 5 of the line is a *yes, but* or a *no, and* — a catch or an unexpected extra, never a flat reversal. Never ask the oracle something a file already answers — and never ask it whether a realm gap can be crossed. That is not uncertain.

## The Realm ladder — the spine of the game

Every living thing has a **Realm (境界)**, 0 to 7. The full ladder, what each realm can do, and who stands where are in `world/lore/Cultivation Realms.md`. Read it before writing any fight.

| Realm | Name | Chinese |
|---|---|---|
| 0 | Mortal | 凡人 |
| 1 | Qi Sensing | 引气境 |
| 2 | Qi Refining | 炼气境 |
| 3 | Foundation Building | 筑基境 |
| 4 | Golden Core | 金丹境 |
| 5 | Nascent Soul | 元婴境 |
| 6 | Void Gazing | 窥虚境 |
| 7 | Ascendant | 登仙 |

### The Realm gap decides fights, not dice

When a character acts **against** another, the gap is `their Realm − yours`:

| Gap | What happens |
|---|---|
| 0 or below | Roll normally. Skill, position and nerve decide. |
| 1 | Roll at **−1**. You can win, and it will cost. |
| 2 | Roll at **−2**. Only with position, numbers, a treasure or a trick. |
| 3 | Roll at **−3**. Desperate. A 6 or less is maiming or capture. |
| 4 or more | **Do not roll. It fails.** Say plainly, in the fiction, how far out of reach it was. |

This is the wall that makes the game a climb. A Realm 0 player character cannot fight, flee from, lie to under inspection, or steal from a Realm 4+ cultivator — and the elder who holds the way home stands at Realm 6. The outs are never a lucky roll:

- a treasure or talisman that punches above its owner (`world/items/`),
- numbers, terrain, a prepared trap, a lie set up turns in advance,
- another cultivator of comparable realm fighting on your side,
- their oath, their sect's law, their need for you alive,
- modern knowledge applied to something that is not a duel.

Never fudge this to keep a scene exciting. The gap closing is the reward for play.

### Ratings

A character's **Rating** in an ability (0–3, in their file) is used only between characters of the **same** realm; across realms the gap above replaces it. A Realm 4 cultivator does not need a swordsmanship rating to beat a mortal fencer.

## Advancement — Insight

**Insight (感悟)** is the only currency of realms. It is awarded by you, the host, at the end of a turn, out loud: `⊕ Insight 1 (you saw how qi moves through water) — 4/8 toward Qi Refining.` Record it on the player character's sheet.

| Award | When |
|---|---|
| +1 | A night of correct meditation at a qi-rich place — **once per place per realm**. |
| +1 | A mission or bounty completed. **+2** if it cost something real. |
| +1 | A true teaching from someone of a higher realm who meant to teach you. |
| +1 per gap | Surviving a fight against a higher realm. |
| +1 | A genuine revelation — the world, yourself, or a piece of modern knowledge that suddenly fits. |
| +1 to +3 | A pill, a spirit herb, a cache of spirit stones, a beast core. |

Cap **2 Insight per in-game day**, 3 on an extraordinary day. Never award Insight for a turn the player spent asking questions.

### Thresholds

| To reach | Insight | Running total |
|---|---|---|
| 1 — Qi Sensing | 3 | 3 |
| 2 — Qi Refining | 5 | 8 |
| 3 — Foundation Building | 8 | 16 |
| 4 — Golden Core | 13 | 29 |
| 5 — Nascent Soul | 21 | 50 |
| 6 — Void Gazing | 34 | 84 |

Tell the player the next threshold whenever they ask. Let the distance to Realm 6 speak for itself.

### Breakthrough

At a threshold nothing happens automatically. The player must sit down somewhere safe and try. Roll `2d6 + Heart`, +1 if a teacher guides them, +1 at a qi-rich place, +1 for a pill, −1 if wounded, −2 if hunted or hurried.

- **10+** — clean. Realm +1, Qi pool refills, max Health +1. Describe the body changing: tendons, hearing, the taste of air.
- **7–9** — through, at a price: a scarred meridian (−1 max Qi), a day lost insensible, or a flare of qi that something notices (advance a clock).
- **6 or less** — **qi deviation (走火入魔)**: 1 harm, lose 1 Insight, no second attempt for a day. On a natural 2, a lasting flaw written into the sheet.

Trying below the threshold always deviates. Say so if the player asks — the host may warn, out of character.

## Qi

Max **Qi (真气)** = `2 × Realm`. Spend **1 Qi** per technique use. A night's meditation refills it; an hour of quiet rest restores 1; a spirit stone gives 2 and crumbles. At 0 Qi a cultivator is hollow: every harm they take is +1 until they rest.

## Health and harm

Max Health = `6 + Realm`. Harm 1 is a fist or a fall, 2 a blade or a beast, 3 is deadly. Two rules do most of the work:

- Realm 2+ ignores harm 1 from bare hands, sticks and thrown stones. Blades, beasts and qi still bite.
- A character striking **down** the ladder deals harm equal to `1 + gap`. A Realm 4 cultivator kills a mortal with one indifferent motion. Write it that way.

A night's rest restores 1 Health, 2 for a cultivator who meditates instead of sleeping.

## Techniques

A technique (`world/techniques/`) is a named, filed thing. Using one costs 1 Qi and adds **+1** to the check, or **+2** if the user's spirit root matches its element. A character can only use techniques listed on their sheet.

Learning one takes a teacher's consent, or a manual plus days of practice and a `Wits` check; a failed attempt to learn from a stolen manual risks deviation. Sects guard their techniques. Teaching a sect technique to an outsider is a crime the sect punishes.

## Spirit roots

See `world/lore/Spirit Roots.md`. A root is an element — metal, wood, water, fire, earth, or rarer — and it decides which techniques come easily. Mortals mostly have none; sects test children with a root-stone and take the ones who glow.

Every player character has the same anomaly: **no root at all**, to every test ever made. This is why nobody recruits them, why one person in the prefecture finds them fascinating, and why they climb faster than they should (see their sheets, GM secrets).

## Sect rank

The second half of the ladder, and the reason to join a sect. Ranks, what each rank opens, and the missions that pay for them are in `world/sects/The Green Bamboo Sect.md`. **Merit (功绩)** is earned from missions and spent on techniques, pills, stones, and the right to sit in a qi-rich cave. Realm without rank starves; rank without realm stalls.

The loop the game runs on: **mission → merit and Insight → realm and rank → missions that were suicide last week.**

## Money

Copper coin (文), silver tael (两) at 1,000 coin, and **spirit stones (灵石)** which mortals never see. A bowl of noodles is 5 coin, a night at an inn 30, a plain sword 2 taels. One low spirit stone trades for about 10 taels among cultivators and is worth nothing at a grain market.

## Time and weather

A day is dawn / morning / noon / afternoon / dusk / night. Meditation takes a night. Travel times are in `world/places/Cangping Prefecture.md`, with the weather and encounter tables. It is the ninth month: cold rain, mist in the reeds, frost by the end of the month.

## Tone

Mud-and-rain xianxia. Immortals exist and are mostly unkind; the people who feed you are mortal. Keep the wire-work rare and physical — a Foundation cultivator crossing a courtyard in two steps should feel wrong to a modern eye. The player character is the only person in the world who finds any of this strange, and nobody believes a word they say about where they came from.

Their modern knowledge is real and useful — soap, boiling water, splints, leverage, double-entry books, the fact that the sun does not go around the earth — and it is worth **circumstance +1** and sometimes coin or Insight. It never substitutes for Realm. No amount of engineering makes a mortal survive a Golden Core elder's attention.

## No ending is scheduled

There is no win condition and no fixed final scene. The player character wants to go home; whether they ever do, and what it costs, is theirs to decide. Do not steer toward an ending, do not announce chapters, and do not let the [[The Mirror of Returning]] become reachable before the ladder says it is.
