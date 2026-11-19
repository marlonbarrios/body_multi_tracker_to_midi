# How Body Multi-Tracker works

A plain-language guide: what happens from the camera to a knob turning in Ableton Live.

Body Multi-Tracker: concept and engineering by **Marlon Barrios Solano**.
Live app: https://marlonbarrios.github.io/body_multi_tracker_to_midi/

---

## 1. The camera sees a body

The webcam image goes to **MediaPipe Pose**, a machine-learning model from Google that runs
inside Chrome on your own computer. Nothing is uploaded anywhere. About 30–60 times a second it
finds 33 landmarks on the performer: eyes, ears, shoulders, elbows, wrists, hips, knees, ankles,
heels, toes and so on.

From those, the app builds **46 points**, including the five fingertips of each hand. Some are MediaPipe landmarks as they are. Others are
worked out from them:

- **Head top:** going up from the mouth through the eyes, about one head-height.
- **Neck, chest, belly, pelvis:** in between the shoulders and the hips.
- **Upper arm, forearm, thigh, shin:** halfway along each bone.
- **Hand and fingers:** a second MediaPipe model, made for hands, finds 21 points on each hand.
  The app uses the palm centre and the five fingertips (thumb, index, middle, ring, pinky). It
  works best when the hands are big enough in the picture. When it can't see a hand, the app
  estimates the fingers from the body model instead (rougher, and middle/ring are guessed).

"Left" and "right" always mean the **performer's** left and right.

## 2. You choose the points that matter

The screen shows the whole skeleton on black. Every point is a white dot.

- **Click a dot** to start sending it. It gets a colour, a pulsing ring and crosshairs, and
  appears in the panel on the right as **◉ SENDING · Nose** (for example).
- **Click it again** to stop sending.
- You can have one point selected, or all 46.

## 3. Every point becomes two numbers

For each selected point the app measures where it is in the camera frame:

- **X:** how far left or right. 0 is the left edge, 127 the right edge.
- **Y:** how high. 0 is the bottom, 127 the top, so raising a hand **raises** the number.

The numbers go from 0 to 127 because that is the range of a standard MIDI controller message.
The panel shows them live, with a bar for each.

## 4. The numbers travel as MIDI CC messages

MIDI is the language music software and hardware use to talk to each other. One kind of MIDI
message is **Control Change (CC)**, which is "set controller number N to value V". It's the same
message a physical knob on a MIDI controller sends when you turn it.

So the app behaves like **a MIDI controller with 92 knobs**, and your body turns them:

| You track… | the app sends… |
|---|---|
| Head top | X on **CC 20**, Y on **CC 21** |
| Nose | X on **CC 22**, Y on **CC 23** |
| Right eye | X on **CC 26**, Y on **CC 27** |
| Right hand | X on **CC 66**, Y on **CC 67** |

Each point always has the **same two CC numbers**, whatever else is selected. The full list is
in the README.

### Channels vs CC numbers

A MIDI message also carries a **channel** (1–16). Think of channels as 16 separate cables, each
with 128 knob numbers on it.

- With one body the app sends **everything on one channel**, the one picked in the panel (default **1**). With several bodies, each body gets its own channel (section 7).
- That's enough: points are told apart by their **CC number**, not by channel. One channel has
  128 CC numbers, and all 46 points together use 92 of them.
- Ableton remembers a mapping as "channel + CC number", so Nose X (ch 1, CC 22) and Right eye X
  (ch 1, CC 26) are completely separate controls.

Other channels come in when there are **several performers**: each body gets its own channel,
with the same CC numbers (section 7).

### You can shape the numbers first

Each point shows its **raw** position (0.000–1.000) and can be **mapped** before it's sent. Click
**⚙ range** on its row to choose which part of the movement counts (or let the app **learn** it
while you move), what numbers come out, whether it's inverted, and the curve. You can also
measure from the **body** instead of the camera frame: then a hand's value is the same wherever the
dancer stands. This matters because MIDI has only 128 steps. Mapping makes even a small movement
use all of them. The README explains every setting.

### Only changes are sent

A number is only sent when it **changes**. If you stand still, nothing is sent, and Ableton
simply stays where it is.

### When the body is lost: HOLD

If the performer leaves the frame, or one point is hidden (a hand behind the back, a foot out
of view), that point goes on **HOLD**. Its last numbers stay in the panel and nothing new is
sent, so Ableton keeps the last value. When the point is seen again, sending carries on.

