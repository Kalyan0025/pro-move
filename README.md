# Motion Rig (prototype)

A Procreate-style screen with a "Motion Rig" extension. You perform in front of the camera, and a 2D character copies your body joints (shoulders, elbows, wrists, hips, knees, ankles) and your face (blinks, mouth, smile, brows, head tilt). It all runs locally. The tracking models are stored in `models/`, so nothing is sent to the cloud.

## Run

```
npm install
npm start
```

Open http://localhost:5173 in your laptop browser. The app appears inside an iPad Pro mockup and uses the laptop webcam. Every time a file in `public/` is saved, the page reloads by itself.


## Use

The screen copies Procreate's own interface. Motion Rig is added as one extra tab in the Actions (wrench) menu.

- Paint, smudge and erase on the canvas. The left sidebar sets brush size and opacity, the square is the eyedropper, and below it are undo and redo (Ctrl+Z / Ctrl+Shift+Z also work).
- **Actions › Prefs**: light interface, right-hand interface, brush cursor and Size & Opacity sidebar all work.
- **Actions › Canvas › Reference**: shows the camera window with the tracked skeleton.
- **Actions › Rig** (the extension):
  - **Capture**: start the camera or the demo motion, record the performance, and set smoothing and character size.
  - **Character**: "Use drawn character (Beanie)" turns your drawing into the puppet. Switch it off to use the basic figure, where you can upload a PNG for each body part exported from Procreate. Draw limbs pointing down, with the top of the image at the joint the part hangs from.
  - **Joints**: live joint angles and face meters.
- **Layers**: the character is its own "Motion Rig" layer above Layer 1.

## Characters from your drawings

**Actions › Rig › Character**
- **New character from a drawing…**: pick a full-body PNG, ideally standing in an A-pose. A white background is removed automatically. The joints are detected with the pose model, or placed from a template if it can't find a body. Drag any joint that's off, then tap **Build character**. The drawing is cut into parts automatically.
- **Edit joints**: adjust the joints of the current character.
- **Layered SVG**: traced vector parts, one named group per body part, each with its pivot (`data-pivot` and `transform-origin`), plus a hidden "Rig guide" layer. For After Effects, Rive, Figma or Illustrator.
- **Layered PSD**: one layer per body part. Open it in Procreate, fix or redraw a part (for example, the torso hidden under an arm), export PSD, then use **Import layered PSD…** to bring it back. Layers are matched by name: Head, Torso, Upper arm R/L, Forearm R/L, Thigh R/L, Shin R/L.

How the motion stays smooth:
- Each part is covered by a fine mesh. Near each joint the mesh blends between the two bones, so elbows, knees and shoulders bend instead of splitting.
- Edges of a part that were hidden under another part get an ink line, so the body keeps its outline when a limb moves away.
- Camera joints pass through a One Euro filter, which removes jitter without adding lag.
- Rendering uses WebGL2 with mipmapped textures when available, and a canvas fallback otherwise.

**Red beanie** (`public/characters/redcap.json`, the default character) is your vector character. Its front view is the open-arms pose from your SVG (`redcap-welcome.svg`), rendered to `redcap.png`. Open arms keep the sleeves and hands clear of the body, so the automatic cut is clean. The earlier arms-down front view is kept as `redcap-armsdown.png`, and the full turnaround sheet as `redcap-turnaround.svg`. Because it's flat colour without outlines, `"edges": "shade"` gives hidden edges a slightly darker shade of the part's colour instead of a black line. Its face settings make blinks use the skin colour as an eyelid, and leave the beard alone when the mouth opens.

`public/characters/beanie.json` is the line-art sample: joint positions, optional hand-drawn part outlines (`pieces`), and face points for blinks and the mouth.

## Takes: capture, keep, rig (new)

The artist-facing flow, built for 2D animators and doodle artists rather than technical animators.

1. **Capture.** Start the camera (or the demo motion). A capture bar appears at the bottom of the canvas.
   - **Pose**: tap the button, get into position during the 3-second countdown, and one pose is captured.
   - **Motion**: tap to record, tap again to stop. Recording stops on its own at 10 seconds. While recording, the rig follows the camera closely; clean-up happens afterwards.
