# Body Multi-Tracker

A p5.js + MediaPipe app that tracks a performer's whole body from the webcam, draws the
skeleton on black, and lets you **click any point to turn it into a MIDI controller** for
Ableton Live. Click again to stop it. Select as many points as you like.

Each selected point streams two MIDI Control Change values:

- **X** → CC *n* — 0 = left edge of the frame, 127 = right edge
- **Y** → CC *n + 1* — 0 = bottom, 127 = top (so raising an arm raises the value)

The CC numbers are fixed per point (table below), so your Ableton mappings never move when you
select or deselect other points.

It can also **play notes** on a synth (Notes mode), for example the Playtronica DX7 in another
browser window. New to MIDI? Read **[HOW-IT-WORKS.md](HOW-IT-WORKS.md)** first.

## Run it

```bash
cd ~/Desktop/body-multi-tracker && python3 serve.py
```

Or just double-click **Start Body Tracker.command**. Then open **http://localhost:8765 in Chrome** (or Edge). Safari and Firefox don't have Web MIDI.
Allow the camera and MIDI when Chrome asks.

## Install it as a Chrome app

Body Multi-Tracker is an installable Chrome app (PWA). It gets its own window, a Dock icon, and
it starts offline once it has run online one time.

1. Double-click **Start Body Tracker.command** (it serves the app on port 8765 and opens it).
2. Click **Install app** at the top of the panel, or use Chrome's install icon in the address bar
   (⋮ menu → *Cast, save and share* → *Install page as app…*).
3. From then on, open **Body Tracker** from the Dock, Launchpad or `~/Applications/Chrome Apps`.

The app still talks to the small local server, so that has to be running: start it with the
`.command` file first (it opens the app window too). Always install from
**http://localhost:8765**, because Chrome ties an installed app to that address.

## Using it

- Every tracked point is a white dot. Hover one to see its name and CCs; **click to start sending**.
- A selected point gets a colour, a pulsing ring, a trail, and crosshairs showing its X and Y.
- The right-hand panel lists every point that is sending: **◉ SENDING · Left hand**, its CC
  numbers, live values (0–127) and bars. When the camera loses the body (or just that point)
  it says **HOLD** and keeps the last numbers: nothing new is sent, so Ableton stays where it
  was until the point is seen again. **NO PORT** means no MIDI output is chosen.
- **All points** in the panel lets you pick points by name too.
- **Monitor** shows the last MIDI messages actually sent; the green light blinks on traffic.
- **Track fingers** (Options) runs MediaPipe's hand model for the five fingertips and the true
  palm centre. Turn it off if the frame rate drops; the fingers are then estimated from the body.
- Keys: **1–4** number of bodies, **R** re-assign by position, **V** show/hide camera, **M** mirror, **C** stop all.
- Selection, port, channel and options are remembered between sessions.

## Playing a synth: Notes mode

Under **Send** in the panel there are three modes:

| Mode | What each selected point sends | Use it for |
|---|---|---|
| **Controllers** (default) | X and Y as CC numbers | Mapping knobs in Ableton |
| **Notes** | Notes: height = pitch | Playing a synth: the Playtronica DX7, an Ableton instrument… |
| **Both** | Notes and CCs together | Playing a synth and moving Ableton knobs at the same time |

In **Notes** mode:

- **Height plays the note.** The frame is split into the steps of a scale, shown as faint lines
  with note names on the left of the stage. Bottom = lowest note, top = highest. When a point moves
  into the next step, the old note stops and the new one starts.
- **Faster movement plays louder** (velocity 55–127).
- **Left–right** of each body's **first** selected point (in the order of the CC table) moves the
  **mod wheel (CC 1)**, **pitch bend**, or nothing. Choose under *Left–right*.
- **Scale, root, octave, range:** for example *Minor pentatonic, C, Octave 3, 2 octaves* covers
  C3 to C5. Pentatonic scales always sound in key, which makes them a good start.
- **Each selected point is its own voice.** Two hands = two notes at once.
- **Several bodies:** each body plays on its own channel (body 1 on ch 1, body 2 on ch 2…).
- **A lost point stops its note** (the row says **SILENT**). It starts again when the point is seen.
  Notes never hang: changing mode, scale or number of bodies, and closing the app, stops all
  notes. **All notes off** in the panel does it by hand.
- In **Both** mode, Right wrist X (CC 64) is not sent, because synths read CC 64 as the sustain pedal.

### Example: the Playtronica DX7 in another browser window

The [DX7 synth on synth.playtronica.com](https://synth.playtronica.com/dx7/) (Matt Montag's DX7
emulator) receives MIDI from the same IAC cable, window to window:

1. Do step 1 of the Ableton section (turn on the **IAC Driver**) if you haven't yet.
2. In the tracker: MIDI out **IAC Driver Bus 1**, **Send → Notes**, and click a point (for example
   the right hand).
