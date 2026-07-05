# Tutorial assets

These files power the guided **onboarding tutorial** (the "Start tutorial"
button in the top bar). The tutorial works out of the box with no extra files —
it ships with an illustrated presenter and narrates each step with the browser's
built‑in text‑to‑speech. Drop the files below in to upgrade it.

## Voice narration (optional)

Each tutorial step looks for a pre‑recorded audio clip and **falls back to
text‑to‑speech** if it can't find one. Name the clips per step using the line
number (matching how the narration is written, "line 1", "line 2", …):

```
assets/tutorial/line 1.mp3   ← narration for step 1
assets/tutorial/line 2.mp3   ← narration for step 2
...
```

Supported extensions are tried in this order: `.mp3`, `.m4a`, `.wav`, `.ogg`,
so `line 1.wav` works too. Each clip is also looked for in the **site root**
(next to `index.html`), so `line 1.mp3` beside the page works as well.

Five clips ship today:

| File | Step | Source |
|------|------|--------|
| `line 1.mp3` | Welcome / Connect ZeroBias | recorded narration |
| `line 2.mp3` | Connection modal → demo data | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 3.mp3` | Sample data / tasks & rewards | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 4.mp3` | Opportunities / posted bids | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 5.mp3` | Switch to the 2D Network View | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 6.mp3` | The 2D view of the sample network | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 7.mp3` | Switch to the Holographic view | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 8.mp3` | Moving around in 3D | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 9.mp3` | Hand-off to the network tour | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 10.mp3` | Security-system timeline intro | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 11.mp3` | v1 — Alice's initial deployment | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 12.mp3` | v2 — Bob's broken third-AZ expansion | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 13.mp3` | v3 — Alice's next-morning NAT fix | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 14.mp3` | v4 — Carol's search + cache | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 15.mp3` | v5 — Bob's API gateway + CDN | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 16.mp3` | v6 — audit prep & wrap-up | Qwen3‑TTS · voice **Vivian** (fal.ai) |

| `line 17.mp3` | Builder — enter edit mode | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 18.mp3` | Builder — drag an element onto a subnet | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 19.mp3` | Changes also show in the 3D view | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 20.mp3` | Simulate attack | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 21.mp3` | Attack picker → DDoS flood | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 22.mp3` | Explore mode (first-person) | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 23.mp3` | Load boundary → holons view | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 24.mp3` | Holon layer — System of Systems | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 25.mp3` | Holon layer — System | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 26.mp3` | Holon layer — Subsystem | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 27.mp3` | Holon layer — Component | Qwen3‑TTS · voice **Vivian** (fal.ai) |
| `line 28.mp3` | Holon layer — Atom | Qwen3‑TTS · voice **Vivian** (fal.ai) |

Steps 10–16 run **after the network tour**: the tutorial hides itself while the
tour plays and resumes with the timeline walk once the tour bar is closed.
Each version step selects that version silently (no double narration) and
auto‑advances when its clip ends. Steps 17–21 continue into the Builder
(edit mode) and the attack simulator; step 21 hides the tutorial while the
DDoS runs and resumes once its summary is dismissed. Step 22 hands off to
Explore mode — clicking Explore hides the tutorial and drops you into the
first-person view; pressing Esc leaves Explore and the tutorial resumes.
Steps 23–28 cover the holons view: a walk of the assembly layers — biggest
(System of Systems) to smallest (Atom) — each filtering the holographic view
to a single level and auto‑advancing when its clip ends.

Note: the holographic Level-0 view now renders the boundary's loose holons
as orbiters (tagged by assembly level) so the assembly-level filter can
actually isolate each layer; previously only the level-1 holonic spheres were
drawn, so filtering to any other level appeared to do nothing.

## Attack-simulator narration (`assets/tutorial/attack/`)

The cyber-attack simulator narrates the opening, each phase and the verdict.
Those lines are pre‑recorded (Qwen3‑TTS · **Vivian**) and driven from the
`ATTACK_VOICE` table in `app.js`, so the spoken words match the clips. If a
clip can't load, the browser voice reads the same line. Naming per attack id
(`ddos`, `bruteforce`, `ransomware`, `portscan`, `exfil`):

```
assets/tutorial/attack/<id>-start.mp3     ← opening line
assets/tutorial/attack/<id>-p0.mp3 … -pN  ← one per phase (index-aligned to ATTACK_DEFS)
assets/tutorial/attack/<id>-ok.mp3        ← "defended" verdict
assets/tutorial/attack/<id>-warn.mp3      ← "partly got through" verdict
assets/tutorial/attack/<id>-danger.mp3    ← "breach" verdict
```

To re-voice a beat, edit its line in `app.js` (`ATTACK_VOICE`) and drop in a
replacement clip with the matching name.

Lines 2–5 were generated with `fal-ai/qwen-3-tts/text-to-speech/1.7b`. To
re‑record any of them, just drop a replacement `line N.mp3` in here. Step 1 says:

> Welcome to the AuditCrowd visualization site, I'll explain the basics of this
> tool. To start you need to login into your ZeroBias account so you can
> interact with your data here. Press Connect to ZeroBias.

## Tour narration (the sample network)

The guided **tour** (the "Start tour" button) normally reads its narration with
the browser's voice. The bundled sample network (`sample-network.json`) ships an
authored tour instead: the latest version's `data.tour` is an ordered list of
steps, each with a human‑written `narration` and a pre‑recorded clip:

```
assets/tutorial/tour-1.mp3 … tour-12.mp3   ← Qwen3-TTS (Vivian), one per tour step
```

`tour.js` plays `step.audio` when present (any network can supply a `tour`
array) and falls back to the browser voice if a clip can't load. To re‑voice a
step, edit its `narration` in `sample-network.json` and drop in a new
`tour-N.mp3`.

## Presenter image (optional)

The guide character is loaded from, in order of preference:

```
assets/tutorial/presenter.png   ← drop your own cut‑out PNG here (transparent bg looks best)
presenter.png                   ← or beside index.html (site root)
assets/tutorial/presenter.svg   ← bundled fallback illustration
```

A portrait aspect ratio (roughly 3:4) anchored to the bottom looks best, matching
the bundled illustration.

## Adding / editing steps

Steps live in `tutorial.js` (`STEPS` array near the top). Each step supports:

- `target` — CSS selector to spotlight.
- `text` — on‑screen bubble copy (`\n` = line break).
- `speech` — text read by text‑to‑speech when no audio clip is found.
- `audioBases` — narration file base names to try (e.g. `"assets/tutorial/line 2"`).
- `cta` — optional call‑to‑action chip.
- `advanceOn: "target"` — complete the step by clicking the highlighted element
  (otherwise the user advances with the **Next** button).
- `waitFor: true` — poll for a target that renders asynchronously (after a view
  switch or data load).
- `scrollIntoView: true` — scroll the target into view before spotlighting it.
