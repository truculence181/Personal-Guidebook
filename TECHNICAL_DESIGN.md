# Vagatio — Technical Design Document

**Version:** 1.3 (beta)
**Status:** Deployed, in personal use with a small trusted tester group
**Last updated:** August 2026
**Repository:** `Personal-Guidebook` (GitHub Pages)

> Renamed from *Afield* to *Vagatio* (Latin: wandering). **`localStorage` keys
> deliberately remain `afield-*`** — renaming them would silently wipe every
> existing tester's vault on next load.

---

## 1. Overview

Vagatio is a mobile-first web app for discovering places nearby and planning a
day around them. It queries live OpenStreetMap data at the user's location or
any searched location, shows what's open, and lets the user assemble an ordered
itinerary with meal slots and sights.

It is a **personal tool**, not a product. That framing drives most of the
architectural decisions below: there is no backend, no account system, no
analytics, and no commercial data dependency.

### Design constraints (self-imposed)

| Constraint | Rationale |
|---|---|
| Single HTML file, no build step | Edit and reload. No toolchain to maintain or break. |
| No backend, no server-side state | Nothing to host, secure, patch, or pay for. |
| No API keys | A key in a public static file is either exposed or requires a proxy — which would mean a backend. |
| Open-licensed data only | No commercial terms to violate, no billing account to monitor. |
| All personal data encrypted client-side | The deployment is public; the data must not be. |

Every significant limitation in §9 is a direct consequence of one of these.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────┐
│  index.html  (single file, ~2,700 lines)        │
│  ├── CSP + PWA meta                             │
│  ├── Pre-paint theme script (~15 lines)         │
│  ├── <style> design tokens + components (~815)  │
│  ├── Markup: lock screen, hero, filters, list   │
│  └── <script> application logic (~1,730)        │
└─────────────────────────────────────────────────┘
              │                    │
      ┌───────┴────────┐    ┌──────┴───────────┐
      │  Browser APIs  │    │  External APIs   │
      │  Geolocation   │    │  Overpass (POI)  │
      │  WebCrypto     │    │  Nominatim (geo) │
      │  WebAuthn      │    │  Wikipedia (img) │
      │  localStorage  │    └──────────────────┘
      └────────────────┘
```

**No framework.** At this size, a framework would add a build step and a
dependency tree to solve problems the app doesn't have. State is a handful of
module-scope variables; the view is one `render()` that rebuilds the list.

**Rendering model:** full re-render on state change. The list is capped at ~300
items and re-rendering is imperceptible at that scale. Two pieces of transient
DOM state survive re-render explicitly — the open card drawer (`openDrawerId`)
and scroll position.

### Deployment

GitHub Pages, public repo. HTTPS is **required**, not optional:

- `navigator.geolocation` is blocked on `file://` in Chrome
- `crypto.subtle` requires a secure context
- WebAuthn binds credentials to an origin; `file://` has none
- Service workers and manifest install require HTTPS

Local development uses `python3 -m http.server` (localhost counts as secure).

---

## 3. Data layer

### 3.1 Sources

| Source | Used for | Auth | Notes |
|---|---|---|---|
| Overpass API | POI data, hours, phone | None | 3 mirrors, progressive radius fallback |
| Nominatim | Forward geocoding | None | Rate-limited to 1 req/sec by policy |
| Wikipedia API | Cover photos (pass 1) | None | Batched, up to 50 titles/call |
| Wikidata API | Cover photos (pass 2) | None | P18 claim; catches places with no article |
| Panoramax | Cover photos (pass 3) | None | Street-level; outdoor/scenic/historic only, capped 20/page — see §3.3 |
| Open-Meteo | Weather | None | Multi-location batching, 16-day horizon |
| `SEED_PLACES` | Offline fallback | — | 20 curated Pearland, TX places |

Every source is keyless and CORS-enabled. This is the constraint that keeps the
app backend-free, and it's the reason ratings, price levels, and business
photos are absent — see §10.

**Photo enrichment runs through one `enrichPhotos()` helper**, not per-call.
Five separate call sites previously chained the Wikipedia pass individually;
consolidating them means a new entry point can't silently skip a source.

### 3.2 Category taxonomy

`CATEGORIES` is the single source of truth for twelve categories. Each entry
carries a key, a label, and a list of OSM tag selectors. It drives three
things simultaneously:

1. The dropdown options (built at runtime from the array)
2. The Overpass query clauses
3. `classifyTags()`, via a reverse-lookup map `TAG_TO_CAT`

Adding a category is a one-line edit. This was deliberate — an earlier version
had the chip list, the query, and the classifier maintained separately, and
they drifted (the query never fetched hotels while a "Stay" filter existed).

Categories: Restaurants, Coffee, Bars & Pubs, Nightlife, Parks & Trails,
Scenic, Museums & Art, Historic, Entertainment, Shopping, Wellness, Stay.

### 3.3 Overpass query construction

**This is the most performance-sensitive code in the app.** Overpass evaluates
each `around` clause as a separate spatial pass. The naive construction — one
clause per tag selector — produced 65 clauses, which the public servers dropped
outright in a dense city.

`buildOverpassQuery()` groups selector *values* by tag *key* into regex clauses:

```
node["amenity"~"^(restaurant|fast_food|cafe|bar|pub|...)$"]["name"](around:R,lat,lon);
```

Three optimizations, in order of impact:

