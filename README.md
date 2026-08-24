# Vagatio

*Latin: wandering.* A live field guide to what's worth wandering to near you.

Vagatio finds parks, trails, cafes, bars, museums, and viewpoints around your
current location — or anywhere you're planning to go — tells you what's
actually open, and helps you build a day around them. It runs entirely in your
browser. No account, no server, no tracking.

---

## What it does

### Finding places

**Live data everywhere.** Both "near me" and searching a city query live
OpenStreetMap data at that exact point. No curated list that only works in one
town.

**Twelve categories** — Restaurants, Coffee, Bars & Pubs, Nightlife, Parks &
Trails, Scenic, Museums & Art, Historic, Entertainment, Shopping, Wellness,
Stay — selectable from a dropdown, and combinable with an "Open now" filter and
a distance radius (5 / 10 / 20 / 30 / 50 miles).

**Dietary filter** for Restaurants, Coffee, and Bars & Pubs — Vegetarian,
Vegan, Halal, Kosher. Sourced from OpenStreetMap's diet tags, which cover a
real but incomplete slice of places; the empty-state message says so rather
than implying nothing's nearby.

**Menu links** when a place has one tagged, labeled honestly — "Menu" for an
actual menu URL, "Website" when only a general site is available so it's
never confused for the real thing.

**Wheelchair accessibility**, shown as a small badge wherever OpenStreetMap
has it tagged — yes, limited, or no. Omitted entirely when untagged, same as
hours and phone numbers.

**Real open/closed status**, checked against posted hours and the current time,
including places that close after midnight. Today's hours show on every card.

**Paginated results**, 10 at a time by default, adjustable to 20 / 50 / 100.

**Pull to refresh** re-queries wherever you last searched.

### Planning a day

**Multi-day trips.** A plan can span several days, each with its own date and
ordered stops. Add a day, switch between them with tabs across the top, or
remove one — the trip keeps going either way.

**Ordered itinerary.** Assign places to Breakfast, Lunch, Dinner, or as Sights.
Stops live in one ordered sequence, so sights can sit before, between, or after
meals.

**Time-aware warnings.** Each stop is checked against *its own planned time* —
a Monday dinner pick at a place that's closed Mondays gets flagged, not just
"closed today."

**Weather per stop**, matched to that stop's actual hour, not a generic daily
forecast. Available within a 16-day window.

**Route optimization.** One tap reorders your sights to cut travel, anchored
from your location and keeping meals in their chronological slots. Leg
distances and a day total show throughout.

**Save plans you loved.** Name a day and reuse it later — loading a saved plan
sets it to today's date, not the date it was saved, and quietly re-checks
every stop against live data in the background so a plan built months ago
doesn't send you to somewhere that's since closed.

**Share with your group.** The whole plan travels inside a link. Recipients see
the itinerary immediately with no app setup and no PIN — importing it into
their own planner is a separate, deliberate step.

**Add to your calendar.** Export the whole trip (or just today) as a real
`.ics` file, one event per stop, using the same times the app shows you.

### Keeping track

**Pin places** you care about, with a live count on the Pinned chip. Search
within your pinned list once it grows past a quick scroll.

**Rate them** one to five stars — your own ratings, not a stranger's average.

**Keep a visit journal** on any pinned place: dated entries about what you had,
who you were with, whether you'd go back. A count badge shows on cards that
have entries. Export the whole journal as one markdown file, read
chronologically like an actual diary rather than sorted by place.

**Recently viewed** remembers what you opened, even if you didn't pin it —
useful for the place you looked at closely but didn't decide on yet.

**Trip recap.** Once a planned day passes, it shows up here automatically —
whatever you journaled that day, grouped with the places you actually went,
without needing to track "trips" as a separate thing you set up in advance.

### Getting there

**Apple Maps handoff.** Tapping a card searches for that business near its
coordinates, landing on the real listing with photos, hours, and reviews.

**Ride hailing.** Uber and Lyft deep links on every card and between plan
stops. Plan legs use the *previous stop's* coordinates as pickup rather than
your current GPS.

**Live compass.** Optionally uses your phone's magnetometer so the needle shows
which way to actually turn, not just an abstract bearing.

### Making it yours

**Nine skins**, each with its own fonts, corner language, shadow treatment,
and a signature detail: Classic, 8-bit (Stardew-inspired), Zen, Nature, Ocean,
Adventure, Space, Futuristic, Rose.

**Light / dark / auto**, independent of skin, following your OS by default.

All settings live behind a single ⋯ menu.

### Staying usable offline

The app itself works offline once you've loaded it — the encrypted vault
holding your pins, plans, and journal lives in your browser, not on a server,
so losing signal doesn't touch any of it. Cover photos for your **current
day plan** are cached automatically too, specifically because the day you're
most likely to lose signal is the day you're actually traveling. Live search
and weather still need a connection; everything you've already built into a
plan doesn't.

