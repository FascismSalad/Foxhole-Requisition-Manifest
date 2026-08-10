# Foxhole Logistics — Requisition Manifest

The purpose of this app is to calculate the total input and output for any and all items in Foxhole.

## Project structure

```
index.html          the page shell (structure only, no data or logic)
css/style.css        all styling
js/loader.js          fetches data/*.json and builds the alias/lookup indices
js/calc.js            buildProductionChain() / buildNode() — recursively
                       builds the full production tree for a ticket, node
                       by node, down to raw resources
js/render.js           builds the HTML for an aircraft/material "ticket"
                       (right column) and for the numbered production
                       chain (middle)
js/app.js              search, autocomplete, qty steppers, per-node recipe
                       selection, and app bootstrapping
data/manifest.json     list of which files in data/ to load
data/facilities/        buildings recipes are crafted at (name only so far;
                        build_costs is a placeholder until real costs are added)
data/resources/         raw-ish gathered resources (Salvage, Sulfur, Oil, ...)
data/materials/         crafted materials (base/large/parts tiers)
data/vehicles/          aircraft, trucks, tanks
data/weapons/, data/items/
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

Then open `http://localhost:8000` in your browser.

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
- **Change the look** — edit `css/style.css`.
- **Change the ticket layout** — edit `renderAircraftTicket()` /
  `renderMaterialTicket()` in `js/render.js`.
- **Change the production chain (middle)** — edit `renderGatherRow()` /
  `renderCraftRow()` / `renderCombinedChain()` in `js/render.js` and
  `buildNode()` / `buildProductionChain()` / `buildChainSteps()` /
  `aggregateRawResources()` in `js/calc.js`.
- **Change the raw/liquid/power sidebar (left)** — edit `renderRawPanel()`
  in `js/render.js`.
- **Change search behavior** — edit `js/app.js`.

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
  the matching entry here too so the two stay in sync.
- Recipe choice is per-node, not global: each ticket's production chain
  is a tree (`buildProductionChain()` in `js/calc.js`), and any node
  whose item has more than one recipe (Steel, Salvage, Sulfur, ...) gets
  its own selector in the production chain panel. Picking a different recipe there
  only affects that exact occurrence in that chain — `entry.nodeOverrides`
  (in `js/app.js`) maps a node's path (e.g. `material:steel_eoil>Casing>Steel`)
  to the recipe key chosen for it. Every other occurrence of the same
  item, in this chain or another ticket's, keeps using the default
  (`RECIPE_BY_OUTPUT` in `js/loader.js`) unless it has its own override.