1. **Regex grouping**: 65 clauses → 8 for "All", → 1 for a single category
2. **Category scoping**: only the selected category is fetched
3. **Server-side name filter**: `["name"]` discards unnamed nodes before
   transfer rather than after

**Progressive degradation:** `fetchLivePlaces()` attempts the requested radius,
then half, then 5 miles, trying all three mirrors at each step. On success it
tags the result array with `_radiusUsed`; if that's below the requested radius,
the UI says so explicitly. A smaller real result beats an error screen — but
silently returning less would be worse than either.

### 3.4 Opening hours

OSM stores hours as an `opening_hours` string with a grammar far richer than
this app needs. `parseOsmHours()` is a deliberate partial implementation
covering the common cases (`Mo-Fr 09:00-17:00`, `24/7`, comma-separated day
lists, split ranges). Anything it can't parse returns `null`, which surfaces as
"hours unknown" rather than a wrong answer.

Internal representation is minutes-from-midnight per weekday:

```js
{Mon:[540,1020], Tue:[540,1020], ..., Sun:null}
```

Ranges where `close < open` cross midnight and are handled explicitly — a bar
closing at 2am is `[960,120]`, and `openStatus()` checks `mins >= open || mins < close`.

`openStatus(hours, atMins, atDay)` takes an optional target time. Called with
no arguments it answers "open now"; the planner calls it with a slot time and
the planned weekday to answer "open *then*". This is what lets the day planner
warn that a Monday dinner pick is closed Mondays.

### 3.5 Additional OSM fields

Beyond core place data, four more tags are captured per the same "surface it
if it's there, say nothing if it isn't" convention as hours and phone:

| Field | Tag(s) | Notes |
|---|---|---|
| `menuUrl` | `website:menu` | De-facto OSM convention, restaurant-specific. Sparse coverage. |
| `website` | `website`, `contact:website`, `url` | Fallback when no menu tag exists |
| `wheelchair` | `wheelchair` | `yes` / `limited` / `no`, shown as distinct badge states |
| `cuisine`, `diet` | `cuisine`, `diet:vegetarian/vegan/halal/kosher` | Powers the Diet filter, food-ish categories only |

**`menuLinkFor(p)` never mislabels a fallback as the real thing.** A place
with `website:menu` gets a button labeled "Menu"; a place with only a general
`website` gets one labeled "Website" instead — and that fallback only shows
for Food, Coffee, and Bars, never for a museum or park whose website tag
would have nothing to do with a menu.

### 3.6 Panoramax photos (third enrichment pass)

Runs after Wikipedia and Wikidata, only for places still missing a photo.
Chosen over Mapillary specifically for the auth story: Mapillary requires a
registered client token; **Panoramax's search/read routes need no
authentication at all**, matching the no-key posture already established for
every other source in this app. Backed by IGN (France's national mapping
agency) + OpenStreetMap France, moving to an independent nonprofit
foundation — not corporate-owned infrastructure with an open license bolted
on top.

**Two deliberate limits:**

- **Category-restricted** to `outdoors`, `scenic`, `historic`. This is street
  photography, not venue photography — useful for a trailhead or a
  viewpoint, usually useless for a restaurant in a strip mall.
- **Volume-capped at 20 places per enrichment pass.** Unlike Wikipedia (50
  titles/call) or Open-Meteo (1000 points/call), Panoramax's STAC `/search`
  takes one bounding box per call — there's no multi-point batch endpoint.
  Uncapped, a 100-item page would mean 100 sequential requests.

**Field parsing is defensive**, and this is worth explaining rather than
just asserting: the response shape was never verified against a live call
from the build environment (no network access in that sandbox). One field
name is confirmed from Panoramax's own changelog (`geovisio:thumbnail`,
deliberately duplicated onto `properties` for simpler clients); everything
else checks multiple plausible asset locations before giving up and
returning no photo, the same lesson learned the hard way from an earlier
Open-Meteo field-naming mistake (§8).

---

## 4. Security model

### 4.1 Threat model

**In scope:** someone picks up the unlocked phone; someone finds the public
URL; someone reads browser storage from a compromised or shared device.

**Out of scope:** a compromised device with an active keylogger; a determined
attacker with the PIN; nation-state adversaries. This is a travel notes app.

### 4.2 Envelope encryption

A random 256-bit **Data Encryption Key (DEK)** encrypts the vault. The DEK is
then wrapped separately by each unlock method:

```
┌────────────────────────────────┐
│ afield-vault                   │  pins + plan + ratings,
│   AES-GCM(DEK, payload)        │  encrypted with the DEK
└────────────────────────────────┘
         ▲                ▲
         │                │
┌────────┴───────┐  ┌─────┴──────────┐
│ afield-wrap-pin│  │ afield-wrap-bio│
│ AES-GCM(       │  │ AES-GCM(       │
│  PBKDF2(PIN),  │  │  HKDF(PRF),    │
│  DEK)          │  │  DEK)          │
└────────────────┘  └────────────────┘
```

- **PIN path**: PBKDF2-SHA256, 150,000 iterations, random 16-byte salt →
  AES-GCM key → unwraps the DEK
- **Passkey path**: WebAuthn PRF extension output → HKDF-SHA256 → AES-GCM key
  → unwraps the DEK

The PIN is never stored. Only the salt and ciphertext persist. A wrong PIN
produces a key that fails AES-GCM's authentication tag — **that failure is the
unlock check**. There is no password hash to attack separately.

