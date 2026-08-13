# Foxhole Logistics — Requisition Manifest

The purpose of this app is to calculate the total input and output for any and all items in Foxhole, and to let you lay those production chains out visually on a facility board.

Two pages, sharing the same data layer:

- **`index.html`** — the Requisition Calculator. Search for an item, get its full production chain down to raw resources, with per-recipe queue control and live throughput rates.
- **`planner.html`** — the Facility Planner. Place facility cards on a pannable/zoomable board, pick which recipe(s) each is running, and wire their inputs/outputs together into a flowchart by hand (or send a chain over from the Calculator with one click).

## Project structure

```
index.html              Calculator page shell (structure only, no data or logic)
planner.html            Facility Planner page shell

css/style.css            Shared styling — masthead, panel/search tokens, the
                         Calculator's ticket + production-chain layout
css/planner.css          Facility Planner-specific styling — the board, node
                         cards, wires, recipe picker popup

js/loader.js              Fetches data/*.json and builds the alias/lookup
                         indices (MATERIAL_RECIPES, AIRCRAFT_COSTS, ...)
js/calc.js                Pure production-chain engine, shared by both pages:
                         buildProductionChain() / buildNode() recursively
                         build the full tree for a ticket down to raw
                         resources; effectiveCraftingTime()/queue helpers;
                         buildPlannerExport() converts a chain into the
                         planner-agnostic shape the Planner imports
js/render.js              HTML builders shared by both pages: ticket cards,
                         numbered production-chain steps, and the recipe
                         picker preview card (renderRecipeOptionCard) reused
                         by the Planner's own popup
js/app.js                 Calculator-only: search, autocomplete, qty
                         steppers, per-node recipe selection, per-recipe
                         queue steppers, and app bootstrapping
js/planner.js             Facility Planner-only: the board itself — facility
                         catalog/search, node placement, multi-recipe cards,
                         wire routing (drag to bend, box/power right-angle
                         auto-routing), box-select, copy/paste, supply/demand
                         flow balancing across merged wires, and its own
                         localStorage-backed layout persistence

data/manifest.json       list of which files in data/ to load
data/facilities/          buildings recipes are crafted at (name only so far;
                         build_costs is a placeholder until real costs are added)
data/resources/           raw-ish gathered resources (Salvage, Sulfur, Oil, ...)
data/materials/           crafted materials (base/large/parts tiers)
data/vehicles/            aircraft, trucks, tanks
data/weapons/, data/items/
data/shippable_structures/ crated field structures (emplaced weapons, traps, ...)
```

## Running it

Because the page loads the JSON files with `fetch()`, opening
`index.html` directly by double-clicking it will fail in most browsers
(local file fetches are blocked by CORS). Run a tiny local server from
this folder instead, e.g. one of:

```bash
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000` in your browser. On Windows, `server-start.bat` does this for you (auto-detects `python`/`python3` and opens a private browser window); `server-kill.bat` stops it.

## Making edits

- **Change numbers/add items/add aliases** — edit the JSON files in
  `data/` directly. No other file needs to change. This is the same
  data the calculator reads, in the same shape:
  - an object with `assembly_materials` → aircraft
  - an object with `inputs` + `outputs` → a single-recipe material
  - an object with `recipes` (a list) → a multi-recipe item, like Steel
  - an object with `build_costs` → a facility building (see below)
- **Add a whole new data file** — drop the `.json` file into `data/`
  and add its filename to `data/manifest.json`.
- **Change the look (Calculator)** — edit `css/style.css`.
- **Change the look (Planner)** — edit `css/planner.css` (falls back to
  `css/style.css`'s shared tokens/variables for anything it doesn't
  override).
- **Change the ticket layout** — edit `renderAircraftTicket()` /
  `renderMaterialTicket()` in `js/render.js`.
- **Change the production chain (middle, Calculator)** — edit
  `renderGatherRow()` / `renderCraftRow()` / `renderCombinedChain()` in
  `js/render.js` and `buildNode()` / `buildProductionChain()` /
  `buildChainSteps()` / `aggregateRawResources()` in `js/calc.js`.
- **Change the raw/liquid/power sidebar (left, Calculator)** — edit
  `renderRawPanel()` in `js/render.js`.
- **Change search behavior (Calculator)** — edit `js/app.js`.
- **Change the Planner board** — edit `js/planner.js`. Node cards are
  built in `buildNodeHtml()`; wire routing/rendering in `renderWires()`
  (see `bezierPath`/`orthogonalPath`/`smoothSegmentPath` for the three
  routing styles); supply/demand balancing across merged wires in
  `computeFlow()`.

## Notes

- `js/loader.js` doesn't care about filenames, only the shape of each
  entry, so you can reorganize the JSON files however you like as long
  as `manifest.json` lists them.
- **Facilities** (`data/facilities/facilities.json`, loaded into `FACILITIES`
  in `js/loader.js`) are the buildings a `facility` string on a recipe refers
  to — e.g. `"Metalworks Factory [Blast Furnace]"`. Every unique facility
  string already used anywhere in the data has an entry here, keyed on its
  own slug, with `build_costs: {}` as a placeholder until real build costs
  are added. Nothing else reads `FACILITIES` yet — it's pure scaffolding for
  now, so an empty `build_costs` doesn't affect any calculation. When a
  recipe's `facility` text is changed or a new one is introduced, add/update
  the matching entry here too so the two stay in sync. `WEAPONS`,
  `AMMO_TYPES`, and `VEHICLES` (also in `js/loader.js`) are the same kind of
  scaffolding — populated from the data, not read anywhere yet.
- Recipe choice is per-node, not global: each ticket's production chain
  is a tree (`buildProductionChain()` in `js/calc.js`), and any node
  whose item has more than one recipe (Steel, Salvage, Sulfur, ...) gets
  its own selector in the production chain panel. Picking a different recipe there
  only affects that exact occurrence in that chain — `entry.nodeOverrides`
  (in `js/app.js`) maps a node's path (e.g. `material:steel_eoil>Casing>Steel`)
  to the recipe key chosen for it. Every other occurrence of the same
  item, in this chain or another ticket's, keeps using the default
  (`RECIPE_BY_OUTPUT` in `js/loader.js`) unless it has its own override. A
  multi-recipe item's *default* recipe is normally whichever one
  `js/loader.js` happens to see first — set `"is_default": true` on a
  specific recipe entry in the JSON (see Steel in `data/materials/large.json`)
  to pin a specific one regardless of iteration order.
- **Queues** (Calculator) let a recipe run 1-5 parallel copies of itself —
  both its NEEDS and YIELDS rates scale together (`state.queueCounts` in
  `js/app.js`, keyed by recipe key), same as placing that many physical
  copies of the building. Facility Power never scales with queue count —
  it's one flat draw per building regardless. Power-generating recipes are
  capped at 1 (`maxQueuesForRecipe()` in `js/calc.js`).
- **The Planner and Calculator share nothing at runtime** — no shared JS
  state, no server. The Calculator's "SEND TO PLANNER" button hands off a
  chain via `localStorage` (`buildPlannerExport()` in `js/calc.js`,
  consumed by `tryImportFromCalculator()` in `js/planner.js`); the
  Planner's own board layout persists to `localStorage` independently
  (`saveState()`/`loadState()` in `js/planner.js`).