2. **Arrival sheet.** What you captured appears as drawings.
   - For a motion, the app picks the drawings where you move the most. **Few ↔ Many** changes how many, and tapping a drawing leaves it out.
   - **Keep** puts it in Layers as a take. **Rig it** keeps it and opens Rig mode. **Retake** throws it away.
3. **Layers breakdown** (panel on the right, also listed in the Layers popover).
   - Each take is a group with one row per frame. Drag a row to reorder.
   - When two frames that weren't neighbours in the capture end up side by side and the pose changes more than a normal step, an orange **Big jump** note appears between them. Choose **Add in-between** (a blended frame, marked "made for you") or **Leave it**.
   - Play loops the take on the canvas. The previous frame shows faintly underneath (onion skin).
4. **Rig mode** (the Rig button). The same panel becomes the part tree: Head, Body, Arm R/L (upper arm, forearm & hand), Leg R/L (thigh, shin & foot), colour-coded.
   - **Bones** (modelled on TVPaint's rigging tool): every bone shows as a translucent blue diamond, widest near its joint; the selected part is darker. Tap a bone to select its part.
   - **Rotate circle**: a grey circle around the selected part's joint. Drag anywhere on the canvas to turn the part around that joint on the current frame; a shaded wedge shows how far. Children follow (turning the upper arm carries the forearm, turning the body carries head and arms). **Undo my bends on this frame** removes the changes.
   - **Animate / Rig** (like TVPaint's two modes): **Animate** (blue bones) changes only the current frame; **Rig** (amber bones) changes every frame of the take, for example making a forearm longer for the whole animation. **Undo my changes on this frame** and **Reset … on every frame** take them back.
   - **Turn / Stretch brush**: Turn rotates the selected part around its joint. Stretch makes an arm or leg (or one segment of it) longer or shorter: drag along the limb; a percentage shows while dragging (40% to 220%). The drawing stretches along the bone.
   - **Joint balls**: round elbows, knees, shoulders and hips painted in the character's own colours (sampled from the drawing, with the same soft shading and grain). They are invisible in the pose as drawn and fade in as a joint bends or stretches, so the limb never looks broken. Switch them off in **Rig Lab › Deformation › Joint balls** to compare.
   - **In-betweens** stay a blend of the two frames they were made from, so they follow when you change those frames.
   - **Background and Transform**: the scene is a background layer (**Playground** in Layers, with Replace). The Transform tool (arrow in the top bar) shows a box around the character: drag to move it, drag a corner to resize it. This applies to the live character and every frame of every take, and is remembered.
   - **Clean-up** (Sketchy ↔ Clean) removes the wobble the camera picked up.
   - **Feel** cards: Snappy (holds, then moves quickly), Smooth (one flowing line), Floaty (trails a little behind, then settles).
   - Settings flow down the tree: change an arm and its parts follow, until a part gets its own settings (blue dot; **Match the rest** resets it).
   - **Preview window** (top right): loops just the selected part. **Before** plays the raw capture, **After** plays the cleaned-up take with its feel.

Code: `public/js/take.js`. Console handle: `window.takes` (state, `jumpInfo()`, `sample(t, 'before'|'after')`).

## Feedback and guidance (build 4)

- **Capture bar is always there.** With the camera off it offers **Start camera** and **Try demo**; once live it shows a status light (green when you're tracked, amber "Step into view" when not), Pose / Motion, the shutter, and × to turn the camera off. It steps aside while the Transform tool is open.
- **Countdown and recording.** The countdown beats in the sky above the character with "Get into your pose". While recording, a **REC** chip with the time sits at the top and the canvas gets a red edge.
- **Arrival sheet.** **Preview** plays the drawings you picked on the canvas, each held until the next. Left-out drawings are tagged "Left out". The strip fades at the edge when it scrolls.
- **Frames.** Dragging lifts the row and opens a slot where it will land; jump notes step aside while you drag. After a move, a toast says how many spots won't flow. Tapping a jump note shows that spot on the canvas. While playing, the frame being shown lights up green (in the list and the Rig strip).
- **Rig panel.** Animate / Rig and Turn / Stretch sit in a toolbar that stays at the top while you scroll. The part tree folds: groups open when you pick something inside them. Rig mode adds an amber edge to the panel and a toast. Clean-up shows its value as you drag.
- **On the canvas.** Hovering a bone highlights it and shows its name; the cursor says what will happen (pointer to pick, grab to turn, ↔ to stretch).
- **Undo / redo** in a take: the arrows in the panel header, the sidebar arrows, or Ctrl+Z / Ctrl+Shift+Z undo every rig change (turns, stretches, clean-up, feel, reordering, in-betweens).
- **Tooltips** on every control: hover with a mouse or Pencil, or long-press with a finger.
- **First-use hints** for capturing, frames, the rig and Transform. Each shows once; "Got it" hides it for good (clear site data to see them again).
- **Transform** shows the size as a percentage while resizing.

## Animation Assist (frames)

Turn it on with **Actions › Canvas › Animation Assist** or **Rig › Capture frames**.
- **Add Frame** (or Space) captures the current pose. **Auto-capture** grabs frames at the chosen FPS while you perform.
- **Play** loops the frames. **Smooth in-betweens** blends between poses. Onion skin shows the previous frame.
- **Export**:
  - **Frames as PSD layers**: one layer per frame, so in Procreate you open it and turn on Animation Assist.
  - **Sprite sheet PNG**.
  - **Video**.
  - **AI pack (ZIP)**: everything needed to redraw every frame cleanly in your style with Stable Diffusion, run locally in ComfyUI or Automatic1111. Per frame:
    - `frames/`: the posed drawing, used as the img2img input.
    - `pose/`: an OpenPose skeleton, for ControlNet OpenPose.
    - `lineart/`: white-on-black outlines, for ControlNet Lineart.

    The pack also includes your drawing in `reference/` for IP-Adapter, the keypoints in `poses_openpose.json`, and a `README.txt` with the node setup, settings and prompts.

## Hold a pose to capture

**Actions › Rig › Capture**: switch on **Hold a pose to capture**. Strike a pose and hold still for the set time (1.2 s by default) while a ring fills up. One frame is captured, and you move to the next pose before another can be taken.

**Save into a folder for Procreate**: in the Animation Assist **Settings**, choose **Save frames to folder** (Chrome or Edge). Every capture writes `frame_0001.png`, `frame_0002.png` and so on, and keeps an up-to-date `animation.psd` with one layer per frame. Pick a folder in iCloud Drive and the files appear on the iPad, where Procreate opens the PSD with Animation Assist.

## Rig check (first camera start)

The first time the camera starts, a **Rig check** card walks you through six test poses: arms up, arms out, head tilted each way, elbows bent, knee lifted. Hold each pose until the ring fills. For each pose the app finds where the character chops (joints bent far from the drawing, shown in red) and has the local AI repaint only those spots. Each repair is saved as a **joint fix** for that joint and angle. While you animate, a fix fades in whenever that joint bends close to the tested angle, so the break is covered live. You can still animate while the AI works in the background.

Run it again any time from **Actions › Rig › Run rig check**. **Use AI joint fixes** switches the fixes on and off, and **Clear joint fixes** removes them. Fixes are saved per character in this browser.

## Redraw with AI (local)

The timeline's **Export › Fix gaps with AI** repaints only the chopped joints of each frame and leaves every other pixel as you drew it. **Settings › Show gap areas** previews them in red. **Export › Redraw with AI** sends each frame to ComfyUI on this laptop (Stable Diffusion 1.5 / DreamShaper 8, with ControlNet OpenPose and Lineart). The redrawn frames come back into the timeline, and playback and exports then use them. **Settings › Show AI redraws** switches between the redrawn and original frames, and **AI redraw strength** controls how much it may change.

Start ComfyUI first (installed in `D:\ComfyUI`):

```
powershell -ExecutionPolicy Bypass -File scripts\start-comfyui.ps1
```

It needs the NVIDIA GPU. On the processor alone, one frame takes about an hour.

## Character views and walking

The Red beanie carries all four views from your character sheet: front (open arms), three-quarter, side and back. They share one rig, so the same pose shows in whichever view is active; the other views are built the first time they're used.

- **Rig Lab › View** picks the view: **Auto** follows how far your body turns from the camera (the readout shows the turn angle), or lock **Front**, **¾**, **Side** or **Back**. **Face left** mirrors the drawn view, and **Invert turn direction** flips which way a turn maps.
- The side view shows only one arm and leg in the art, so the far ones are darker copies drawn behind the body, and the near sleeve is cut out by hand-drawn regions (`views.side.regions` in `redcap.json`) with the torso repainted behind it. Other characters can use the same `views`, `nearSide`, `regions` and `erase` options.
- **Test poses › Walk cycle** (**Walk in place**, **March**, with speed and stride sliders) drives a profile walk: opposite arm and leg swing, knees bend as the leg passes through, and the body bobs and leans into each step. It runs through the same primary springs as camera tracking, so it gets the same ease in and out.

## Rig Lab (prototyping panel)

A panel docked on the right of the laptop screen, beside the iPad, for testing deformation and motion. Open or close it with the **Rig Lab** button.

- **Deformation:**
  - **Skinning method:** *Rigid cutout* (each vertex follows one bone, for comparison), *Weighted* (two-bone blend at joints) or *Weighted + shape* (adds Delta Mush shape preservation after skinning, so joints keep their volume).
  - **Overlapping hidden artwork:** rebuilds the parts with or without artwork under the joints.
  - **Preserve rigid features:** pins the face, hands and shoes.
- **Motion:**
  - **Primary springs:** critically damped, for ease in and out with no overshoot, on a fixed 120 Hz step.
  - Motion feel presets, smoothing and follow-through.
  - **Secondary motion amount** (30% = as designed): cloth springs on the jacket hem (38% rigid), sleeve cuffs (50%) and trouser cuffs (35%), with cloth bounce.
- **Views:** skeleton, mesh wireframe and weights.
- **Test poses:** rest, 45° head tilts, arm lifts, arms up and down, elbows crossed and bent, deep squat, plus slow sweeps (head tilt, arm lift, squat). Tests drive the rig through its springs, just like tracking. **Make corrective for this pose** has the local AI repair the chopped joints and saves the result as a joint fix.
- **Test plan:** the six-step checklist, saved in this browser.
- **Copy test configuration:** copies all settings as text.

For renders from the command line: `?testpose=armsup|cross|squat|down|rest` freezes a pose, and `?skin=rigid|weighted|mush` picks the skinning method.

## Files

- `server.js`: local server and live reload
- `public/js/tracker.js`: camera tracking with MediaPipe pose and face models
- `public/js/rig.js`: bone angles, forward kinematics, character drawing, joint angles
- `public/js/puppet.js`: cuts the drawing into parts, mesh skinning, WebGL and canvas renderers
- `public/js/export.js`: layered SVG and PSD export and PSD import
- `public/js/editor.js`: joint editor
- `public/js/timeline.js`: Animation Assist frames, playback and export
- `public/js/aipack.js`: AI pack (OpenPose, line art, ZIP)
- `public/js/comfy.js`: Redraw with AI and gap fixing (inpainting) through the local ComfyUI
- `public/js/rigcheck.js`: guided rig check
- `public/js/correctives.js`: saved joint fixes, blended in live
- `scripts/start-comfyui.ps1`: starts ComfyUI for the app
- `public/js/filters.js`: One Euro jitter filter
- `public/js/motion.js`: primary spring dynamics (fixed 120 Hz step)
- `public/js/cloth.js`: secondary cloth springs
- `public/js/deform.js`: rigid cutout and Delta Mush skinning variants, feature pins
- `public/js/rigview.js`: mesh and weights views
- `public/js/lab.js`: Rig Lab panel, test bench and walk cycle
- `public/js/demo.js`: fake performer for testing
- `public/js/paint.js`: brush, smudge, eraser, undo
- `public/js/main.js`: Procreate UI wiring, the Rig tab, character parts, recording
- `public/js/joints.js`: colour-matched joint balls
- `public/js/ui.js`: tooltips and first-use hints
- `public/js/take.js`: takes: pose and motion capture, arrival sheet, Layers breakdown, jump marks, Rig mode, pose brush, part preview

## Build 5: canvas first

The layout was rebuilt around the canvas. Nothing was removed; controls moved.

- **Camera** is the icon at the top left of the bar. It opens the capture bar (Pose / Motion, shutter). **?** next to it shows every tip again.
- **A capture lands straight in the filmstrip** along the bottom (no arrival sheet). A motion replays once, and a toast offers **Undo** (this replaces Retake).
- **Filmstrip**: blue outline = the frame you are editing. Drag a drawing sideways to reorder, **x** removes it, **−/+** picks fewer or more drawings, a **tear** marks a jump (tap it to add an in-between, tick to leave it).
- **Tap a limb** and a small pill appears next to it: **Turn / Stretch** and **Animate (this frame) / Rig (every frame)**. On the canvas, drag the **circle** to turn and the **diamond** to stretch. T, S, A and R still work.
- The status pill says what a change reaches, with **Apply to all frames** (moves this frame's change into Rig) and **Reset**.
- Slim **Feel strip** on the right: three tiles that animate the feel (grey = what the camera caught, black = the result), Clean-up, **Path** (dots close = slow) and **Original** (hold to see the capture).
- **Parts** opens the full part tree (settings pass down from the part above).
- Small tips appear by themselves, up to three at a time, once each. The preview window was replaced by Original.


## Build 6: a hand-built character, a timeline, a bigger camera

- **Doodle (optional character, Rig Lab > Character).** The default is still the original raw red-beanie artwork. The red-beanie character rebuilt in code as separate vector parts (jacket, sleeves, hands, jeans, cuffs, shoes, head with beanie, hair, glasses, moustache and goatee) in the original colours. Limbs are drawn along the bones with round joints, so nothing tears when an arm swings out or a knee lifts. The older picture-based characters are still in Rig Lab > Character.
- **Body turn.** `rig.face.turn` (0 front, ±1 side, ±2 back) comes from the shoulder and hip depth. It is stored in every captured frame, blended between frames and counts as movement when picking drawings, so a side or back view is part of the take. The jacket narrows, the far arm hides behind the body, shoes point the way you face, and the head shows its profile or the back of the hat and hair.
- **Demo performer** now turns slowly to both sides, so the turn can be tested without a camera.
- **Timeline.** A thin line under the filmstrip: one segment per drawing (as long as it lasts), a playhead, and "Drawing 4 of 12 · 2.4 / 7.2 s". Tap the line to jump to a drawing.
- **Icons on the pill** match the handles on the skeleton: a circle for Turn, a diamond for Stretch, bones for Rig, a single frame for Animate.
- **No keyboard shortcuts** (the T, S, A, R keys and the key hints in tooltips are gone; Procreate has none).
- **Camera window** can be resized by dragging its corner, and has a **full-body view** button that makes it taller (3:4). The preview is cropped to fit; the tracker still sees the whole camera frame.

## Build 7 (final): Mode and Action
- The command pill has two levels. **Mode** is a sliding switch, Animate (this drawing only) or Rig (every drawing). **Action** is Turn or Stretch, the same circle and diamond you drag on the skeleton.
- One colour only, Procreate blue. Rig is told apart by shape: dashed bones, a hollow status dot and a ring round the pill.
- The + and − drawing buttons are centred icons. The timeline lines up with the filmstrip, and the Feel strip and status pill clear the filmstrip.

## Build 8: fitted to the iPad
- Every control has a 44-pt tap area (Apple's default). The pictures stay small, like Procreate's, and only the invisible tap area grows. Nothing is under 28 pt.
- Text is 11 pt or more. White text sits on the darker blue (4.8:1).
- The status line and Apply / Reset moved into the filmstrip's top row, so nothing floats over the canvas. The Feel strip is only as tall as its content. The Parts list opens above its button and hides the pill while it is open.
- Two-finger tap undoes, three-finger tap redoes (like Procreate). ◀ ▶ move a drawing earlier or later. Tips stay until you tap, messages last at least 2.5 s, and Reduce Motion is respected.
- A 20-pt gap under the filmstrip keeps controls clear of the home bar.

## Build 9.1: Rig skeleton is amber (buttons stay blue)
- Only the skeleton on the canvas turns amber in Rig mode. Every button, switch and label stays Procreate blue.

## Build 9: audit fixes
- Every panel and control was checked by script for overlaps, off-centre icons, row alignment and overflow, in dark and light, at two window sizes, with the Parts list open and in Rig mode.
- Messages sit above the filmstrip instead of on it. The timeline starts exactly where the first drawing starts. The ✕ badge is no longer clipped. The filmstrip fades at its right edge instead of cutting a drawing in half.
- The recording bar's stop button is centred and its text stays on one line.
- The mock Procreate undo/redo arrows are centred.
- The page title and the Rig Lab header say **Build 9**. If the server finds port 5173 busy (an older copy still running), it says so and moves to the next free port.
- Run from a fresh folder, and close any older copy first.

## Build 9.2
- Camera button now uses the Gomma pinwheel mark (white; amber while Rig mode is on). No other changes.

## Build 10
- Opens straight on the iPad: no device frame, no Rig Lab tab. A "Get app" button (top right) installs it on the iPad home screen.
- Vercel: `vercel.json` runs `scripts/build.js`, which gathers the app, models and MediaPipe files into `dist/`.

## Build 11: start from your own character, with a 15-second welcome
- **Welcome tour.** On first launch the normal canvas opens, then a short tour (about 11 seconds, tap or Skip to move on) shows the flow with the app's own screens: bring a character, we scan it and add the skeleton, then move and it moves with you. It ends with the choice below. **Actions › Help › Replay the 15-second intro** shows it again.
- **New character** (person-plus button, top bar; also **Actions › Rig › Character**):
  - **Upload a drawing**: PNG, JPG, SVG or PSD. A plain PSD (for example a Procreate export) is flattened and rigged; a PSD with layers named Head, Torso, Upper arm R/L and so on keeps its parts. `.procreate` files can't be opened directly; use Share › PNG or PSD in Procreate.
  - **Sketch your own**: Layer 1 becomes a blank page with a faint pose guide. Draw with the normal brush, tap **Done: build my rig**. The sketch becomes the character and Layer 1 is blank again.
  - **Try the red beanie**: the sample character.
- **Scan and skeleton.** After a drawing arrives, a scan line sweeps down it, then the skeleton grows in joint by joint (from the pose model, or a template if no body is found). Drag any dot that is off, then **Build character**. The capture bar opens so the next step is to capture.

Code: `public/js/onboarding.js` (tour and chooser), `public/js/editor.js` (scan and skeleton), `public/js/main.js` (upload, SVG and PSD handling, sketch mode). Tour pictures are in `public/onboarding/`.

## Damage check: green, yellow, red
**Timeline › Settings › Show gap areas** now rates every joint for the current pose: green (the cut parts still cover each other), yellow (a small break may show), red (a real break). AI repair (**Export › Fix gaps with AI**) fades in with the severity, so a repair no longer pops on in one frame when a joint crosses the line. **Repair mild gaps too** (on by default) can be switched off to repair red joints only. Code: `hingeLevels` in `public/js/comfy.js`.

## Optional AI joint fix (scan, then fix)
The AI step is never automatic. The rig check no longer opens by itself when the camera first starts (it is still under **Actions › Rig › Run rig check**). To use the AI, open a take and tap **Fix joints** next to Parts.
- **Scan:** each drawing in the take is shown in turn while a light band sweeps down it and marks every joint green, yellow or red.
- **Fix:** the fewest drawings that cover all the red and yellow breaks are sent to ComfyUI, one at a time. A turning ring and drifting dots mark each break being worked on, and a green tick shows it mended. **Stop** keeps the repairs already made.
- The repairs are saved as joint fixes and blend in as the take plays (**Use AI joint fixes** switches them off). If ComfyUI isn't running, the card says so and nothing else happens.
Code: `public/js/aifix.js`.

## Joint dust (optional)
**Actions › Rig › Character › Joint dust** (off by default). When a joint bends far enough to open a break, a dense cloud of very small dots in the colours used around that joint fills it, then fades as the joint straightens. **Density** sets how packed the cloud is; **Dot size** keeps the dots tiny by default. It works best on flat or textured art. Code: `public/js/dust.js` (reads each joint's colours from `joints.js`).

## Build 12: the Procreate workflow
The Procreate-style canvas now works the way the real one does. The Motion Rig is one layer in the stack and nothing about it changed.

- **Gallery** (top left): every artwork as a card with its thumbnail, size and layer count. **New canvas** (+) offers Screen size, Square, A4, A5, 4K, Full HD, Story, Comic or a custom size, DPI, colour profile and background (or transparent). **Select** gives Stack, Preview, Rename, Share, Duplicate and Delete. **Import** takes PNG, JPG, SVG, PSD (layers kept) and `.promove` files; **Photo** starts an artwork from a picture. Artworks are saved in this browser as you work, and the last one reopens.
- **Layers**: add, group, rename, duplicate, delete, show and hide, drag to reorder, swipe left for Lock / Duplicate / Delete, tap a layer's "N" for the menu (Select, Copy, Fill, Clear, Alpha Lock, Mask, Invert, Group, Merge Down, Flatten, opacity and 17 blend modes). The **Motion Rig** row can be moved above or below drawing layers.
- **Brushes**: a Brush Library with 7 sets and 22 brushes, search, and **Brush Studio** (size, opacity, hardness, spacing, flow, grain, scatter, tip shape and angle, pressure, stabilisation) with live preview. Duplicate to make your own. Tap the tool you are using to open its brushes; brush, smudge and eraser each remember their brush, and each brush remembers its size and opacity.
- **Colours**: Disc, Classic, Harmony, Value (HSB, RGB, hex) and Palettes, with a history of recent colours and a secondary colour to swap with.
- **Selection**: Automatic, Freehand, Rectangle, Ellipse; Add and Remove; Invert, Select all, Feather, Copy & Paste, Colour Fill, Clear. Painting, adjustments and transforms stay inside it.
- **Transform** (for the layer you are on, or what is selected): Uniform, Freeform, Distort, Warp, snapping, flip, rotate 45°, fit to canvas. With the Motion Rig layer selected, Transform still moves the character.
- **Adjustments**: Hue / Saturation / Brightness, Curves, Gaussian and Motion Blur, Sharpen, Noise, Bloom and Liquify (Push, Twirl, Pinch, Expand, Reconstruct).
- **Actions**: Add (file, photo, text, cut, copy, paste), Canvas (crop and resize, drawing guide with grid, isometric and symmetry, flip, canvas information, clear), Share (PNG, JPEG, PDF, layered PSD, `.promove`), Video (time-lapse replay and `.webm` export), Prefs (pressure curve, stabilisation, gesture controls, dynamic brush scaling).
- **Animation Assist** (Actions › Canvas): every drawing layer is a frame, with Add, Duplicate, Delete, Hold, frame rate, loop / ping-pong / one shot, blue and red onion skins, and Play. (The older Rig pose frames timeline is still there as "Rig pose frames".)
- **Gestures**: pinch to zoom and pan (Ctrl + wheel on a laptop), two-finger tap undo, three-finger tap redo, four-finger tap hides the interface, touch and hold picks a colour.

Code: `studio.js` (layers, history, saving), `paint.js` + `brushes.js` (brush engine), `layersui.js`, `brushui.js`, `colourui.js`, `gallery.js`, `select.js`, `layerxform.js`, `adjust.js`, `anim.js`, `actionsui.js`, `gestures.js`, `exporters.js`, `store.js`.

## Character physics (Actions › Rig › Physics)
Five sliders and four presets (Natural, Cartoon, Soft body, Rigid) drive the motion engine, with a graph of how the body and the forearm settle and **Copy physics configuration**. The engine behind them:
- **Springs at a fixed 120 Hz** for the skeleton (critically damped, so no wobble), with **follow-through that can swing past and settle** (an underdamped spring on forearms, shins and the head) when Follow-through is above 50%. Each region has its own speed: the head trails more than the forearms.
- **XPBD cloth** (`cloth.js`): the jacket hem and cuffs are held to the skinned shape by soft constraints and to their neighbours by distance constraints, so loose cloth swings as one piece and does not stretch.
- **Shape preservation**: the Delta Mush skinning (a real-time cousin of as-rigid-as-possible deformation) now has an amount, and a foreshortened limb gets a little fatter (**volume**), so arms do not thin out or collapse.
- **Squash & stretch**: the live body stretches when it moves fast up or down and squashes on landing, with its area kept (wider when shorter).
- **Ground contact**: feet cannot sink below the floor, and a planted foot stays put instead of sliding.
- **Joint limits**: elbows, knees and the head fold only so far, easing into the limit.
- **Confidence-weighted smoothing**: a joint the tracker is unsure of is smoothed harder.
Physics changes what is drawn live. Recorded takes, thumbnails and exports keep the rig's own pose. Not built: self-collision between limbs and body, hair, and learned texture repair in the live loop.