Envelope encryption (rather than encrypting the vault directly with the PIN
key) exists so that multiple unlock methods can coexist without re-encrypting
the data, and so that adding or removing Face ID doesn't touch the vault.

### 4.3 Face ID: two modes, honestly labelled

| Mode | Key origin | Protects against |
|---|---|---|
| **PRF** (preferred) | Derived from the authenticator | Storage extraction — nothing readable is stored |
| **Device** (fallback) | Random, stored in localStorage | Someone using the unlocked phone. **Not** storage extraction |

PRF requires iOS 18+ / Safari 18+ and iCloud Keychain passkeys. When it's
unavailable, the app offers the fallback **behind an explicit confirm dialog
that states the difference**. Silently downgrading would have been invisible to
the user and is the failure mode this design specifically avoids.

`bioMode()` reports which is active; the toggle tooltip surfaces it.

### 4.4 Session handling

- Re-locks on `visibilitychange` when backgrounded
- `markHandoff()` suppresses re-lock for 4 seconds when the user taps through
  to Apple Maps or the dialer — otherwise every directions lookup demanded a PIN
- DEK is held in a module-scope variable only; cleared on lock

### 4.5 Known weaknesses (accepted)

- **4-digit PINs are weak against offline brute force.** 150k PBKDF2
  iterations raise the cost but don't fix it. Mitigated by: the vault contains
  restaurant bookmarks, and an attacker needs device storage access first.
- **The fallback Face ID mode stores its key in the clear.** Documented above,
  user-consented, and clearly the weaker option.
- **The public URL is discoverable.** GitHub Pages cannot be made private on
  consumer plans. `robots.txt` discourages indexing; Cloudflare Access is the
  documented path to real auth. Accepted because an unauthorized visitor sees a
  blank app and a PIN prompt.

### 4.6 Content Security Policy

`default-src 'none'` with explicit allowances for the four required origins.
`script-src` requires `'unsafe-inline'` because the app is a single file — a
known tradeoff of the no-build-step constraint. Given no user-generated content
is ever rendered as HTML, the XSS surface is minimal.

---

## 5. Day planner

### 5.1 Data model

A trip is `planDays`, an ordered array of days; each day has a `date` and a
single ordered `stops` array, each entry a place object plus a `slot` tag of
`breakfast | lunch | dinner | sight`. Meals are unique per day; sights are
unlimited.

`dayPlan` remains a live *reference* to whichever day is active
(`planDays[activeDay]`) rather than a copy — chosen specifically so the
roughly 100 places in the codebase that already read `dayPlan.stops` /
`dayPlan.date` kept working untouched when multi-day support was added.
Only the handful of places that *reassign* the plan route through
`setDayPlan()` to keep the reference and the array in sync.

The earlier model kept meals in named fields and sights in a separate array.
That made "two sights, then lunch, then two more" unrepresentable. The single
ordered list per day is the whole reason ordering works, and migration from
every older shape happens in `unpackVault()` (§6).

### 5.2 Inferred times

Meals carry fixed times (9:00 / 13:00 / 19:00). A sight's time is inferred from
position — the midpoint between the surrounding meals, or ±2 hours from a
single neighbour. Consequence: **reordering updates the open/closed warnings
automatically** rather than leaving them stale.

### 5.3 Route optimization

`optimizePlan()` is nearest-neighbour, anchored:

1. Split the sequence into segments at each meal
2. Anchor the first segment at the user's location (or the first meal)
3. Within each segment, repeatedly take the nearest unvisited sight
4. Re-append the meal, which becomes the next anchor

Meals never move — their times are the point. Only sights are resequenced.

Validated on real Pearland coordinates: a scrambled 5-stop day went from
**27.9 mi to 12.5 mi**.

Nearest-neighbour is not optimal (this is TSP), but for 3–8 stops the gap is
small and the behaviour is predictable, which matters more than optimality for
a tool someone is using while standing on a sidewalk.

**Distances are straight-line (haversine), not driving distance.** Relative
ordering is rarely wrong; absolute totals read low. Real routing needs a
directions API, a key, and a backend.

### 5.4 Saved plans

A saved plan is a named snapshot of `stops`, deliberately **without** a date.
Loading one applies today's date, not the date it was saved — you're reusing a
sequence, not resurrecting a specific day. Stops are copied on both save and
load, so editing today's plan can't corrupt the saved original.

**Not re-validated on load.** A plan reused months later still points at the
places it was built from, whether or not they still exist or keep the same
hours. Accepted: re-resolving every stop against live data would turn a
one-tap reuse into a slow network operation, for a staleness problem that only
bites at long horizons.

### 5.5 Sharing

The plan is encoded into the URL **fragment** (`#shared=...`), base64url over a
key-shortened JSON payload. Fragments are never sent to the server, so there's
nothing to log and no length limit imposed by request headers. A 3-stop plan
produces roughly a 500-character URL.

Recipients see a **read-only landing screen before any lock screen** — no PIN,
no vault, nothing decrypted, because the data arrived through the link rather
than from anyone's encrypted storage. Importing into their own planner is a
separate, deliberate step that goes through the normal unlock flow.

**Snapshot, not sync.** Reordering after sharing doesn't update anyone's copy.
Live group sync needs a server, which is the one thing this app doesn't have.

### 5.6 Weather

Open-Meteo, batched — one request covers every stop in a plan regardless of
count. Each stop's forecast is indexed by `dayOffset * 24 + hour`, using the
same `stopTime()` the open/closed check already uses, so a 9am breakfast and a
7pm dinner on the same day get genuinely different conditions.