3. Open https://synth.playtronica.com/dx7/ in Chrome. Allow MIDI when asked.
4. In the DX7, set its **MIDI input** menu to **IAC Driver Bus 1**. It doesn't pick it by itself.
5. Click once anywhere on the DX7 page, so Chrome lets it play sound.
6. Raise and lower your hand: the DX7 plays the scale. Pick a different DX7 patch for a new sound.

Good to know about the DX7: it plays notes on every channel except 10, with one sound for all
of them, so several bodies play the same sound together. Besides notes it only reacts to the mod
wheel (CC 1), sustain (CC 64), pitch bend and aftertouch, so **Controllers** mode does nothing
there. To give each dancer a different sound, use Ableton: one MIDI track per body, each set
to *MIDI From: IAC Driver, Ch. 1* (2, 3, 4…), each with its own instrument, and the track
monitor set to **In**.

### Notes into Ableton instruments

1. In Live's Settings → Link, Tempo & MIDI, turn on **Track** for *In: IAC Driver (Bus 1)*
   (as well as Remote, if you use Controllers too).
2. Make a MIDI track with an instrument. Set **MIDI From** to *IAC Driver (Bus 1)*, the channel
   to the body's channel (or *All Channels*), and **Monitor** to **In** (or arm the track).
3. Set the tracker to **Notes** (or **Both**) and move.

## Several bodies (up to 4)

Under **Bodies** in the panel, choose **1, 2, 3 or 4** (or press the keys **1–4**). With 1 the
app works as described above.

With more than one body:

- **Each body is a slot with its own colour and its own MIDI channel.** Body 1 uses the channel
  picked in the panel (the menu is labelled *Body 1 channel*), body 2 the next one, and so on.
  With the default: **Body 1 → ch 1, Body 2 → ch 2, Body 3 → ch 3, Body 4 → ch 4.**
- **Every body uses the same CC numbers.** Nose X is CC 22 for everyone; only the channel
  changes. Ableton treats *ch 2 CC 22* and *ch 1 CC 22* as different controls.
- **A tag above each head** shows `BODY 2 · ch 2`. The skeleton is drawn in the body's colour.
- **Clicking a point selects it on that body only.** Tick **Same points on all bodies** and a
  click selects (or deselects) that point on every body at once, so you set it up one time.
- **All points** has a tab per body, to pick points by name for a chosen body.
- **The Sending list is grouped by body**, each with its channel and whether it is
  *● tracked* or *○ not in view · HOLD*.
- **Re-assign by position** (or key **R**) renumbers the bodies from left to right on screen.
  Do it at the start of a piece, so Body 1 is the dancer on the left.

### How the app keeps track of who is who

MediaPipe finds the bodies but doesn't know who is who, and the order it lists them in can change
from one frame to the next. The app follows each person by where their torso was in the
previous frame, so a dancer keeps their slot (and channel) while they move. If someone leaves,
their slot holds its last values. When they come back, they get the free slot back. When people
cross or overlap, the slots can swap: press **Re-assign by position** to put them back in order.

### Camera and speed

- Every extra body costs processing time. Roughly, on an Apple Silicon Mac: 1 body 30–60 fps,
  2 bodies 30–45 fps, 4 bodies 20–30 fps (the frame rate shows at the top left). Set **Bodies**
  to the number of people actually on stage, not more.
- Use a wide lens or put the camera far enough back that **every dancer is fully in frame**, head
  to feet. Even light from the front helps a lot.
- Keep some space between dancers. A dancer hidden behind another one goes on HOLD until seen again.

### Mapping several bodies in Ableton

The steps are the same as for one body. Press **map** on the row of the body you want; the app
sends only that body's CC on its channel. After mapping, the knob's label in MIDI Map mode
shows the channel too (for example **2/22** = channel 2, CC 22). The IAC input with **Remote** on
listens to all 16 channels, so nothing else needs setting up.

## How the MIDI works

For the full plain-language explanation, see **[HOW-IT-WORKS.md](HOW-IT-WORKS.md)**. In short:

- The app acts like **a MIDI controller with 92 knobs**. Every point owns two **Control Change
  (CC)** numbers: X on CC *n*, Y on CC *n + 1*. Values go from 0 to 127.
- **Everything goes out on one MIDI channel**, the one picked in the panel (default **1**).
  Points are told apart by **CC number**, not by channel: one channel has 128 CCs and all 46
  points use 92 of them. Ableton stores each mapping as *channel + CC*, so every point is a
  separate control.
- **Example:** tracking Head top, Nose and Right eye sends six streams on channel 1:

  | Point | X | Y |
  |---|---|---|
  | Head top | CC 20 | CC 21 |
  | Nose | CC 22 | CC 23 |
  | Right eye | CC 26 | CC 27 |

