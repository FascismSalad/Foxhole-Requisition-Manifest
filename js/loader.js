// ============================================================
// DATA LOADING
// Scans a folder of JSON files, sorts each top-level entry into
// AIRCRAFT_COSTS / MATERIAL_RECIPES / ITEM_MULTIPLE_RECIPES based
// on its shape, then builds alias/output indices for lookup.
//
// To add a new data file: drop the .json into /data and add
// its filename to /data/manifest.json. To edit existing items,
// just edit the JSON files directly — no other files need to
// change.
// ============================================================

const AIRCRAFT_COSTS = {};
const MATERIAL_RECIPES = {};
const ITEM_MULTIPLE_RECIPES = {};
const RECIPE_BY_OUTPUT = {};
const AIRCRAFT_ALIASES = {};
const MATERIAL_ALIASES = {};
// The buildings recipes name in their "facility" field (e.g. "Metalworks
// Factory [Blast Furnace]"). Currently just name + build_costs scaffolding —
// build_costs is deliberately empty until real numbers are added; nothing
// else reads FACILITIES yet, so an empty cost doesn't affect calculations.
const FACILITIES = {};
// Small arms (weapons) — class/ammo_type/crate_size recorded up front;
// no inputs/outputs/facility yet until a crafting recipe is added for one.
// Same "scaffolding now, wire it in later" idea as FACILITIES above.
const WEAPONS = {};
// Ammo calibers (7.62mm, Buckshot, ...) referenced by WEAPONS' ammo_type field.
// No cost data yet — just a name registry, same scaffolding idea as above.
const AMMO_TYPES = {};
// Land vehicles (motorcycles, trucks, tanks, ...). subcategory holds the
// vehicle class (e.g. "scout_vehicles"), type holds the vehicle type within
// that class (e.g. "motorcycle") — same "name/metadata now, recipe later"
// scaffolding as WEAPONS above. Aircraft stay on AIRCRAFT_COSTS/assembly_materials.
const VEHICLES = {};
// Output name -> multi-recipe item key (e.g. "Sulfur" -> "sulfur"). Lets the
// calc engine check for a user-chosen recipe preference for ANY item that
// appears mid-chain, not just the one directly selected in the search bar.
const PARENT_ITEM_BY_OUTPUT = {};
// Item full_name -> units per crate. Only items that actually specify
// crate_size (weapons, ammo, some vehicles/items) show up here — most raw
// resources and base materials were never tracked in crates in this
// dataset, so they simply have no entry and display as a plain unit count.
const CRATE_SIZE_BY_NAME = {};

async function loadData() {
  const manifest = await fetch('data/manifest.json').then(r => r.json());

  for (const filename of manifest) {
    let data;
    try {
      data = await fetch(`data/${filename}`).then(r => r.json());
    } catch (e) {
      console.error(`Error loading data/${filename}:`, e);
      continue;
    }

    for (const [key, val] of Object.entries(data)) {
      if (val && typeof val === 'object') {
        // Warden-exclusive items are entered into the data (so the dataset
        // itself stays complete) but never exposed to the live calculator —
        // skip them here, before they populate any lookup index, so
        // they're simply unreachable via search/results while still
        // sitting in the JSON files. Entries with no faction field at all
        // (everything added before this rule existed) are unaffected.
        if (val.faction === 'warden') continue;

        // crate_size/is_caliber are metadata flags, not mutually exclusive
        // with the recipe-shape branches below — most craftable items
        // (weapons, ammo, vehicles, and eventually plain materials) come
        // packaged in crates on top of however they're actually crafted,
        // so a record can be a weapon/ammo AND a multi-recipe item at once.
        if ('crate_size' in val && val.category === 'weapon') {
          WEAPONS[key] = { category: val.category, ...val };
        }
        if ('is_caliber' in val) {
          AMMO_TYPES[key] = { category: val.category || 'ammunition', ...val };
        }
        if (val.category === 'vehicle') {
          // Most vehicles have a "type" tier under their class (e.g.
          // tank/light_tank), but some (field weapons) sit one level
          // shallower — class alone is specific enough, so type is optional.
          VEHICLES[key] = { category: val.category, ...val };
        }
        if (typeof val.crate_size === 'number' && val.full_name) {
          CRATE_SIZE_BY_NAME[val.full_name] = val.crate_size;
        }

        if ('recipes' in val) {
          // Items with multiple recipes (like Steel)
          const category = val.category || 'material';
          const subcategory = val.subcategory || '';
          ITEM_MULTIPLE_RECIPES[key] = val;
          for (const r of val.recipes) {
            MATERIAL_RECIPES[r.recipe_key] = { category, subcategory, ...r, recipeKey: r.recipe_key };
          }
        } else if ('inputs' in val && 'outputs' in val) {
          // Single recipe items
          MATERIAL_RECIPES[key] = { category: val.category || 'material', subcategory: val.subcategory || '', ...val, recipeKey: key };
        } else if ('assembly_materials' in val) {
          // Aircraft
          AIRCRAFT_COSTS[key] = { category: val.category || 'vehicle', subcategory: val.subcategory || '', ...val };
        } else if ('build_costs' in val) {
          // Facility buildings (Materials Factory, Stationary Harvester, ...)
          FACILITIES[key] = { category: val.category || 'facility', ...val };
        }
      }
    }
  }

  buildIndices();
}