Fetches are keyed on a `planSignature()` (date + stop IDs/coords) rather than
firing on every `renderPlan()` — the plan re-renders for reasons unrelated to
weather, and refetching each time would be wasteful and visibly janky.

Outside the 16-day forecast horizon, stops report unavailable rather than
guessing — the same honesty pattern as "hours unknown."

**The header badge reads from `hourly`, not `current`.** The `current` block's
field naming couldn't be verified without live network access and turned out
not to parse; the hourly path was already proven working by the planner. It
selects the entry closest to `Date.now()` by **absolute timestamp**, not
hour-of-day, so a search in another timezone stays correct.

**This turned out to still be subtly wrong on the first attempt, and it's
worth recording why.** The absolute-timestamp fix above compared
`new Date(hourlyTimeString).getTime()` against `Date.now()` — but
Open-Meteo's hourly timestamps have no timezone suffix (`"2026-09-01T09:00"`,
no `Z`), and `Date()` parses a timezone-less string using **the runtime's own
timezone**, not the queried location's. Tested against Tokyo specifically
(rather than the browser's own location, which can't expose this bug since
browser-timezone and queried-location-timezone are the same thing) and it
failed. The real fix, applied to both the header and planner paths: parse
each timestamp's raw calendar components by hand and convert using that
specific location's own `utc_offset_seconds` field, which Open-Meteo includes
in every response for exactly this reason. Both paths share one
`closestHourlyIndex()` implementation now — no remaining inconsistency
between them.

### 5.7 Multi-day trips

`planDays` is a plain array; `addDay()` appends with a date defaulted to one
day after the last (trips are usually consecutive), `switchDay()` swaps
`dayPlan`'s reference, `removeDay()` deletes with confirmation. Day tabs
render across the top of the planner, horizontally scrollable.

**`removeDay()`'s confirmation is context-aware.** Deleting a day that's
already passed *and* has journal entries tied to it gets a more specific
warning than a generic day: it explains the day will disappear from Recap
(§5.10) but that the journal entries themselves are not deleted — they live
in `journalStore` independently, keyed by place, and remain visible through
Export Journal regardless of whether the day that prompted them still exists
in `planDays`. Getting this distinction right mattered enough to spell out
in the confirmation text itself, not just in this document.

### 5.8 Plan revalidation

Loading a saved plan (§5.4) triggers a background check against live data —
one Overpass query sized to the plan's own geographic spread (centroid +
radius covering every stop, capped 3–50 mi). The plan is usable immediately;
revalidation refines it a moment later, updating hours/coordinates and
naming anything no longer found on the map. A failed check reports itself
honestly rather than blocking — the network being down doesn't mean the
saved plan is wrong, just unverified.

### 5.9 Calendar export

Hand-rolled RFC 5545 `.ics`, no library — the format is simple enough that a
dependency would cost more than it saves, and this keeps the no-build-step
constraint intact. `stopTimeIn(day, index)` mirrors `stopTime()`'s own
inference logic against an explicit day rather than the currently-active one,
so exporting a trip doesn't depend on which day tab happens to be open.
Exports the whole trip when multiple days exist, a single day otherwise.
CRLF line endings throughout — some calendar apps genuinely reject bare LF.

### 5.10 Journal export and trip recap

**Export** (`buildJournalMarkdown()`) reads every entry across every pinned
place and sorts **chronologically across the whole journal**, not grouped by
place — deliberate, since a trip usually spans several places in a day, and
"what did I do that day" reads more like an actual diary than "what did I
write about this restaurant."

**Recap** (`renderRecap()`) is not a new stored data structure — it's a
filtered join over data that already exists. Any day in `planDays` whose
date has passed, with at least one stop, surfaces grouped with whatever
journal entries were written *for that specific date* (matched by
`entry.date === day.date`, not just by place — a place visited twice on
different trips shows each visit's own entry under its own day, not a
merged list). No entry for a stop still shows the stop itself, honestly
labeled as having no write-up rather than being silently omitted.

---

## 6. Storage schema

All under `localStorage`, all on-device.

| Key | Encrypted | Contents |
|---|---|---|
| `afield-vault` | Yes (DEK) | `{__v:7, pins, planDays, marks, journal, savedPlans, recent}` |
| `afield-wrap-pin` | — | `{salt, iv, data}` — DEK wrapped by PIN |
| `afield-wrap-bio` | — | `{credId, prfSalt, iv, data}` — DEK wrapped by PRF |
| `afield-wrap-dev` | — | `{credId, k, iv, data}` — fallback mode |
| `afield-salt` | — | Legacy pre-envelope installs only |
| `afield-theme` | No | `auto \| light \| dark` |
| `afield-skin` | No | One of nine skin keys |
| `afield-page-size` | No | `10 \| 20 \| 50 \| 100` |
| `afield-bio-dismissed` | No | Suppresses the enrolment banner |

Note the split: **anything personal is inside the encrypted vault; only display
preferences sit in plaintext.** A theme choice isn't worth a decrypt on every
page load, and leaking "this person prefers dark mode" costs nothing.

### Migration

`unpackVault()` handles five generations, each additive:

- **v1** (bare pins object) → `migrateToEnvelope()` generates a DEK, rewrites
  storage in envelope form
- **v2** (`{pins, plan}`, meal-keyed plan) → plan converted to ordered stops
- **v3** added `marks` (star ratings)
- **v4** added `journal`
- **v5** added `savedPlans`
- **v6** converted the single `plan` object into a `planDays` array (multi-day
  trips), rewrapping any older single-plan shape as day one of a one-day trip
