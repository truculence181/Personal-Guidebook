# Afield

A live field guide to what's worth wandering to near you.

Afield finds parks, trails, cafes, bars, museums, and viewpoints around your
current location — or around anywhere you're planning to go — and tells you
what's actually open right now. It runs entirely in your browser. There is no
account, no server, and no tracking.

---

## What it does

**Finds what's nearby.** Tap the locate button and Afield queries live map data
at your exact coordinates, sorted closest-first.

**Plans ahead.** Type any city or address to browse spots there before you
travel.

**Shows what's open.** Each card displays today's hours at a glance, plus a
live open/closed status checked against the current time — including places
that close after midnight.

**Points the way.** A compass needle on the header tracks the bearing to the
nearest open pick.

**Saves your places.** Tap the star on any card to pin it. Pins persist across
sessions and are encrypted on your device.

**Opens in Apple Maps.** Tap a card to jump straight to directions.

**Surprises you.** One button picks something random that's open right now.

---

## Privacy

Afield has no backend. Nothing you do is uploaded anywhere.

- **Your location** is read by your browser and used to build map queries. It
  is never stored or transmitted to any server run by this app.
- **Your pinned places** are encrypted with AES-GCM using a key derived from
  your PIN (PBKDF2, 150k iterations) and stored only in your browser's local
  storage. The PIN itself is never saved — only a random salt and the encrypted
  blob. A wrong PIN simply fails to decrypt.
- **The app re-locks** whenever it's backgrounded, except when you're handing
  off to Maps or the phone dialer.

Because the PIN is never stored, forgetting it means your pins are
unrecoverable. That's by design, not an oversight.

A Content-Security-Policy restricts the page to only the handful of domains it
needs, so injected code has nowhere to phone home to.

---

## Data sources

Place data, hours, and photos come from
[OpenStreetMap](https://www.openstreetmap.org/copyright) via the Overpass API.
Location search uses Nominatim. Both are free community services.

This means:

- **Coverage varies.** Cities are mapped well; rural areas can be thin.
- **Hours are often missing.** Cards show "hours unknown" rather than guessing.
- **There are no ratings or reviews.** OpenStreetMap doesn't have them.
- **Photos are sparse.** Where a place has an openly-licensed photo tagged, it
  displays; otherwise a clean category tile fills the space.

The app tries three Overpass mirrors before giving up, and rate-limits its own
geocoding requests to respect Nominatim's usage policy. If the network is
unreachable, it falls back to a small built-in set of places and says so.

---

## Running it

Afield must be served over **HTTPS** or from **localhost**. Opening the HTML
file directly (`file://`) breaks geolocation, the encrypted PIN vault, and
home-screen installation.

**Locally:**

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

**Hosted:** see [DEPLOY.md](DEPLOY.md) for step-by-step GitHub Pages setup,
plus options for putting the site behind real authentication.

**On your phone:** open the hosted URL in Safari (iPhone) or Chrome (Android)
and choose "Add to Home Screen." It launches full-screen with its own icon.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | The entire app — markup, styles, and logic in one file |
| `manifest.json` | Home-screen install metadata |
| `icon.svg` | App icon |
| `robots.txt` | Keeps the site out of search results |
| `DEPLOY.md` | Hosting and access-control guide |

No build step, no dependencies, no package manager. Edit the HTML and reload.

---

## Known limits

- **No offline mode.** No signal means no results, aside from the built-in
  fallback set.
- **Apple Maps links** open natively on iPhone and Mac. On Android and Windows
  they fall back to Apple's web map, which works but is less useful.
- **Free public APIs** have no uptime guarantee. Overpass occasionally
  rate-limits or goes down.
- **No ratings.** Adding star ratings and business photos would require the
  Google Places API, which needs a billing account and a key that can't be
  safely embedded in a public client-side app — it would need a small backend
  proxy.

---

## Credits

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
available under the Open Database License.

Typefaces: Fraunces, Inter, and JetBrains Mono via Google Fonts.