// Given any MATERIAL_RECIPES key, returns { itemKey, itemData } for the
// ITEM_MULTIPLE_RECIPES parent it belongs to, or null if it's a standalone
// single-recipe material. Used to generalize the recipe-toggle UI and
// ticket title beyond the old steel-only special case.
function findMultiRecipeParent(recipeKey) {
  for (const [itemKey, itemData] of Object.entries(ITEM_MULTIPLE_RECIPES)) {
    if (itemData.recipes.some(r => r.recipe_key === recipeKey)) {
      return { itemKey, itemData };
    }
  }
  return null;
}

function buildIndices() {
  // Output name -> default recipe.
  // Only the recipe's PRIMARY output (the first key) counts here — some
  // recipes also list byproducts (e.g. a Sulfur recipe that incidentally
  // yields some Coal), and those must never register as "the" way to get
  // that byproduct, or that byproduct's own real recipe(s) get shadowed.
  for (const [recipeKey, recipe] of Object.entries(MATERIAL_RECIPES)) {
    const primaryOutput = Object.keys(recipe.outputs)[0];
    if (!primaryOutput) continue;
    if (!(primaryOutput in RECIPE_BY_OUTPUT) || recipeKey === 'steel_eoil') {
      RECIPE_BY_OUTPUT[primaryOutput] = recipe;
    }
    // Fallback crate size for anything with an MPF-style crate_output +
    // unit_output pair but no explicit top-level crate_size of its own.
    if (!(primaryOutput in CRATE_SIZE_BY_NAME) && recipe.crate_output > 0 && typeof recipe.unit_output === 'number') {
      CRATE_SIZE_BY_NAME[primaryOutput] = recipe.unit_output / recipe.crate_output;
    }
  }

  // Aircraft aliases
  for (const [shortName, aircraft] of Object.entries(AIRCRAFT_COSTS)) {
    const keysToIndex = [shortName, aircraft.full_name || '', ...(aircraft.aliases || [])];
    for (const alias of keysToIndex) {
      if (!alias) continue;
      const clean = alias.toLowerCase().trim();
      if (!(clean in AIRCRAFT_ALIASES)) AIRCRAFT_ALIASES[clean] = [];
      if (!AIRCRAFT_ALIASES[clean].includes(shortName)) AIRCRAFT_ALIASES[clean].push(shortName);
    }
  }

  // Material & aircraft-part aliases
  for (const [recipeKey, recipe] of Object.entries(MATERIAL_RECIPES)) {
    const keysToIndex = [recipeKey, recipe.full_name || '', ...Object.keys(recipe.outputs), ...(recipe.aliases || [])];
    for (const alias of keysToIndex) {
      if (!alias) continue;
      MATERIAL_ALIASES[alias.toLowerCase().trim()] = recipeKey;
    }
  }

  for (const [itemKey, itemData] of Object.entries(ITEM_MULTIPLE_RECIPES)) {
    const keysToIndex = [itemKey, itemData.full_name || '', ...(itemData.aliases || [])];
    const firstRecipeKey = itemData.recipes[0].recipe_key;
    for (const alias of keysToIndex) {
      if (!alias) continue;
      MATERIAL_ALIASES[alias.toLowerCase().trim()] = firstRecipeKey;
    }
    // Same primary-output-only rule as RECIPE_BY_OUTPUT above — a recipe's
    // byproducts don't belong to this item, so they don't get listed here.
    for (const r of itemData.recipes) {
      const primaryOutput = Object.keys(r.outputs)[0];
      if (primaryOutput && !(primaryOutput in PARENT_ITEM_BY_OUTPUT)) PARENT_ITEM_BY_OUTPUT[primaryOutput] = itemKey;
    }
  }
}