- **v7** (current) added `recent` (recently viewed places)

Versions ≥2 all load through the same branch, defaulting absent fields — so
each addition was a one-line change rather than a new migration path.

**v6's migration found a real bug in v5's own migration code**, worth
recording since it's a better lesson than a clean changelog would suggest.
The old logic did `Object.assign(emptyPlan(), obj.plan)` before checking
whether the plan used the old meal-keyed shape — but `emptyPlan()` supplies
an empty `stops: []`, which made the "is this the old shape" check
(`!Array.isArray(stops)`) always false, silently discarding breakfast/
lunch/dinner/sights on upgrade. Caught by testing all four generations
against real fixtures, not by inspection — the code looked correct.

Any operation that regenerates the DEK clears both passkey wrappers, since they
would otherwise point at a dead key. `unlockWithBio()` also self-heals: if
decryption fails after a successful unwrap, the wrapper is stale and gets
removed with a message directing the user to their PIN.

---

## 7. UI architecture

### 7.1 Theme and skin — two independent axes

Design tokens as CSS custom properties on `:root`, overridden by attribute
selectors. **Two orthogonal dimensions**, not one combined list:

- `data-theme` — `light` / `dark`, with an `auto` mode following the OS live
- `data-skin` — one of nine: `classic`, `8bit`, `zen`, `nature`, `ocean`,
  `adventure`, `space`, `futuristic`, `rose`

Every skin has both a light and dark palette, so the matrix is 18 token sets.

**Why this stayed cheap:** all 54 `font-family` declarations were routed
through three variables (`--font-display`, `--font-body`, `--font-label`), and
every component already drew colors from tokens rather than hardcoded hex. A
skin is therefore a block of variable values plus a handful of structural
overrides — not a parallel render path. **There is no per-skin branching in
JavaScript.**

Each skin carries its own fonts, corner language, shadow treatment, and one
signature detail:

| Skin | Corners | Shadows | Signature |
|---|---|---|---|
| Classic | Soft (12–18px) | Soft blur | — |
| 8-bit | Rounded pixel (6px) | Hard offset | Pixel icons, grass strip |
| Zen | Very soft (22px), true circles | Nearly flat | Restraint itself |
| Nature | Asymmetric (28/14) | Soft | Leaf section markers |
| Ocean | Pill (26px) | Blue-tinted glow | Wave line on covers |
| Adventure | Sharp (2px), thick borders | Hard ink-stamp | Dashed trail line |
| Space | Clipped HUD corners | Colored glow | Star field on tiles |
| Futuristic | Tight (3px), accent borders | Cyan glow | Scanline wash, pixel icons |
| Rose | Generous curves (20px), circles | Soft blush | Petal gradient on covers |

**Every one of the 18 palettes was verified against WCAG AA** before shipping
— 4.5:1 for text, 3:1 for borders. Most failed on first draft, typically on
`--ink-faint` against its background and `--line` for borders. Rose's dark
palette specifically failed border contrast (2.66:1) on the first attempt and
was corrected before implementation, same as every skin before it. Corrected
before merge, not after.

A pre-paint inline script sets both attributes before first render to avoid a
flash. Attributes are set on **both** `html` and `body` — some embedded
viewers restyle the root element, which would otherwise swallow the override.

**Cover art renders both icon variants** (line and pixel), with CSS choosing
per skin — 8-bit and Futuristic get pixel, the other seven share one line-art
set. That shared set was redesigned once already: three candidate directions
were mocked up and verified with an ASCII rasterizer before any went into the
app (two of the three food-icon drafts broke on inspection — a fork thinned
into illegibility, a cup's curved handle rendered as disconnected fragments —
both redrawn as straight-line geometry, which is also more robust at small
sizes). Bespoke icon sets for every skin were considered and rejected: it
would mean ~30+ more hand-drawn SVGs and every card carrying nine variants.

### 7.2 Filter state

Several independent axes, deliberately not collapsed into one:

- `activeView`: `browse | places | plan | trips`, with two more sub-selection
  variables scoped inside two of those — `placesTab: pinned | recent` and
  `tripsTab: saved | recap`
- `activeCat`: `all` or a category key
- `dietFilter`: `any | vegetarian | vegan | halal | kosher` — only shown/
  meaningful for `food | coffee | bars`, reset to `any` automatically when
  leaving those categories so it can't silently hide results later
- `openOnly`: boolean

The earlier single-`activeCat` model made every filter mutually exclusive —
"Coffee that's open now" was unrepresentable. `sectionLabelText()` renders the
active combination so the current filter is always visible.

Pinned and Recent (jointly, "Places") bypass the radius filter: saving or
having viewed somewhere 200 miles away shouldn't make it vanish.

**Six top-level view chips collapsed to three, in two passes.** First,
splitting the view-selector chips onto their own scrollable row, separate
from the category/diet/open-now filters — genuinely different mental
operations, but even that row alone (five chips) still overflowed most phone
screens. The actual fix was consolidating **Pinned + Recent into "Places"**
and **Saved + Recap into "Trips,"** each with a small secondary sub-tab pair
that only appears once that top-level view is active. `placesTab`/`tripsTab`
persist across navigation the same way radius or category do — switching
away and back to Places returns to whichever sub-tab was last open, not a
hard reset to Pinned every time.

