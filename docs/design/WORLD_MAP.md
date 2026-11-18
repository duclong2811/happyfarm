# World map: five seas, archipelagos, and a world that opens as it fills

Status: design agreed with the owner on 2026-11-19 (decisions below).

- **W1 is built** (sea chart, slots, claiming, `GET /world/chart`, `POST /world/slot`). It is switched on
  in a Worker by `WORLD_MAP_ENABLED = "true"`, once migration 0045 is applied.
- When an archipelago fills, the next one in that region opens on its own. This was my proposal, and
  the owner has not yet confirmed it.
- W2 onward is not started. The constraints are the ones in `AGENTS.md`: the server is
authoritative, every mutation is validated, migrations are used for every schema change, and no
proprietary game's map, names or art is copied.

## The owner's vision (2026-11-19)

- The world has five regions: **East, West, South, North and Centre**. Each region is split into
  smaller areas: archipelagos and clusters of islands close together.
- The world map is drawn in the spirit of **old nautical charts**: compass roses, rhumb lines,
  parchment and sea lettering.
- The world **opens gradually**. At first only part of one of the four outer regions is open.
- An island exists on the map from the start, but it only becomes active when a player takes it.
  Until then it is seen from afar.
- Long term, **naval battles**: ships at sea, players fighting each other.

## Owner decisions (2026-11-19)

1. **Elements are mixed in every region.** A region is geography, not an element. Every sea has
   islands of all five elements.
2. **The player chooses a region, and the server places them** in the next free slot of an open
   archipelago there. Archipelagos fill up, and neighbours are real players.
3. **The player keeps choosing their island**: element, outline and reroll, as in today's picker. A
   slot is a *place*. An unclaimed slot shows a wild island, pre-rolled from the world seed, seen
   from afar. When a player claims the slot, their chosen island takes its place.
4. **One archipelago opens in each outer region at launch** (East, West, South, North). The Centre is
   the world's hub, not a place for player islands. More archipelagos open as these fill.

The proposal below is kept for its reasoning. Where it differs from these decisions (the element per
region, the pre-rolled island as the one you get), the decisions win.

## Proposal

### Regions follow the five elements

The five regions fit the game's five elements in their traditional directions:

| Region | Element | Character |
|---|---|---|
| East (Đông) | Mộc | forested islands, old groves |
| West (Tây) | Kim | rock islands, mountain ranges, mines |
| South (Nam) | Hỏa | volcanoes, meadows, pastures |
| North (Bắc) | Thủy | lagoons, wide shallows, reefs, fishing |
| Centre (Trung tâm) | Thổ | open fields, and the hub of the world |

A player who chooses a region chooses its element. This gives each sea its own look from afar, and
it is the backbone for later regional trade and rivalry. **(owner: accept this mapping, or keep the
elements mixed in every region?)**

The Centre is the natural home of a shared hub (port town, market, events, a safe harbour). It is
probably not a place where players own islands. **(owner)**

### Geography

- **World coordinates** in sea tiles, server-owned.
- **Regions** are sectors around the Centre.
- **Archipelagos (clusters)** are groups of 4-8 island **slots** inside a region. Each cluster has a
  name, which is written on the chart, and an `open` flag.
- **Slots** are fixed places for one island each, about 160 tiles apart. That keeps a 96x96 island
  plus its open sea, and leaves room for ships to pass between islands.
- The world is generated **deterministically from a world seed**, the same way islands are, and is
  stored once it is opened. Opening a new archipelago is a data change, not a code change.
- **Every slot is pre-rolled with an island** (the region's element, an outline and a seed), so an
  unclaimed island can be drawn from afar exactly as it will look when someone takes it.
  - **(owner)** May the player still change the outline, or reroll, when claiming a slot? Or is the
    slot's island what they get?

### Claiming an island (server-authoritative)

1. A new player opens the chart and sees the open archipelagos and their free slots.
2. They pick a region, or a cluster, or a slot. **(owner: free choice of slot, or choose a region and
   be placed in the next free slot, which keeps neighbours real and clusters lively?)**
3. The server claims the slot in one guarded write. A slot can be claimed by one farm only (a unique
   constraint), and the claim is idempotent per request. The farm and its island are created from
   the slot's template exactly as today (`farm_islands`).
4. The client never sends coordinates or a template it made up: it names a slot id.

Existing farms (staging has only a few, after the reset) are placed into a free slot of their
element's region by a one-off, idempotent migration step.

### Data (one migration, plus game data)

- `world_regions` and the archipelago layout: game data (versioned, validated) or derived from the
  world seed.
- `world_slots`:
  - `slot_id`, `cluster_id`, `region`, `x`, `z`;
  - the pre-rolled `element`, `outline` and `seed`;
  - `farm_id` (unique, nullable), `claimed_at`, `version`.
- Reads:
  - `GET /world/chart`: the open clusters, their slots, and claimed or free. Small and cacheable.
  - A slot's public template, so its island can be drawn from afar.
- Writes: the claim, folded into farm creation.

### The chart (2D)

- A parchment chart in the spirit of portolan and hand-drawn sea charts, drawn by our own code with no
  copied map:
  - a large compass rose with rhumb lines radiating across the sea;
  - region names in a period hand, and archipelago names along curved baselines;
  - the islands as small coastline silhouettes drawn from their templates (the picker preview does
    this already);
  - fog over the unopened seas, with "terra incognita" lettering;
  - a few sea doodles of our own design (waves, a sea serpent, a galleon).
- It is used at onboarding (choose your sea) and from the HUD (look at the world).

### The view from home (3D)

- The other islands of the player's archipelago stand on the horizon as low-detail silhouettes. The
  hidden neighbour-island code already has this level-of-detail pipeline.
- An unclaimed island looks wild; a claimed one flies its owner's flag. **(owner: show other players'
  names on the chart and their islands?)**

## Phases

| Phase | What ships | Server work |
|---|---|---|
| W1 | World data, slots and claiming: a new farm takes a slot in an open archipelago of its region | migration `world_slots`, game data, claim in farm creation, `GET /world/chart` |
| W2 | The nautical chart: onboarding choice and a world view from the HUD | none beyond W1 |
| W3 | Neighbours on the horizon: the archipelago's islands in 3D | read slot templates near the player |
| W4 | Visiting: sail to look at another player's island (read-only) | authorised read of another farm's public view |
| W5+ | Ships and the sea: build a ship, sail it, then naval combat | a Durable Object per sea area for realtime positions and combat; anti-cheat; damage and loot rules; economy design (owner decision) |

The first opening proposed for W1 is **one archipelago in each element's region**, so every element
can be chosen from day one, or, as the owner suggested, a **part of one outer region**. **(owner: which
region, or regions, open first?)**

Naval combat is the large one: realtime, server-authoritative movement and hits, matchmaking or open
seas, and what is at stake (loot, damage, repair costs). It needs its own design pass before any code
is written. W1-W4 build the world it will happen in.