## 5. The IAC Driver carries MIDI to Ableton

Chrome can send MIDI (Web MIDI), but it needs a "cable" to Ableton. On a Mac that's the
**IAC Driver**, a virtual MIDI cable built into macOS. The app sends into **IAC Driver Bus 1**,
and Ableton listens to the same bus.

```
 camera ─▶ MediaPipe ─▶ 46 points ─▶ you pick some ─▶ X/Y as 0–127
                                                         │
                                 MIDI CC on channel 1 (CC 20–95, 102–117)
                                                         │
                                               IAC Driver Bus 1
                                                         │
                                  Ableton Live (Remote) ─▶ mapped knobs
```

## 6. In Ableton, you map numbers to knobs

Ableton's **MIDI Map mode** (⌘M) links an incoming CC to any knob, fader or button:

1. Press ⌘M. Everything you can map turns blue.
2. Click the knob you want, for example a filter cutoff.
3. In the app, press **map** next to "Nose X". For 1.5 seconds the app sends **only** that one
   CC, so Ableton learns exactly it.
4. Press ⌘M again. Turning your head left and right now moves the filter.

Each mapping has a **Min** and **Max**, so you can choose how much of the knob's range your
movement covers, or flip it so up means down.

The README has every step in detail, including the one-time setup.

## 7. More than one body

The app can follow **up to 4 people**. Choose how many under **Bodies** in the panel.

Each body works like a **separate copy of the whole controller**, on its **own MIDI channel**:

| | Channel | Nose X | Nose Y | Right hand X | Right hand Y |
|---|---|---|---|---|---|
| Body 1 | 1 | CC 22 | CC 23 | CC 66 | CC 67 |
| Body 2 | 2 | CC 22 | CC 23 | CC 66 | CC 67 |
| Body 3 | 3 | CC 22 | CC 23 | CC 66 | CC 67 |
| Body 4 | 4 | CC 22 | CC 23 | CC 66 | CC 67 |

The CC numbers are the same for everyone; the **channel** says which dancer it is. In Ableton,
"channel 1, CC 66" (dancer 1's right hand) and "channel 2, CC 66" (dancer 2's right hand) are two
different controls, so each dancer can play different sounds.

- **Clicking a point selects it on that body only.** With **Same points on all bodies** ticked,
  one click selects that point on everyone, so you set up the layout one time.
- **The camera doesn't know names.** The app follows each person from frame to frame by
  position, so they keep their number while they move. If dancers cross or overlap, two numbers
  can swap. **Re-assign by position** numbers them again from left to right, so Body 1 is
  always whoever is on the left at that moment.
- **More bodies = more work for the computer.** Choose only as many bodies as are on stage, and
  make sure everyone is fully in frame.

## 8. Playing notes instead of turning knobs

Knobs (CC) are good for shaping a sound in Ableton, but a synth only makes sound when it
receives **notes**, like keys pressed on a keyboard. Switch **Send** to **Notes** and every
selected point becomes a voice that plays:

- **Height = pitch.** The frame is divided into the notes of a scale, shown as faint lines on
  the stage. Raise your hand and the melody climbs; lower it and it falls. A new note starts each
  time the point crosses into the next line.
- **Speed = loudness.** A fast gesture plays a stronger note than a slow one.
- **Left–right** of each body's first point bends the pitch or moves the mod wheel.
- **Scale** keeps it musical: with *Minor pentatonic*, any movement sounds in key.

This works with any MIDI instrument, including one in another browser window, such as the
Playtronica DX7: the tracker sends into the IAC Driver, and the DX7 page listens to it. The README
has the step-by-step.

---

## Ideas for using it

- **Head top Y** → a filter or reverb: crouch and it closes, stand tall and it opens.
- **Right hand Y** → volume or a send to a delay: raise your hand to bring a sound in.
- **Left hand X** → pan, or a macro that crossfades between two sounds.
- **Pelvis X** → move across the stage to morph a sound.
- **Feet / ankles Y** → small kicks or steps move a parameter.
- Points that move together (nose, eyes, head top) give very similar numbers. Pick points that
  move independently for more expressive control.
- Map points to the **8 Macro knobs of a Rack**. Each macro can drive several parameters at
  once, each with its own range.