---

## Privacy

Vagatio has no backend. Nothing you do is uploaded anywhere.

- **Your location** is read by your browser and used to build map queries. It
  is never stored or sent to any server run by this app.
- **Your pins, plans, ratings, and journal** are encrypted with AES-GCM using a
  key derived from your PIN (PBKDF2, 150k iterations), stored only in your
  browser. The PIN itself is never saved — only a random salt and the
  encrypted blob. A wrong PIN simply fails to decrypt.
- **Face ID / Touch ID** can unlock the app. Where the platform supports the
  WebAuthn PRF extension, your face *derives* the key rather than merely
  approving access, so browser storage holds nothing readable. Where PRF isn't
  available, a weaker device-gated mode is offered — behind an explicit dialog
  explaining the difference.
- **The app re-locks** when backgrounded, except during handoffs to Maps, the
  dialer, or a ride app.

Because the PIN is never stored, forgetting it means your data is
unrecoverable. That's by design.

A Content-Security-Policy restricts the page to only the handful of domains it
needs.

---

## Data sources

| Source | Used for | Auth |
|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org/copyright) (Overpass) | Places, hours, phone, menu links, wheelchair access, diet tags | None |
| Nominatim | Location search | None |
| Wikipedia + Wikidata | Cover photos | None |
| [Panoramax](https://panoramax.fr) | Cover photos (parks, scenic spots, historic sites) | None |
| [Open-Meteo](https://open-meteo.com/) | Weather | None |

Every source is free and keyless. That constraint shapes what the app can and
can't do:

- **Coverage varies.** Cities are mapped well; rural areas can be thin.
- **Hours are often missing.** Cards show "hours unknown" rather than guessing.
- **No ratings or price levels.** OpenStreetMap has neither, and the APIs that
  do require a billing account and a backend proxy.
- **Photos are sparse.** Landmarks and parks often have one; a neighborhood bar
  almost never will. A category tile fills the gap.

The app tries three Overpass mirrors, degrades to a smaller radius rather than
failing outright in dense cities, and rate-limits its own geocoding to respect
Nominatim's policy.

---

## Running it

Vagatio must be served over **HTTPS** or from **localhost**. Opening the file
directly (`file://`) breaks geolocation, the encrypted vault, WebAuthn, and
home-screen installation.

**Locally:**

```
python3 -m http.server 8000
```

**Hosted:** see [DEPLOY.md](DEPLOY.md) for GitHub Pages setup and options for
putting the site behind real authentication.

**On your phone:** open the hosted URL in Safari (iPhone) or Chrome (Android)
and choose "Add to Home Screen."

---

## Files

| File | Purpose |
|---|---|
| `index.html` | The entire application |
| `sw.js` | Service worker — offline app shell and plan photo caching |
| `manifest.json` | Home-screen install metadata |
| `icon.svg` | App icon |
| `robots.txt` | Keeps the site out of search results |
| `DEPLOY.md` | Hosting and access-control guide |
| `TECHNICAL_DESIGN.md` | Architecture and decision log |

No build step, no dependencies, no package manager. Edit the HTML and reload.

---

## Known limits

- **Offline support is scoped to your current plan**, not the whole app —
  browsing new places and getting live weather both need a connection; a
  plan you've already built, including its photos, doesn't.
- **Straight-line distances**, not driving miles.
- **No multi-stop routing** — Apple Maps' URL scheme doesn't reliably accept a
  waypoint chain from the web.
- **Wide radii degrade** in dense cities, narrowing automatically and saying so.
- **Saved plans revalidate when you load them**, not while they sit saved —
  loading one checks it against live data and updates hours or flags places
  that have vanished, but a stale saved plan looks the same as a fresh one
  until you actually open it.
- **Dietary and menu data are genuinely sparse.** OpenStreetMap's coverage of
  diet tags and menu links is real but incomplete — the app says so when a
  filter comes up emptier than expected rather than implying nothing's there.
- **Panoramax photo coverage is uneven**, likely thinner in the US than more
  established sources — it's a newer, community-run project, not a
  crowdsourcing giant.
- **Live compass jitter** on some devices; smoothing is tuned but imperfect.
- **Update caching on iOS** can delay new versions; append `?v=2` to force a
  refresh.

---

## Credits

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
under the Open Database License. Weather by
[Open-Meteo](https://open-meteo.com/), under CC BY 4.0. Some photos via
[Panoramax](https://panoramax.fr), under CC BY-SA 4.0.

Typefaces via Google Fonts: Fraunces, Inter, JetBrains Mono, Pixelify Sans, Zen
Maru Gothic, Caveat, Nunito, Quicksand, Rye, Special Elite, Orbitron, Exo 2.