**The two merges weren't equally easy, and that's worth recording.**
Pinned and Recent were already computed inline within `render()`'s own
item-selection branch — both flat card lists sharing the exact same
rendering, pagination, and search-box code, differing only in which array
they read from. Merging them was almost entirely a rename. Saved and Recap,
by contrast, already dispatched to two genuinely separate functions
(`renderSaved()`, `renderRecap()`) with different layouts — merging those
meant wrapping a shared sub-tab bar around an *existing* dispatch rather than
unifying the rendering itself, which stayed untouched.

**`dietFilter` has to be threaded through two separate filter chains, not
one.** `render()`'s own item list and Surprise Me's candidate-pool
computation are two different code paths that both filter by category —
adding diet filtering to only one of them was a real bug caught before
shipping: Surprise Me could pick something the active diet filter would
then hide, since its page/index calculation (a separate mirror of `render()`'s
filter chain, needed to scroll to the right card) wouldn't find that pick in
the actually-filtered list. Both paths now filter identically.

### 7.3 Pull to refresh

Custom touch handlers, since a standalone PWA has no browser chrome. Guards:
top of page only, downward drag only, bails on horizontal drags (the filter
rows scroll sideways), disabled while locked or already refreshing. Resistance
factor 0.5, threshold 72px, capped at 110px. `overscroll-behavior-y: contain`
prevents Safari's native gesture from competing.

### 7.4 Cover images

Photos come from `tags.image`, `wikimedia_commons`, or a batched Wikipedia
lookup. Where none exists, a category-tinted SVG tile renders instead. Images
carry `onerror="this.remove()"` so a dead URL reveals the tile beneath rather
than a broken-image icon. Photos load *after* the first render and trigger a
second — results should never wait on pictures.

---

### 7.5 Settings menu

Theme, skin, Face ID, and live compass sit behind one ⋯ dropdown rather than as
loose header buttons. Each control kept its original element ID and handler
when moved — the consolidation was purely positional.

Explanatory captions that used to sit permanently under the search row and
locate button moved behind ⓘ icons sharing a single repositioning popover.
Two similar-looking texts were **deliberately left inline**: the PIN setup
explanation and the shared-plan privacy note. Those appear once, at the moment
a consequence needs understanding, and hiding them would undercut the
reassurance they exist to provide.

### 7.6 Compass

A full rose: eight ticks with cardinal ones longer and darker, fixed N/E/S/W
letters (N accented), and a radial dial gradient. Letters draw from
`--font-label`, so each skin's compass restyles automatically.

**Live heading** is optional and off by default. `updateCompass()` computes the
target bearing; `renderNeedle()` decides what to draw:

- No live heading → needle shows the absolute bearing
- Live heading → shows `(bearing - deviceHeading)`, i.e. which way to *turn*
- Live heading, no destination yet → points north, like a real compass

iOS requires `DeviceOrientationEvent.requestPermission()` from inside a user
gesture, which is why it's wired to a tap and never auto-started. Readings are
smoothed with an exponential filter that takes the shorter path across the
0°/360° wrap, damping large single-step jumps harder (α 0.06 vs 0.15) since
those are usually magnetic interference rather than real rotation. DOM writes
are throttled to ~12/sec.

**Still imperfect.** Jitter persists on at least one real device. Heavier
smoothing trades responsiveness for stability and the current balance is a
judgement call, not a solved problem.

### 7.7 Pagination

Purely presentational — filtering, sorting, distance limits, and the compass
all operate on the full result set. Page resets on any change to what's being
listed. Hidden in plan and saved views, which aren't paged lists.

### 7.8 Service worker and offline plan photos

`sw.js`, registered after boot so it never delays first paint. Strategy
differs deliberately by resource, and getting this backwards is the classic
PWA mistake:

- **App shell: network-first.** The live version wins whenever reachable;
  cache is only an offline fallback. This is the actual fix for the earlier
  iOS problem where deploys seemed not to land — cache-first HTML was why.
- **Fonts: cache-first.** Versioned by URL, effectively never change.
- **Everything else (places, geocoding, weather, most photos): never
  cached.** A stale "currently open" badge is worse than no answer.

**One narrow, explicit exception to "never cache live data": plan photos.**
Losing signal is most likely on the day someone's actually traveling — the
worst possible moment for the app to fall back to the generic seed set. The
plan's own data (names, hours, coordinates) is already safe offline since it
lives in the encrypted vault; the one thing that genuinely breaks is cover
photos, ordinary network images the service worker doesn't touch by default.

