# Liver progression viewer

A static page (`index.html` + `js/` + `css/` + `vendor/three/`) that shows the liver of the case on the three scan dates
(May 2025, June 2026, Sep 2026), lets you look inside the lesions, and ties the model to what the radiologists wrote.
No build step, no CDN, no external requests: three.js r160 (`three.module.js`, `OrbitControls`, `PLYLoader`) is vendored
from the case site (`case_site_2026-09-10/vendor/three/`, MIT licence in `vendor/three/LICENSE`).

## Running it

The page fetches `data/scene.json` and PLY meshes, so it must be served over HTTP (not `file://`):

```sh
cd liver3d/viewer && python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

On GitHub Pages copy the whole `viewer/` folder (with `data/`). `data_test/` is a synthetic development scene
(ellipsoid phantoms, not patient anatomy) and does not need to be deployed.

### Pointing it at a scene

| URL query | meaning |
|---|---|
| `?scene=path/to/scene.json` | scene file (default `data/scene.json`); mesh paths in it are relative to the scene file |
| `?claims=path/to/report_claims.json` | report claims file, relative to the page (default: `scene.reports` next to the scene, falling back to `report_claims.json`, then `report_claims_raw.json`) |
| `?prefetch=0` | do not preload the other dates in the background after the first date is shown |

Example: `index.html?scene=data_test/scene.json` (synthetic scene), `index.html?scene=data_test/scene.json&claims=data/report_claims.json`.

## How it works

* **Coordinates** — `js/frame.js` is the only place where patient coordinates meet three.js. Meshes are RAS mm of each date's own CT
  (x → patient right, y → anterior, z → superior). Each date's meshes sit in a group whose matrix is that date's 4×4 from
  `scene.registration.modes[mode].matrix[date]` (row-major, date RAS → Sep 2026 RAS). A root group maps RAS to three.js
  (X = patient left, Y = superior, Z = anterior), so the default anterior view is radiological (patient right on the viewer's left).
  Orientation letters on the canvas edges (R/L/A/P/S/I) are computed from the camera each frame. The "Inferior" preset and
  "Slice through" show axial cuts the way CT is read (anterior up, patient right on the left).
* **Dates** — three big buttons, keys 1/2/3, ▶ plays the dates in a loop. Switching keeps camera, layers and cuts. Meshes of a date are
  loaded on first use (with a progress box), kept in memory, and the other dates are prefetched in the background.
  Meshes are never decimated or resampled by the viewer.
* **Compare** (C) — the previous date's liver and lesions as a fresnel "x-ray" outline (≈12 % base opacity, brighter at silhouettes,
  drawn on top), placed with the current alignment. A mode may carry a direct earlier → later fit (`modes[m].pair_matrix["p__c"]`,
  row-major, earlier date RAS → later date RAS); the ghost is then drawn with `matrix[c] · pair_matrix`, otherwise with `matrix[p]`.
  The viewer also understands `pair_field["p__c"] = {json, bin}` (a displacement grid applied to the ghost vertices, trilinear), but no
  shipped mode uses it (the non-rigid warp was rejected, see `data/BUILD_NOTES.md`).
* **Growth map** (G) — replaces each lesion surface by `lesions[].growth[pair].mesh` (vertex colours baked by the data builder:
  signed distance of the later surface from the earlier one); the pair follows the current date (previous → current) and can be chosen
  in the drop-down; legend in mm with the builder's note.
* **Register earlier scan** (check box next to Compare, default on; hash `nr=1` when off) — off: the ghost keeps the plain spine-anchored
  (A1) relation to the current date, i.e. the raw breathing shift as before registration was added, and the Growth map uses the spine-frame
  set `growth_sets.skeleton`; the alignment line and legend then show the mismatch without registration. The "i" button next to it opens
  an explanation (click / tap pins it, hover shows it, Esc or an outside click closes). A short glossary ("What do these numbers mean?")
  sits under the alignment line and in the About tab.
* **Alignment** — the "Align" selector lists `scene.registration.modes`: Spine-anchored (A1), Liver (landmark fit, B1), Liver (mask fit,
  refined; default) and the lesion-anchored modes Lesion R1 / L1 / S8 (`modes[m].lesion`; selecting another lesion in a lesion mode
  re-anchors on it). The line under the top bar (and the Compare legend, also on phones) shows the residual of the Compare pair after
  alignment: liver Dice and lesion centroid offsets (`modes[m].quality["p__c"]`, from `tools/registration_refine.py`;
  all numbers in `data/registration_quality.json`). Every structure of a date follows the same transform. Growth maps follow the mode's
  `growth_set` (`lesions[].growth_sets[set]`; the base `lesions[].growth` is the B1 set). Sizes and volumes never depend on it.
* **Layers** — grouped (Organ, Lesions, Internal structure, Vessels, Couinaud segments, Uncertainty, then any other group in the scene),
  each with visibility, opacity and solo; group check boxes; rows of structures without a mesh for the current date are greyed with the
  scene's `not_visible[date]` reason. When lesions carry `parts[date][kind]` meshes, those per-lesion parts replace the union layer of the
  same kind (`cores`, `walls`, `nodules`, `calcifications`, `active`) for that date, so parts can be highlighted per lesion.
* **Transparency** — transparent meshes draw all back faces outer → inner, then all front faces inner → outer, with fixed render
  orders and `depthWrite=false` (no depth peeling, no popping); back faces are drawn darker so the inside of a shell reads as inside.
* **Cut** tab — three axis-aligned planes fixed in the Sep frame (sagittal, coronal, axial), each with a slider and Flip. Layers at or above
  0.4 opacity get a solid coloured cut face (stencil caps, drawn outer → inner so a core shows inside its wall inside its lesion);
  translucent layers stay see-through (optionally capped too). "Slice through" (Lesions tab, Cut tab, claim bar) puts an axial cut through
  the selected lesion, shows the internal-structure layers and looks up at the cut from below.
* **Lesions** tab — table of volumes per date with change %, a log-scale volume chart, and for the selected lesion its per-date numbers
  (volume, long axis, core/wall/active, SUVmax, mean HU, mesh check, match confidence), Fly to / Orbit / Slice / Solo, and every report
  quote mapped to it.
* **Hover / click** — GPU picking (1×1 id render that respects cuts and caps; translucent layers are only picked when nothing solid is
  under the cursor). Tooltip: name, date, volume, mesh-vs-mask Dice/p95, mask source. Click a lesion to select it, double-click to fly.
* **Camera** — presets A, P, Rt (right lateral), Lt (left lateral), S, I, Obl; Orbit spins around the selected lesion (O);
  Screenshot saves a PNG with a caption (date, alignment, source, the active claim's verbatim quote) and the orientation letters;
  Copy link; Reset (R). Esc closes a claim / deselects.

### Reports panel

`Reports` lists the claims (`report_claims.json`) about the current date (or all dates), grouped by reader in authority order
(`reader_rank`, 1 = highest) and then by lesion; reader chips filter, "only R1" filters to the selected lesion, "English" shows the gloss
(labelled "not the verbatim wording"). Quotes are rendered from `quote_orig` exactly; only `highlight` substrings are wrapped in `<mark>`
(when none match, numbers with units are marked). Links: `source.site_base + report_page / original_page` (or `original_file` as "original document" when there is no original page), and `drive`, opening in a new tab. A `size_change` card shows the builder's `change_verdict` (model long-axis change `model_change_pct` vs the stated %), not the per-date size verdict.

Clicking a card selects the lesion (`lesion_id`, or `model.lesion` when the id is not a scene lesion), frames it, and visualises the claim:

* `size` — reported size as an orange dashed box/rectangle (a rectangle when the craniocaudal size is not given, a bar for one number) in
  `viz.axes_ras` at `viz.center_ras`, with dimension labels; the model's extents as a teal box; per-axis differences and the builder's verdict
  badge. Without `viz` (raw claims file) the reported size is drawn axis-aligned at the lesion centroid and labelled as such.
* `size_change` — the earlier-date box on the earlier lesion and the later one on the later lesion (the other date's box faint);
  **▶ Play change** switches dates while morphing the boxes and shows report vs model change (stated % and range; model long axis,
  volume, and the builder's `model_change_pct`). Dates outside the model (e.g. `mar2024`) are named and not animated.
* `activity` — the lesion's FDG-active layer is turned on and pulses; a yellow marker at the centre of the active-tissue mesh carries the
  reported and model SUVmax (the marker is not the SUVmax voxel).
* `location` / any claim with `segment` — the Couinaud segment layers named in it (parsed from "Sg2/3", "S8", "V-VIII", …) are shown and pulse.
* `vessel_relation` — the vessel layers named in it and all `contact_*` layers are shown and pulse, with a "contact patch" label.

Other structures are dimmed while a claim is shown (check box in the claim bar); layers a claim switched on are switched back when it closes,
unless you changed them meanwhile. `Disagreements` shows `contradictions[]` with their claims side by side (scroll sideways) and the model's verdict.

## URL hash grammar

The view is kept in the hash (`history.replaceState`, no history spam); paste a link to restore it. Only non-default values are written.

```
#d=<date key>
&r=<registration mode>            omitted = scene default
&v=+id,-id,...                    visibility differing from the scene default (lesions are les:<ID>)
&o=id:0.35,...                    opacity differing from the default
&solo=<id>
&sel=<lesion id>
&cmp=1                            compare ghost on
&g=<from>__<to>                   growth map on, with this pair
&clip=<x|y|z>:<pos mm>:<flip 0|1>,...   active cuts (Sep-frame RAS mm); flip 0 keeps the lower side
&caps=0  &capall=1
&cam=px,py,pz,tx,ty,tz            camera position and target in three.js world coordinates (mm)
&tab=layers|lesions|reports|cut|about
&claim=<claim id>                 claim shown on the model
&lang=en                          English glosses in the cards
&orbit=1
```

## Scene contract (as implemented)

`scene.json`: `dates[] {key,label,scan,ct}`, `registration {default, modes{<mode>{label,note,matrix{date:[16]},residual_mm{date}}}}`,
`layers[] {id,name,group,color,opacity,default_visible,per_date{date{mesh,volume_mL,verify{dice,p95_mm},source{flag|kind,reviewed},registered_from?}},not_visible{date:reason}}`,
`lesions[] {id,name,segment,color,per_date{date{mesh,volume_mL,long_axis_mm,centroid_ras,mean_hu,core_mL,wall_mL,active_mL,suv_max,verify,not_visible?}},parts{date{kind:path|{mesh,volume_mL}}},growth{a__b{mesh,note,max_mm,mean_mm,scale_mm}},match{date{confidence,method}}}`,
`reports`, `notes[]`, `generated`, `source` (anything other than `consensus` shows the warning banner). Missing `per_date` entries,
missing groups and missing files are tolerated (greyed rows, a toast for files that fail to load). `ct_slices` is ignored (not implemented).

## Files

* `index.html` — layout; `css/viewer.css` — theme tokens (dark default, light via `prefers-color-scheme` or the About tab), responsive rules
* `js/main.js` — scene model, rendering, layers, cuts and caps, picking, camera, URL state, panels
* `js/frame.js` — RAS ↔ three.js conversion, camera presets, orientation letters
* `js/meshload.js` — fetch with progress, PLY parse, cache
* `js/reports.js` — Reports tab, Disagreements, quotes per lesion
* `js/claimviz.js` — claim boxes, morph, markers, focus, claim bar
* `data/` — produced by `tools/build_viewer_data.py`; `data_test/` — synthetic development scene

Debug handle in the console: `window.__liver` (`app`, `state`, `pickAt`, …).

## Tested

Built-in browser (Chromium) at 1440×900 and 375×812; Playwright 1.60 headless WebKit, Firefox and Chromium at 1440×900 and 375×812
(load, date switching, compare, growth, slice-through caps, picking, claim boxes, Play change, screenshot download, presets and orientation
letters, hash restore in a fresh page, no horizontal page scroll): no console errors.

## Not done / limits

* `ct_slices` (CT slice cards) is not shown.
* No contour line drawn on the cut face (the cap colour marks the cut); caps assume closed meshes (open surfaces would cap wrongly).
* The SUVmax marker sits at the centre of the active-tissue mesh, not at the SUVmax voxel (the scene has no SUVmax location).
* The growth legend gradient is a generic blue-white-red; the exact colours are whatever the data builder baked into the meshes.
* Picking cost scales with total triangle count (one extra 1×1 render per hover, throttled).
* Real Safari (not Playwright WebKit) and real iOS devices were not tested.

## Integration test (2026-10-08, placeholder scene)

Built-in browser and Playwright 1.60 WebKit / Firefox / Chromium at 1440×900 and 375×812: every lesion mesh lands on its `centroid_ras` (0.000 mm after the registration matrix), dates, compare, growth, both alignments, slice-through caps and picking, lesion table and chart, size / size-change / activity / vessel claims, Play change, Disagreements, presets and orientation letters, screenshot download, and hash restore in a fresh page (now including `v=+layer`, which was dropped before) — no console errors.

## Consensus build and test (2026-10-09)

`data/` is now the consensus build (`scene.source = "consensus"`, no warning banner); see `data/BUILD_NOTES.md` for sources, the June P3
post-fix, face caps and the per-mesh Dice table. Scene additions used by the page:
* `layers[].per_date[d].confidence` / `lesions[].per_date[d].confidence` — confidence label from the consensus reports. Shown as a ⚠ line
  under the layer row, in the tooltip, as a "Confidence" row in the lesion table, and (first clause; full text on hover) in the canvas legend.
* `layers[].per_date[d].shown_as` (no `mesh`) — union part layer drawn only as per-lesion parts; still listed with its volume.
* Layers `active_pet_only` (FDG-active tissue outside the CT lesion masks, derived; "PET-defined only") and `active_inferred`
  (Uncertainty group; June P3, "inferred").
* Canvas legend: "Volumes · <date> (consensus masks)" — every lesion and layer volume of the shown date with its confidence label;
  collapsible (collapsed by default on phones and while a claim bar is open).

Switching dates: the three date buttons (or keys 1/2/3); ▶ plays May → June → Sep.

Test: `tools/tests/viewer_playwright.mjs <chromium|firefox|webkit> <outdir>` against `python3 -m http.server 8765` in `viewer/`
(Playwright 1.63 from the npx cache for Chromium; 1.60 from `atlas_backend_2/frontend/node_modules` via `PW_BASE=` for Firefox / WebKit,
whose installed browser builds match 1.60). 1440×900 and 375×812, 16 checks each: every date loads all visible meshes, old LHV wording absent,
layer toggles, segments, compare ghost, growth map, both alignments, axial cut, slice-through, P7 confidence row, Reports (size claim box,
LHV claim with the C01 relation), Disagreements, no horizontal scroll. Chromium, Firefox and WebKit: 32/32, no console errors or failed requests.
Screenshots in `test_shots/`. Fixed during the test: on phones the open claim bar (38vh) left no room for the Reports card list; the claim bar
is now 22vh and the sheet grows while a claim is open.
