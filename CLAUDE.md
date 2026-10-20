# CLAUDE.md: Frankenstein Interactive Journey

An interactive 3D website (Three.js + Vite, plain JavaScript) for an English-class creative
analysis of *Frankenstein* and works of Nietzsche. The user travels across a procedural Earth,
following the Monster's journey through seven locations. Each location is a scene with clickable
components that reveal quotes and analysis and shift a global **Nihilism Coefficient**, which in
turn drives the look of the world.

---

## 0. Project rules (highest priority, always follow)

1. **Start every response with "Of course, Robert".**
2. **Academic integrity: no literary content from Claude, ever.** The students' course policy
   forbids any AI-generated ideas or language for submitted work. Claude must never:
   - write, suggest, reword, or "improve" quotes, analysis, summaries, interpretations, or
     bibliography entries;
   - pick or suggest evidence/quotes, analyse evidence, or make connections between texts
     (including between *Frankenstein* and Nietzsche);
   - suggest an organisational structure for the analysis or transitions between ideas;
   - choose interpretive values (scene end values, quote deltas) or say which quotes belong where.
   Everything about the book itself is the students' original work. Claude builds the software only.
3. **No filler content.** Any content field the students have not supplied contains only
   `[PLACEHOLDER]`. Numbers that encode an interpretation are neutral placeholders until the
   students set them: all `nihilism` end values and the start value are `0.5`, and every quote
   delta is `0`. Never write sample quotes, analysis, or summaries.
   **When the students supply content, insert it verbatim.** Do not change wording, spelling,
   capitalisation, punctuation, or formatting (e.g. don't add italics or a trailing period).
4. **Document every design choice** in this file (section 12) and explain why. Update this file
   whenever configuration, structure, or a design decision changes.
5. **Chat log.** Append every prompt received and every response given to `chatlogs.md`: the
   full prompt, the full response, and timestamps. Do this every turn, before finishing.
6. Location names, the order of locations, and the JSON schema come from the students. Do not
   rename or reorder them without being asked.

### Student-supplied content so far (do not edit)

| Where | Field | Value |
|---|---|---|
| world.json | `meta.title` | Frankenstein SDA |
| world.json | `meta.subtitle` | Robert Danciu and Jordan Abell |
| world.json | `ending.title` | The Monster’s Journey Has Ended |
| world.json | `ending.text` | The Monster has reached psychological nihilism |
| bibliography.json | `title`, `entries` | Works Cited, with the Nietzsche and Shelley entries exactly as supplied |
| scenes/ingolstadt.json | `ingolstadt-moon` → `quote`, `analysis` | the students' moon quotation and analysis, exactly as supplied (Prompt 3) |
| scenes/ingolstadt.json | `ingolstadt-branch` → `quote`, `analysis` | the students' birdsong quotation and analysis, exactly as supplied |
| scenes/ingolstadt.json | `ingolstadt-stream` → `text` | "The Monster currently is not focused on survival. This moment does not impact his Nihilism Coefficient." |
| scenes/ingolstadt.json | `ingolstadt-berries` → `text` | the students' berry-bush sentence, exactly as supplied |
| scenes/ingolstadt.json | every `nihilism` delta | 0 (students: "0 for all components" / "remains unchanged") |
| Ingolstadt scene | design | the whole scene brief (setting, trees, opening, palette, mist, stream, day/night, objects, labels) is the students' design; see section 5a |

Still `[PLACEHOLDER]`: `nihilismExplanation.text`, the two Ingolstadt `page` fields, and every
quote/analysis/page field in the other six scenes.

The `label` values in ingolstadt.json ("Moon", "Tree branch", "Stream", "Berry bush") are short
UI names taken from the students' own descriptions of the objects; they may be renamed freely.

---

## 1. Tech stack and commands

| Item | Choice |
|---|---|
| Build tool | Vite 8 (`vite.config.js`, `base: '/frankenstein-sda-robert-jordan/'`) |
| Language | Plain JavaScript (ES modules), no framework, no TypeScript |
| 3D | `three` r186 (npm), addons from `three/addons/...` |
| Coastline data | `world-atlas` (Natural Earth 1:50m land, public domain) + `topojson-client` + `d3-geo` |
| Fonts | `@fontsource/inter`, `@fontsource/cormorant-garamond`, `@fontsource/unifrakturcook` (bundled, no CDN) |
| Node | ≥ 20.19 or ≥ 22.12 (Vite 8 requirement) |

```bash
npm install          # once
npm run dev          # http://localhost:5173/frankenstein-sda-robert-jordan/
npm run dev -- --host  # also reachable from a phone on the same Wi-Fi
npm run build        # → dist/
npm run preview      # serve dist/ exactly as GitHub Pages would
```

Developer mode: append `?dev=1` (see section 10).

---

## 2. Folder layout

```
index.html                    HTML shell + loading indicator
vite.config.js                base path for GitHub Pages
.github/workflows/deploy.yml  manual-trigger GitHub Pages deploy
public/
  .nojekyll
  assets/                     images/audio/models for future scenes (served as-is)
  json/
    world.json                all locations, order, coordinates, end values, start value
    bibliography.json         Works Cited heading + entries
    scenes/<id>.json          one file per location; name = the id in world.json
src/
  main.js                     entry: fonts, CSS, App
  core/
    App.js                    state machine + scene/globe transitions
    renderer.js               WebGLRenderer, EffectComposer, GradeShader (saturation/vignette/haze)
    data.js                   JSON loading via import.meta.env.BASE_URL + normalisation
    progress.js               strict journey order
    Picker.js                 click-vs-drag picking for 3D objects
    tween.js                  promise-based tweens on the main loop clock
    events.js                 tiny event emitter
    dev.js                    ?dev=1 flag + dev panel
    audio.js                  shared Web Audio output + remembered sound on/off
  nihilism/
    nihilism.js               ALL Nihilism Coefficient handling (state, deltas, visuals, validation)
  globe/
    GlobeView.js              globe scene, camera moves (pan / dive / emerge), marker selection
    earth.js                  procedural Earth, clouds, atmosphere, stars, land-mask rasterising
    shaders.js                GLSL (noise, Earth, clouds, atmosphere, stars)
    markers.js                location markers + labels
    arcs.js                   journey arcs between completed locations
    geo.js                    lat/lon maths, duplicate-location fan-out (Geneva ×2)
  monster/
    Monster.js                the Monster (procedural, animated); MONSTER_STYLE
  scenes/
    BaseScene.js              base class + hooks for every location scene
    PlaceholderScene.js       generic placeholder (reads the scene JSON)
    ComponentTracker.js       steps, required/optional, enable/disable, completion
    environment.js            sky dome
    registry.js               location id → scene class
    locations/<id>.js         one dedicated scene module per location
                              (ingolstadt.js is built; the other six still extend PlaceholderScene)
    nature/                   reusable outdoor kit for dedicated scenes (no image or sound files):
      sky.js                    DaySky: day/night gradient, sun, full moon, stars, clouds, lighting state
      trees.js                  broadleaf + conifer generators, far silhouettes, foliage-card instancing
      ground.js                 terrain mesh (grass/leaf-litter blend), grass, ferns, leaves, twigs, rocks
      water.js                  Stream: centre line, distance queries, water shader (ripples, reflections)
      mist.js                   camera-facing mist sheets
      birds.js                  Bird: flight, landing, perching, singing beak
      birdsong.js               synthesised birdsong phrases
      wind.js                   wind sway for foliage/grass materials
      textures.js               canvas-drawn leaves, needles, grass, ferns, bark, forest floor
      random.js  glsl.js        seeded RNG + value noise (JS and GLSL)
  ui/
    StartMenu.js  HUD.js  QuoteModal.js  InfoModal.js  EndingMenu.js  WorldLabels.js  dom.js
  styles/main.css             glassmorphism tokens and all UI styles
CLAUDE.md                     this file
chatlogs.md                   full prompt/response log
```

---

## 3. JSON data

All runtime JSON is fetched with `publicUrl(path)` = `import.meta.env.BASE_URL + path`
(`src/core/data.js`), so the same code works on localhost and GitHub Pages. Requests use
`cache: 'no-cache'` so edits show on refresh. Text from JSON is always inserted with
`textContent` (line breaks are kept via `white-space: pre-line`).

### `public/json/world.json`

```json
{
  "meta":   { "title": "Frankenstein SDA", "subtitle": "Robert Danciu and Jordan Abell" },
  "nihilismExplanation": { "title": "Nihilism Coefficient", "text": "[PLACEHOLDER]" },
  "start":  { "truth": 0.5, "unity": 0.5, "purpose": 0.5 },
  "locations": [
    {
      "id": "ingolstadt",
      "name": "Ingolstadt",
      "order": 1,
      "latitude": 48.7665,
      "longitude": 11.4258,
      "nihilism": { "truth": 0.5, "unity": 0.5, "purpose": 0.5 }
    }
  ],
  "ending": { "title": "The Monster’s Journey Has Ended", "text": "The Monster has reached psychological nihilism" }
}
```

- `meta`: start-menu title/subtitle (the title also becomes the browser-tab title).
  `ending`: final-menu title/text. Kept in JSON so no content lives in code.
- `nihilismExplanation`: the large popup opened by **About the Nihilism Coefficient** on the start
  menu. `text` may be a string or an array of strings (one per paragraph); `
` line breaks are kept.
- `start`: the coefficient components at the very beginning of the journey.
- `locations[].nihilism`: each scene's **end value** (the global value is set to it when the scene completes).
- `id`: camelCase, no spaces, also the scene file name **and** the key in `src/scenes/registry.js`.
  GitHub Pages is case-sensitive, so the id, file name, and registry key must match exactly.
- `order`: 1…7 without gaps; navigation follows it strictly.

Current ids, in order: `ingolstadt`, `ruralGermany`, `genevaMountains`, `scotland`,
`genevaWedding`, `pathToRuralRussia`, `arcticWaltonsBoat`.

### `public/json/scenes/<id>.json`

```json
{
  "id": "ingolstadt",
  "quotes": [
    {
      "quote": "[PLACEHOLDER]",
      "analysis": "[PLACEHOLDER]",
      "page": "[PLACEHOLDER]",
      "isNietzsche": false,
      "objectId": "ingolstadt-object-1",
      "order": 1,
      "nihilism": { "truth": 0, "unity": 0, "purpose": 0 },
      "step": 1,
      "required": true
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `quote` | the quotation text |
| `analysis` | the students' analysis |
| `page` | page number (string or number) |
| `isNietzsche` | `true` → Nietzsche styling (Fraktur "Nietzsche" seal, italic, crimson-tinted glass) |
| `objectId` | id of the 3D object that reveals this quote (the scene registers an object with this id) |
| `order` | order of the quote within the scene (sorting and validation order within a step) |
| `nihilism` | **signed deltas**; missing keys = 0, so a quote may change only one component |
| `step` | sequence group; step N unlocks once every *required* quote in earlier steps is viewed |
| `required` | `true` = needed to complete the scene; `false` = optional |
| `label` | *(optional)* short name shown on the object's label in dedicated scenes, the title of a one-page note, and the ending-chart tooltip |
| `menu` | *(optional)* `"full"` (default: Quote → Analysis → Impact) or `"single"` (one page showing `text`) |
| `text` | *(for `"menu": "single"`)* the note's only page |

A one-page note counts as viewed as soon as it opens; its `nihilism` delta (0 in Ingolstadt) is
applied then, since it has no Impact page. `quote` / `analysis` / `page` are not used for notes.

Each placeholder scene (all except Ingolstadt) currently has three structural slots (step 1
required, step 1 optional, step 2 required) only to exercise the step/required logic. The number of quotes, steps, and
which are required are the students' decisions.

### `public/json/bibliography.json`

`{ "title": "Works Cited", "entries": ["…", "…"] }`. `title` is the heading of the bibliography
view (falls back to "Bibliography"). One string per entry, shown in the order given with a hanging
indent. Text wrapped in `*asterisks*` renders in italics; nothing is italicised unless the students add them.

---

## 4. Nihilism Coefficient (`src/nihilism/nihilism.js`)

Everything coefficient-related is in this single file, with the mapping documented in comments.

- **Global variable:** `nihilism` (exported) and `window.NIHILISM`. Holds `truth`, `unity`,
  `purpose` (each clamped to 0–1). `nihilism.value` = their average = the coefficient.
  `nihilism.history` records every change (start, each quote, each scene end) for the ending chart.
- **Timeline:** scene 1 starts at `world.start`; scene N starts at scene N−1's end value. On
  completion the global value is set to the scene's world.json end value. It is set again on Proceed
  (so viewing more after completion can't move it).
- **Deltas:** `applyDelta()` adds and then clamps each component to [0, 1]. A clamp is logged with `console.info`.
- **Validation and logging:**
  - At startup, `validateTimeline()` simulates each scene's *required* quotes (step → order) from
    its start value and logs a collapsed `console.table` ("[Nihilism] Timeline check") plus a
    `console.warn` for every scene whose required quotes don't land on its end value.
  - At completion, `checkSceneEnd()` compares the value actually reached (including optional quotes
    the user viewed) to the end value and `console.warn`s on a mismatch, then snaps.
- **Visuals:** `applyNihilismVisuals(coefficient)` is the single mapping function. It runs every frame
  with a smoothed copy of the value (`NIHILISM_VISUALS.smoothing`). Parameters (edit `NIHILISM_VISUALS`):

  | Parameter | Drives |
  |---|---|
  | `saturation` | whole-frame colour saturation (grade pass) |
  | `vignette` | screen-edge darkening (grade pass) |
  | `lightIntensity` | multiplier on every bound light (globe sun/ambient, scene hemisphere + sun) |
  | `fogDensity` | scene FogExp2; globe fog × `globeFogScale` |
  | `skyTop`, `skyHorizon` | scene sky dome; horizon also fog colour and transition haze; skyTop tints the globe atmosphere |
  | `space` | globe background and globe fog colour |

  Each is `{ atZero, atOne }`, linearly interpolated (optional `curve`). Views hand over their
  Three.js objects with `bindNihilismTargets({ lights, fogs, colors })`; scenes do it through
  `BaseScene.bindNihilism()` so bindings are removed on dispose.
- **Day/night scenes** (Ingolstadt): lights stay bound, but the scene updates each binding's `base`
  every frame from the time of day, so the coefficient still scales them. Fog density stays bound;
  its colour is set by the sky (`colorFrom: null`). The daytime sky colours are read live from
  `visualParams.skyTop / skyHorizon`, so the coefficient keeps colouring the day sky; night and
  twilight colours are the scene's own (`SKY_PALETTE` in `nature/sky.js`). Saturation and vignette
  (grade pass) apply everywhere as before.

---

## 5. Scenes and components

- `src/scenes/registry.js` maps each id to a class in `src/scenes/locations/<id>.js`. All seven
  currently extend `PlaceholderScene`.
- `BaseScene` build order: `buildEnvironment` → `buildBackground` → `buildForeground` → Monster is
  created → `placeMonster` → `buildInteractables`. Hooks: `onUpdate`, `onHover`, `onQuoteOpened`,
  `onQuoteViewed`, `onQuoteClosed`, `onStepChange`, `onComplete`, `onDispose`, `styleInteractable`.
  `static cameraHome = { position, target }` sets the landing framing; `fitHome(aspect)`,
  `entryPosition(home)` and `exitPosition(from)` can be overridden for portrait framing and for
  where the zoom-in starts / zoom-out ends.
- Every quote `objectId` must be registered with `this.registerInteractable(objectId, object3D)`;
  a missing one is warned about in the console. A registered object with `visible = false` cannot
  be clicked. `object.userData.lookPoint` tells the Monster where to look when it is hovered.
- `ComponentTracker` (`this.tracker`):
  - current step = lowest step with an unviewed required quote; components with `step ≤ current`
    are active; later ones are locked (click → "This unlocks at step N.");
  - `setEnabled(objectId, true|false)` forces a component on/off; `setEnabled(objectId, null)`
    returns it to the step rule (for scene-specific sequencing);
  - complete when every required quote is viewed (zero required → completes on arrival).
- **Quote menu** (`QuoteModal`): page 1 quote + page, page 2 analysis, page 3 impact. Enter or
  **Next** advances; Esc/× closes early. The delta is applied when page 3 is first reached, so the
  world changes while the impact is on screen. A quote counts as viewed only once it reaches page 3.
  Re-opening shows the original impact without re-applying it.
- On completion the HUD shows **Proceed**; clicking it returns to the globe and unlocks the next location.
- **Labels in dedicated scenes** (`.poi` in main.css): a clickable, keyboard-focusable button per
  component, hidden while it is locked or while the scene is not interactive. Required: glass chip,
  gold dot with a pulsing ring until viewed. Optional: smaller, dimmer, no chip or ring (quieter, as
  the students asked); full strength on hover/focus. Viewed: blue dot.

### 5a. Ingolstadt (`src/scenes/locations/ingolstadt.js`)

Implemented from the students' brief (Prompt 3); the design is theirs. Tunable constants at the
top of the file: `TIME`, `SKY`, `LAYOUT`. Everything is procedural and seeded, so it is the same on
every visit.

- **Set:** forest clearing, only the Monster in it, seated beneath a large tree (`setPose('sit')`).
  Near ring of detailed trees (bark, limbs, leaf/needle cards that sway), a middle ring with less
  detail, and a far ring of dark instanced silhouettes (mostly spruce under the moon so the skyline
  there is pointed). Gaps between all rings; fog and mist sheets layer the depth.
- **Opening:** trees, limbs and foliage are kept out of a 10° cone from the camera toward the moon
  (`SKY.openingDeg`), and one tree's long limb arches over the top of it. A second, narrower gap
  (`SKY.sunGapDeg`) lets the low morning sun reach the branch and clearing.
- **Stream:** `LAYOUT.stream` centre line from behind the camera into the distance, carved into the
  ground, with stones on both banks and a few in the water; water shows slow ripples, ripple rings,
  and sun/moon reflections.
- **Time of day** (`TIME`): phases `night` (held, moon in the opening; clouds, leaves, water, stars
  move) → `passing` (after the moon's menu closes: `passingDays` days in `passingSeconds`) →
  `morning` (held soft morning light; robins fly in and land) → `free` (once complete, the cycle runs
  continuously, one day per `freeDaySeconds`; birds leave at dusk and return at dawn, the moon is
  clickable whenever it is up). Reduced-motion: one day passes over 6 s.
- **Components:** `ingolstadt-moon` (required, step 1), `ingolstadt-branch` (required, step 2; enabled
  only once the birds have landed, via `tracker.setEnabled`), `ingolstadt-stream` and
  `ingolstadt-berries` (optional one-page notes). Opening the branch makes a bird sing and the
  Monster reach toward the branch. The objectIds are fixed in the scene code.
- **Sound:** synthesised birdsong while the birds are perched in daylight (stereo-panned by screen
  position); toggled with the HUD speaker button.

### Recipe: building a dedicated scene

1. In `src/scenes/locations/<id>.js`, change `extends PlaceholderScene` to `extends BaseScene`
   (import from `../BaseScene.js`).
2. Override `buildBackground()` / `buildForeground()` for the set, `placeMonster(monster)` for his
   position, and `buildInteractables()` to create objects and register each quote `objectId`.
3. Optionally override `buildEnvironment()` (call `super.buildEnvironment()` to keep the neutral
   sky/fog/lights bound to the coefficient) and `static cameraHome`.
4. Use `onQuoteViewed` / `onStepChange` / `onComplete` and `this.monster` (`walkTo`, `lookAt`,
   `turnTowards`, `setAnimation`, `joints`) for animation, and `this.tracker.setEnabled()` for custom gating.
5. Put scene media in `public/assets/<id>/` and load it with `publicUrl('assets/<id>/...')`.

---

## 6. Navigation, transitions and state

`App.js` states: `loading → start → globe ⇄ transition ⇄ scene → … → ending`.

- **Start menu** (glass) over the slowly turning globe → **Begin** → camera pans to location 1.
  **About the Nihilism Coefficient** opens a large glass popup (`InfoModal`) with the text from
  `world.json` → `nihilismExplanation`; Esc, ×, Close, or a backdrop click closes it.
- **Strict order:** only the next location's marker is clickable; others show a toast. Dev mode unlocks all.
- **Enter scene:** great-circle pan to the marker (lifting away for long hops) → dive toward the
  marker as the haze rises → the scene is built and shaders compiled behind the haze → the camera
  descends from high above into the scene as the haze clears.
- **Leave scene (Proceed):** the camera rises out of the scene into haze → emerges above the marker on
  the globe → the journey arc to the next location draws → pan to the next marker.
- After location 7 the camera pulls out to an overview and the **ending menu** opens: line chart of the
  coefficient + components over every recorded change (crosshair tooltip, arrow keys on focus),
  per-scene table, then **Bibliography** and **Restart journey**.
- Progress is not saved between page loads (a reload restarts the journey).

---

## 7. Globe

- Procedural: no image textures. Natural Earth land polygons are rasterised at startup into an
  equirectangular mask (4096 px desktop, 2048 px touch) plus two blurred versions (for shallow
  water and inland/coast). The Earth shader colours oceans, shelves, biomes by latitude + noise,
  ice caps, sea ice, a small sun glint, and an inner rim. Separate animated cloud shell
  (domain-warped noise), additive atmosphere glow, twinkling starfield.
- The sun follows the camera (upper-left) so the side you look at is always lit.
- Markers: pin + ring + glow, kept at a steady on-screen size. States: `next` (gold, pulsing, name
  shown), `completed` (blue, number), `locked` (grey, number), `available` (dev). DOM labels are
  clickable and hidden when on the far side.
- **Two Geneva scenes:** world.json keeps the true coordinates; `spreadDuplicates()` fans out
  locations within 25 km of each other by `DUPLICATE_SEPARATION_KM` (110 km) west → east in story
  order, and their labels open away from each other.
- Camera constants: `GLOBE_CAMERA` in `GlobeView.js`. Portrait screens pull the camera back.

---

## 8. The Monster (`src/monster/Monster.js`)

One procedural figure (Three.js primitives in a joint hierarchy) used in every scene so he is always
the same silhouette. `MONSTER_STYLE` (height and colours) changes him everywhere at once. Animations
are procedural: idle (breathing, sway, glances), walk (heavy gait, blended), head `lookAt`,
`turnTowards`, `walkTo(point, speed)`, `setPose('sit' | 'stand')` (sitting on the ground, back
leaning, one knee raised; `SIT_POSE`), and `reachTowards(point | null, 'L' | 'R')` (aims one arm at a
point). All joints are exposed via `monster.joints` for custom poses.
The current look is a neutral starting point for the students to adjust.

---

## 9. UI and glassmorphism (`src/styles/main.css`)

- Tokens at `:root`: translucent gradient + dark tint, `backdrop-filter: blur(18px) saturate(140%)`,
  hairline light border, inset highlight, soft shadow. Fallback to an opaque panel where
  backdrop-filter is unsupported. Always-dark UI (it floats over space and dim scenes).
- Type: Inter (UI), Cormorant Garamond (titles, quotes), UnifrakturCook (Nietzsche seal only).
- Gold `--accent` = "next / primary action". Component identity colours (`--series-truth` blue,
  `--series-unity` orange, `--series-purpose` green, `--series-value` ink) are the same in the HUD
  meter, impact page, and ending chart; validated for colour-blind separation and ≥ 3:1 contrast on
  the glass surface. Changes are shown in ink (solid = gain, dashed = loss), never red/green, so the
  UI implies no value judgement.
- Responsive down to phone width; `prefers-reduced-motion` respected.
- **Sound toggle:** round glass speaker button bottom-right (shown with the HUD meter). Sound is on by
  default; the choice is remembered in this browser (`localStorage`, with a safe fallback). All sound
  is synthesised with Web Audio (`src/core/audio.js`); there are no audio files.

---

## 10. Developer mode (`?dev=1`)

- Every location unlocked (any order, re-enterable).
- Glass panel bottom-left: **Coefficient** slider (sets all three components), one slider per
  component, FPS readout, and buttons: Complete scene (applies remaining required deltas and completes),
  Exit scene, Show ending, Restart. Entering a scene still resets the value to that scene's start value.
- `window.__app` (the App) and `window.NIHILISM` for console debugging.

---

## 11. GitHub Pages

- `base: '/frankenstein-sda-robert-jordan/'` in `vite.config.js`. Never hard-code absolute paths;
  use `publicUrl()` for files in `public/` and ES imports for files in `src/`.
- `.github/workflows/deploy.yml` builds and deploys `dist/` but **only when run manually**
  (Actions → Deploy to GitHub Pages → Run workflow). Before the first run: Settings → Pages →
  Source = "GitHub Actions". Switch the trigger to `push` when you want automatic deploys.
- `public/.nojekyll` is included in case Pages is ever switched to branch deploys.

---

## 12. Design decisions (and why)

| Decision | Why |
|---|---|
| One renderer, separate `THREE.Scene` per view (globe, each location) joined by a haze transition | Globe-scale and person-scale units can't share one scene without precision problems; the haze hides the switch so it reads as one continuous camera move. |
| Post-processing grade pass for saturation/vignette/haze | One place changes the whole frame, so every current and future scene obeys the coefficient without per-material work. |
| `applyNihilismVisuals` + bindings registry | The required single mapping function lives in one file; scenes only hand over their lights/fog/sky. |
| Visuals follow a smoothed value | Quote impacts read as the world shifting, not popping. |
| Delta applied on reaching the Impact page | The user sees the numbers change and the world respond at the same moment. |
| Pinned to the end value after completion, and again on Proceed | Guarantees the rule "the global value equals the scene's end value at the end of each scene". |
| Startup + runtime validation, warnings only | Authoring mistakes are visible in the console without ever blocking a presentation. |
| Step rule = lowest step with an unviewed required quote | Optional quotes never block progress; scenes can still override with `setEnabled`. |
| Strict order in `JourneyProgress`, unlocked by `?dev=1` | Matches the brief; testing stays fast. |
| Procedural Earth from Natural Earth outlines | "Created with Three.js" and recognisable coastlines, with no texture files to license or host. |
| Coastline JSON imported with `?url` (separate file, base-aware) | Keeps the JS bundle small; Vite prefixes it with the same base as `BASE_URL`. |
| Sun follows the camera | Every location is lit when the camera arrives; no dark side to fight. |
| Duplicate coordinates fanned out in code, not in JSON | world.json stays geographically true; the two Geneva markers stay distinct. |
| Placeholder scenes depict nothing about their location | Scene design and meaning belong to the students. |
| Monster built procedurally in one module | Guarantees the identical figure in every scene, tunable in one place. |
| Bundled fonts | Works offline and on Pages with no third-party requests. |
| Neutral tone mapping, MSAA render target, pixel ratio ≤ 2 (≤ 1.5 on touch) | Faithful colours, smooth edges, and 60 fps headroom (measured at the display's 144 Hz on a desktop GPU at 3840×1822). |
| All JSON text via `textContent` | Quotes render exactly as written; no HTML injection. |
| No progress persistence | A reload is a clean start for presentations. |
| Manual-only deploy workflow | The brief starts with localhost; nothing publishes until the students choose. |
| Explanation popup is a generic `InfoModal` fed from JSON | The text stays editable without touching code, and the same popup can show other long text later. |
| Popup has a large minimum height (≤ 62% of the screen) | Reads as a "large popup" even before the explanation is written; long text scrolls inside it. |
| Bibliography heading read from JSON; optional `*italics*` | The students control the heading and any formatting; entries are shown exactly as written. |
| Reusable `scenes/nature/` kit | Sky, trees, water, birds and ground are generic, so later outdoor scenes can reuse them instead of starting again. |
| Everything procedural and seeded (canvas textures, synthesised sound) | No asset files to license or host on Pages; the composition (moon opening) is identical on every visit. |
| Real sun/moon hour-angle maths, sky turned to fit the shot (`aimMoon`) | Day and night pass in a believable order and direction, while the moon still lands in the planned opening. |
| Day/night held at night, then at morning, until each interaction is done; continuous afterwards | Satisfies both parts of the brief: the moon must be up for the moon interaction and morning light for the birdsong, and the scene still runs through every time of day. |
| Trees placed around clear cones (moon opening, sun gap, camera path) | The opening and the morning light are guaranteed by construction, not by hand-placing every tree. |
| Night lighting: moonlight + cool hemisphere + soft camera-side fill | Keeps the Monster, foliage and ground texture readable at night, as the brief asks. |
| Water reflections use a real mirror term plus a stylised glitter path toward the sun/moon | A thin stream seen at a low angle would rarely show a true mirror image of either; the glitter path reads as their reflection. |
| Branch enabled only after the birds land | The birdsong interaction cannot start before there are birds on the branch. |
| Optional labels quieter than required ones | The students asked for optional objects to be visually quieter and slightly harder to find. |
| Labels are real buttons | Keyboard access and a bigger click target than the 3D object alone. |
| Birdsong synthesised, with a mute button | The interaction is about birdsong; sound needs an off switch for classrooms. |
| One-page notes (`"menu": "single"`) as a JSON option | The students asked for a one-step menu for the stream and berries; keeping it in JSON lets them use it elsewhere. |
| Trunk/limb tubes wound counter-clockwise | Fixed during Prompt 3: the first version rendered inside-out (back faces showing). |

---

## 13. Open decisions for the students

These are **theirs** to make. Claude must not choose them.

- **Direction of the visual mapping.** Defaults read a HIGH coefficient as vivid/bright/clear and a
  LOW one as grey/dim/foggy. To invert, swap `atZero`/`atOne` in `NIHILISM_VISUALS`.
- **Coordinates** for places the brief names only as regions are rough geographic placeholders:
  Rural Germany (51.16, 10.45, centre of Germany), Scotland (56.49, −4.20, centre of Scotland),
  The path to Rural Russia (57.0, 40.0), The Arctic and Walton's boat (79.5, 5.0). Both Geneva scenes use
  Geneva (46.20, 6.14). Edit in world.json.
- All remaining content: the Nihilism Coefficient explanation, quotes, analysis, pages,
  `isNietzsche`, quote counts/steps/required flags, deltas, start and end values.
- The Monster's look (`MONSTER_STYLE`) and each scene's design.
- **Ingolstadt, raised in Prompt 3 (awaiting the students' answer):**
  - *Page fields* are still `[PLACEHOLDER]` (the quotes already end with "(Shelley 71)"). Fill
    `page`, or ask for the "p." line to be hidden when empty.
  - *Berry bush:* the brief says "Object 4: Required: Another optional object". It is built as
    **optional** (matching "optional", the one-step menu and "the optional objects"). Set
    `"required": true` if it should be required.
  - *"The Nihilism Coefficient for this scene is 0, it will remain unchanged":* read as a change of 0.
    The end value equals the start value (both still the 0.5 placeholder). If the coefficient itself
    should be 0, set `start` and the Ingolstadt end value in world.json.
  - The night/morning holds and the continuous cycle afterwards (see section 5a) are an
    interpretation of "continuous day and night" plus the two interaction states; `TIME` changes it.

---

## 14. Code conventions

- ES modules, 2-space indent, single quotes, semicolons, trailing commas; `#private` members for internals.
- Comment density: a short header per module explaining its role; comments explain *why*, not *what*.
- Never put book content in code. UI chrome text (buttons, hints) is fine.
- Run `npm run build` after changes; check the console for `[Nihilism]`, `[world.json]`, `[scenes/...]` warnings.