`ensurePlanPhotosOffline()` collects every photo URL currently in `planDays`
(all days, not just the active one — the whole trip should work offline, not
just today's tab), compares against a joined-URL signature the same way
`ensurePlanWeather()` already does, and — only on a real change — posts
`{type:'cachePlanPhotos', urls}` to the service worker. The worker fetches
each URL individually into a dedicated `PLAN_PHOTO_CACHE` bucket rather than
using `cache.addAll()`, which fails the whole batch if even one URL 404s; a
single dead photo link shouldn't cost the rest of the trip its offline
coverage. The fetch handler checks this cache **only** for requests that
would otherwise be completely ignored — this is not a general image cache,
just the specific URLs a plan actually asked to be kept offline.

An update-notification bar accompanies the service worker: without an
explicit prompt, a new version sits in "waiting" until every tab closes,
which on an installed iOS app can be effectively never.

---

## 8. Testing approach

No test framework (no build step). Verification is scripted checks against the
script blocks extracted from the HTML:

| Check | Catches |
|---|---|
| `node --check` on extracted JS | Syntax errors |
| **Execution against a DOM stub** | `ReferenceError` at load |
| **Function-count / duplication grep** | Clipped or duplicated blocks after edits |
| **Self-recursion scanner** | A function calling itself via bad find/replace |
| Behavioural harnesses in `node -e` | Hours parsing, optimizer, smoothing, index math |
| `<div>` open/close counts | Unbalanced markup after insertions |

### The dominant bug class: edit damage, not logic errors

Nearly every bug that reached production in this project came from **an edit
clipping or duplicating something**, not from flawed reasoning:

| Bug | Cause | Caught by |
|---|---|---|
| `lastGeocodeAt` undefined | Replacement range swallowed the declaration | User report |
| Duplicate `classifyTags` | Old copy shadowed the replacement | User report |
| `enrichPhotos()` infinite recursion | Blanket find/replace matched inside the function's own body | User report |
| `haversine` declaration deleted | Insertion anchor consumed the function signature | `node --check` |
| `lastDestBearing` undefined | Same — anchor line was the declaration | Post-edit grep |
| Duplicated smoothing block | Partial replace left both old and new | Post-edit grep |
| `renderSaved` declaration deleted | Same pattern again — anchor line was `function renderSaved(list, label){` itself, consumed while inserting `renderRecap` above it | Post-edit grep, before any further edits |
| v5 migration silently dropped old-shape plans | `Object.assign(emptyPlan(), obj.plan)` supplied an empty `stops:[]` before the old-shape check ran, so the check never fired | Direct testing of all four vault generations against fixtures — not caught by inspection |
| Weather timezone fix only half-correct on first attempt | `new Date(naiveTimestamp)` parses using the runtime's own timezone, not the queried location's — invisible when testing your own location, since browser and location timezone match | Deliberately tested against Tokyo, a timezone guaranteed to differ from the test runtime |

The trend matters: the first three were found by the user, the rest by
tooling and deliberately adversarial test cases added in response.
**Syntax checks alone don't catch this class** —
recursion and shadowing are both syntactically valid. What works is verifying
structure after every substantial edit: function counts, duplicate definitions,
self-calls, and actually executing the file.

### Test against the hard case

The Overpass query worked in Pearland and failed in Boston. Sparse-area testing
validated nothing about dense-area behaviour, which was the case that mattered.
Same lesson later: weather's hourly path worked while `current` didn't, and only
a real device revealed it.

### What can't be tested here

Device orientation, WebAuthn/PRF, real network calls, and actual mobile
rendering have no sandbox equivalent. These need real-device testing and should
be treated as unverified until someone runs them. The live compass and the Face
ID PRF path are both in this category.

---

## 9. Known limitations

| Limitation | Cause | Fix would require |
|---|---|---|
| No ratings or price levels | OSM has neither | Paid API → key → backend proxy |
| Sparse photos outside outdoor categories | Wikipedia/Wikidata require notability; Panoramax is category-restricted (§3.6) | Foursquare/Google trade away the zero-key architecture (§10.2 history) |
| Straight-line distances | No routing API | Directions API + backend |
| No multi-stop routing | Apple Maps URL scheme limits | Different provider or native app |
| Wide radii degrade in dense cities | Free Overpass capacity | Self-hosted Overpass, or paid POI API |
| Saved plans don't re-validate on save (only on load) | Deliberate — see §5.4, §5.8 | Already addressed for loading; saving stays a snapshot by design |
| Live compass jitter | Sensor noise; smoothing imperfect | Better filter, or accept — unresolved, waiting on real-device feedback |
| Panoramax response shape unverified against a live call | No network access in the build environment | First real-world test is the actual verification |
| Filter bar can still feel dense with every optional row visible | Cumulative feature growth — partially addressed in the view-tabs/filter-bar split (§7.2) | Revisit if it still feels crowded after that change lands |

---

## 10. Future work

### 10.1 Shipped since the last major doc pass

For the record, since this list used to name these as "future work" and
several trackers still pointed back to it: multi-day trips, plan
revalidation, calendar export, recently viewed, search across pinned places
and journals, the full WCAG accessibility pass, two new skins (Futuristic,
Rose — nine total), lock-screen icons, the live compass, menu links,
wheelchair badges, a dietary filter, journal export, offline plan photos,
trip recap, and Panoramax as a third photo source. See §§3.5–3.6, 5.7–5.10,
7.1–7.2, 7.6, 7.8.

### 10.2 Photos — decision history

Researched August 2026, in order of what was actually tried:

| Option | Verdict |
|---|---|
| **Google Places (New)** | Photos are Pro-tier, billing account required, terms restrict use alongside non-Google maps (this app hands off to Apple Maps). Rejected. |
| **Foursquare** | Licensing forbids the caching this app's cost model depends on. Rejected. |
| **Yelp Fusion** | No free tier; trial forbids public launch. Rejected. |
| **Apple MapKit JS** | $99/yr, no evidence of a public photo API at all. Rejected. |
| **Mapillary** | Technically workable (§ still documented below for the setup detail), but Meta-owned — ruled out on that basis specifically, not a technical failure. |
| **Panoramax** | **Shipped.** No key at all (better than Mapillary architecturally, not just ethically), IGN/OSM-France-backed moving to an independent foundation. See §3.6. |

**Mapillary specifics, kept for the record in case Panoramax's coverage
proves too thin and this gets revisited:** its April 2026 Image Radius
Search endpoint (`lat`, `lng`, `radius`, `limit`) is purpose-built for
exactly this use case; radius maxes at 50m; thumbnail URLs expire (TTL),
requiring the image ID to be cached instead of the URL; requires a free
client token via `mapillary.com/dashboard/developers` (Meta account).

### 10.3 Genuinely still open

1. **Cloudflare Pages + Access** — real authentication. Documented in
   `DEPLOY.md`; deferred because the threat is already mitigated.
2. **Real routing** — driving distances and multi-stop directions. Needs a
   backend proxy; breaks the zero-backend architecture, so this is a bigger
   decision than most items here.
3. **Live compass jitter** — tuned, not solved. Waiting on real-device
   testing to know which direction (more damping vs. more responsiveness)
   actually needs adjusting.
4. **iOS SDK migration** — evaluated and explicitly declined for now. The
   only two things native would genuinely fix are the live compass
   (CoreMotion vs. `webkitCompassHeading` uncertainty) and Face ID
   (LocalAuthentication vs. the PRF/fallback complexity). Everything else
   works equivalently or better as a web app, and a full rewrite would
   freeze feature development to reach parity with what already exists.
   Revisit if/when App Store distribution to people outside the current
   trusted-tester group becomes the actual goal — that's the real trigger,
   not feature parity.

### 10.4 Watch items

- Overpass and Nominatim are free community infrastructure with no SLA.
- Nominatim's usage policy could tighten; the app already honours 1 req/sec.
- Open-Meteo is free for non-commercial use up to 10,000 daily calls.
- Panoramax's US coverage is likely thinner than Mapillary's more mature
  crowdsourced base — real usage will show whether that matters in practice.

---

## 11. Decision log

Decisions worth remembering, and why — so they don't get quietly reversed.

| Decision | Reasoning |
|---|---|
| No framework, no build | The app is small enough that the tradeoff favours simplicity; zero maintenance |
| Envelope encryption over direct PIN encryption | Lets unlock methods be added/removed without touching the vault |
| PRF preferred, fallback opt-in with explicit warning | A security downgrade the user can't see is worse than no feature |
| Personal ratings; price feature removed | Personal price tracking can't answer "before I go," which was the actual need |
| Live data on both paths | Curated data was better in one town and useless everywhere else |
| Ordered stops array over named meal slots | Named slots made mixed sight/meal sequences unrepresentable |
| Independent filter axes (view / category / open-now) | Single-axis filtering made "Coffee, open now" impossible |
| Progressive radius degradation | A smaller real answer beats an error, provided the app admits it |
| Apple Maps handoff over in-app detail | Apple Maps already has photos, reviews, and price; duplicating needs a key and backend |
| `q` + `sll`, never `q` + `ll` | `ll` drops a labeled pin with no business data; `sll` runs a real search |
| Skins as tokens, no JS branching | Dual-render would double the cost of every future feature, permanently |
| All 14 palettes WCAG-verified | Aesthetics don't override accessibility; most drafts failed and were fixed pre-merge |
| Storage keys stay `afield-*` after rename | Renaming would wipe every existing tester's vault |
| Weather fetched on plan signature, not per render | `render()` fires for unrelated reasons; refetching each time is wasteful |
| Header weather from `hourly`, not `current` | The verified-working path beats the one that couldn't be tested |
| Compass points north when no destination | A real compass always shows a direction; also makes the feature self-verifiable |
| Shared plans readable without a PIN | Data arrived via link, not from anyone's vault; requiring setup defeats sharing |
| Saved plans revalidated on load, not on save | Loading is when staleness actually matters; saving stays a cheap snapshot |
| Photos deferred rather than compromised | Every paid option costs money, licensing flexibility, or the backend-free architecture |
| Panoramax chosen over Mapillary | No key at all beats a free key — architectural fit, not just values alignment |
| `planDays` keeps `dayPlan` as a live reference, not a copy | ~100 existing call sites read `dayPlan` directly; a reference kept them all working unmodified |
| Diet filter resets when leaving food categories | An invisible active filter that silently hides results later is worse than losing the selection |
| View-chips and browse-filters split into two rows | Six view chips, a dropdown, and a toggle chip together in one row overflowed on a phone; the two are different mental operations anyway |
| Plan-photo cache is a narrow exception, not a general image cache | Staying offline-safe for exactly the current trip's photos, without weakening "never cache live data" everywhere else |
| Recap derives from `planDays` + `journalStore` live, stores nothing new | A read-over-existing-data view is safer than inventing a parallel "trip archive" concept that could drift out of sync |
| iOS native migration declined for now | Only two things (compass, Face ID) would genuinely improve; a full rewrite costs weeks to reach parity the web app already has |

---

## 12. File inventory

| File | Purpose |
|---|---|
| `index.html` | The entire application |
| `sw.js` | Service worker — offline app shell, font caching, plan photo caching (§7.8) |
| `manifest.json` | PWA install metadata |
| `icon.svg` | App icon |
| `robots.txt` | Discourages search indexing |
| `README.md` | User-facing overview |
| `DEPLOY.md` | Hosting and access-control guide |
| `TECHNICAL_DESIGN.md` | This document |
| `concept-8bit-rpg.html` | Standalone 8-bit skin concept mockup (not shipped) |
| `icon-set-options.html` | Standalone mockup comparing the three cover-icon redesign candidates (§7.1) — not shipped, reference only |

All docs current as of v1.2.
