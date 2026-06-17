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

If you recorded the narration into a folder like `Downloads/audit/`, copy the
clip for the welcome line in here as **`line 1.mp3`**. Step 1 says:

> Welcome to the AuditCrowd visualization site, I'll explain the basics of this
> tool. To start you need to login into your ZeroBias account so you can
> interact with your data here. Press Connect to ZeroBias.

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

Steps live in `tutorial.js` (`STEPS` array near the top). Each step has a
`target` CSS selector to spotlight, the on‑screen `text`, the `speech` used for
text‑to‑speech, and an optional `cta` label.