- A value is sent **only when it changes**. When a point is lost, it is held (**HOLD**) and
  nothing is sent, so Ableton keeps the last value.
- MIDI travels from Chrome to Ableton through the **IAC Driver**, a virtual MIDI cable built
  into macOS.

## Connecting to Ableton Live (macOS), step by step

You do steps 1–3 once. Step 4 is done for each knob you want to control.

### 1. Turn on the IAC Driver (once)

1. Open **Audio MIDI Setup** (Spotlight → "Audio MIDI Setup", or Applications → Utilities).
2. Menu **Window → Show MIDI Studio**.
3. Double-click the red **IAC Driver** icon.
4. Tick **Device is online**.
5. Under *Ports* there should be **Bus 1**. If the list is empty, click **+** to add one.
6. Click **Apply** and close the window. It stays on after a restart.

### 2. Start the app and pick the port

1. Double-click **Start Body Tracker.command** (or open the installed Chrome app).
2. Allow **camera** and **MIDI devices** when Chrome asks.
3. In the panel under **MIDI out**, choose **IAC Driver Bus 1**. It's picked automatically when
   it exists. If it's missing, reload the app (⌘R) after step 1.
4. Leave the channel on **Channel 1** (any channel works, but keep it the same once you've mapped).
5. Click a point on the skeleton. The green light next to the port should blink while you move,
   and **Monitor** shows messages such as `ch1  CC  22   64`.

### 3. Let Ableton listen to the IAC Driver (once)

1. Open Ableton Live → **Live → Settings…** (⌘,). In older versions it's *Preferences*.
2. Open the **Link, Tempo & MIDI** tab (*Link/MIDI* in Live 10/11).
3. In the **MIDI Ports** list, find the row **In: IAC Driver (Bus 1)**.
4. Turn on **Remote** for that row. This is what lets MIDI Map mode use its CCs.
   - **Track** only matters if you want notes into MIDI tracks. You can leave it off.
5. For **Out: IAC Driver (Bus 1)**, leave Track and Remote **off**, so Ableton doesn't send MIDI
   back into the same cable.
6. Close Settings. Move a selected point: the **MIDI indicator** (top right of Live, the upper of
   the two small squares) should flash.

### 4. Map a point to a knob

Example: make **Nose X** (turning or leaning your head) move a filter cutoff.

1. In the app, click the **Nose** so it shows **◉ SENDING** in the panel.
2. In Ableton, add an **Auto Filter** to a track.
3. Press **⌘M**, or click the **MIDI** button at the top right. Mappable controls turn **blue**.
4. Click the Auto Filter's **Frequency** knob. It gets a highlighted outline.
5. In the app, press **map** next to **X** on the Nose row. The row shows **MAPPING X** and, for
   1.5 seconds, the app sends **only CC 22**, so Ableton learns exactly that one. Otherwise it
   would grab whichever of the many CCs arrived last.
6. The knob now shows a small label such as **1/22** (channel 1, CC 22).
7. Repeat steps 4–5 for more knobs, for example Nose **Y** → Resonance.
8. Press **⌘M** again to leave MIDI Map mode. Move your head and the filter follows.

### 5. Shape the response (Min / Max)

While in MIDI Map mode (⌘M), the browser on the left shows the **MIDI Mappings** list: one row
per mapping with *Channel, Note/Control, Path, Name, Min, Max*.

- Set **Min / Max** to limit the range. For example Frequency 200 Hz – 5 kHz, so the full head
  turn only covers the useful part of the knob.
- Set Min higher than Max to **invert**, so moving up turns the knob down.
- Select a row and press **Delete** to remove a mapping.

### 6. Tips for a performance set

- **Use Rack macros.** Group instruments/effects in an Audio or Instrument Rack and map body
  points to its **Macro** knobs. Each macro can drive several parameters, each with its own range,
  and the mapping survives if you swap devices inside the rack.
- **Pick independent points.** Nose, eyes and head top move together and give similar numbers.
  Head top Y, one hand and the pelvis make a more expressive set.
- **Smoothing** (in the panel) trades speed for calm. Raise it if a sound wobbles, lower it for
  fast hits.
- **Takeover Mode** (Settings → Link, Tempo & MIDI) decides what happens if you move a knob with
  the mouse and then the body sends a different value. *None* jumps straight to the body's value,
  which is usually what you want here.
- **Save the set.** The mappings are saved in the Live Set. The CC numbers never change, so
  mappings keep working every time you open the app.
- **Check without Ableton:** the **Monitor** box in the app shows exactly what is being sent.

### Windows

Windows has no built-in virtual MIDI cable. Install **loopMIDI** (Tobias Erichsen), create a
port, choose it in the app, and turn on **Remote** for its input in Ableton. Everything else is
the same.

### Troubleshooting

| Problem | Fix |
|---|---|
| No ports in the MIDI out list | The IAC Driver isn't online (step 1), or you're not in Chrome/Edge. Reload after fixing. |
| "MIDI permission was blocked" | Click the site icon left of the address bar → allow **MIDI devices** → reload. |
| Panel says **NO PORT** | Choose IAC Driver Bus 1 under MIDI out. |
| Monitor shows messages but Ableton doesn't react | **Remote** isn't on for *In: IAC Driver* (step 3). |
| Mapping grabbed the wrong axis or point | Delete it in the MIDI Mappings list, then use the **map** button (step 4.5). |
| Knob jumps or wobbles | Raise **Smoothing**; light the performer well; keep the whole body in frame. |
| Panel says **HOLD** | The camera can't see that point. Last values are kept until it's seen again. |
| Mappings stopped working | Check the channel in the app is the same one you mapped with. |
| Two dancers swapped channels | They crossed or overlapped. Press **Re-assign by position** (R). |
| Frame rate drops with several bodies | Set **Bodies** to the number of people actually there. |

## CC table (same on every body; channel = that body's channel)

| Group | Point | X CC | Y CC |
|---|---|---|---|
| Head | Head top | 20 | 21 |
| Head | Nose | 22 | 23 |
| Head | Left eye | 24 | 25 |
| Head | Right eye | 26 | 27 |
| Head | Left ear | 28 | 29 |
| Head | Right ear | 30 | 31 |
| Torso | Neck | 32 | 33 |
| Torso | Chest | 34 | 35 |
| Torso | Belly | 36 | 37 |
| Torso | Pelvis (hip centre) | 38 | 39 |
| Torso | Left hip | 40 | 41 |
| Torso | Right hip | 42 | 43 |
| Left arm | Left shoulder | 44 | 45 |
| Left arm | Left upper arm | 46 | 47 |
| Left arm | Left elbow | 48 | 49 |
| Left arm | Left forearm | 50 | 51 |
| Left arm | Left wrist | 52 | 53 |
| Left arm | Left hand | 54 | 55 |
| Right arm | Right shoulder | 56 | 57 |
| Right arm | Right upper arm | 58 | 59 |
| Right arm | Right elbow | 60 | 61 |
| Right arm | Right forearm | 62 | 63 |
| Right arm | Right wrist | 64 | 65 |
| Right arm | Right hand | 66 | 67 |
| Left leg | Left thigh | 68 | 69 |
| Left leg | Left knee | 70 | 71 |
| Left leg | Left shin | 72 | 73 |
| Left leg | Left ankle | 74 | 75 |
| Left leg | Left heel | 76 | 77 |
| Left leg | Left toes | 78 | 79 |
| Right leg | Right thigh | 80 | 81 |
| Right leg | Right knee | 82 | 83 |
| Right leg | Right shin | 84 | 85 |
| Right leg | Right ankle | 86 | 87 |
| Right leg | Right heel | 88 | 89 |
| Right leg | Right toes | 90 | 91 |
| Left fingers | Left thumb | 92 | 93 |
| Left fingers | Left index | 94 | 95 |
| Left fingers | Left middle | 102 | 103 |
| Left fingers | Left ring | 104 | 105 |
| Left fingers | Left pinky | 106 | 107 |
| Right fingers | Right thumb | 108 | 109 |
| Right fingers | Right index | 110 | 111 |
| Right fingers | Right middle | 112 | 113 |
| Right fingers | Right ring | 114 | 115 |
| Right fingers | Right pinky | 116 | 117 |

Notes on the derived points: **Head top** is estimated (MediaPipe has no landmark there) from the
eyes, mouth and ears. **Neck**, **Chest**, **Belly** and **Pelvis** are built from the shoulders
and hips. **Upper arm** / **Forearm** are the midpoints of each bone; **Hand** is the palm centre
(from the hand model, or from the body model's wrist, thumb, index and pinky when the hand model
can't see the hand); the **fingers** are fingertips. Finger CCs skip 96–101, which synths read
as data entry / RPN / NRPN; **Thigh** / **Shin** are the midpoints of the leg bones. Left/right are the
performer's own left and right.

## Files

- `index.html` — page, panel and styles
- `sketch.js` — p5 sketch: camera, drawing, clicking, MIDI sending
- `points.js` — the tracked points, derived points, skeleton, CC numbers
- `pose.js` — MediaPipe Pose Landmarker (full model, up to 4 bodies)
- `midi.js` — Web MIDI output (CC, notes, pitch bend)
- `notes.js` — Notes mode: scales, height → pitch, velocity
- `ui.js` — right-hand panel
- `serve.py` — local no-cache server (port 8765)
- `HOW-IT-WORKS.md` — plain-language guide: camera → points → MIDI → Ableton
