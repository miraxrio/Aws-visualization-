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
