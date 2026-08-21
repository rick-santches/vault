# Site Speed Monitor — MVP

Watches a video stream, detects and tracks vehicles, and estimates their
real-world speed from a **calibrated ground-plane homography** — one ordinary
camera, no radar and no stereo rig.

```
YOLOv8n detect ──▶ ByteTrack IDs ──▶ bottom-centre pixel of each box
                                        │
                          homography (4 measured points)
                                        ▼
                            (x, y) in metres on the ground
                                        │
                            Δdistance / Δtime over 5 frames
                                        ▼
                                     km/h  ──▶ over the limit? alert
```

## Install

```bash
cd tools/site-speed-monitor
pip install -r requirements.txt
```

`ultralytics` pulls in torch (~2 GB). On a Raspberry Pi, install the ARM torch
wheel first, then `pip install ultralytics --no-deps`. The `yolov8n.pt` weights
download themselves on first run.

## Calibrate first — this is the whole accuracy story

The homography is what turns pixels into metres. Get it wrong and every number
the tool prints is wrong, confidently.

1. Mark a quadrilateral on the ground in the camera's view — corners of a
   rectangle taped or painted on the yard works well. Bigger is better;
   it should cover the stretch of ground you actually want to measure.
2. Tape-measure the corners and write them down in metres. The origin can be
   anywhere; only the relative distances matter.
3. Grab one still frame from the camera and read off each corner's pixel
   coordinate (any image viewer showing cursor position will do).
4. Put both into a JSON file — see `calibration.example.json`. **The two lists
   must be in the same corner order.**

```bash
python speed_monitor.py --source yard.mp4 --calibration calib.json
```

Without `--calibration`, the placeholder arrays at the top of
`speed_monitor.py` are used — they are an example, not your site.

**Sanity check before trusting it:** walk the marked patch at a steady pace
(~5 km/h) and confirm the overlay agrees. Then drive it at a known speedometer
reading.

## Run

```bash
python speed_monitor.py --source 0                          # webcam
python speed_monitor.py --source yard.mp4                   # video file
python speed_monitor.py --source rtsp://cam.local/stream    # IP camera
python speed_monitor.py --source yard.mp4 --no-display      # headless server
python speed_monitor.py --source 0 --limit 10               # 10 km/h limit
```

Press `q` to quit the preview window. Violations print to stdout:

```
[VIOLATION] Track 12 at 23.4 km/h (limit 15) -- 14:02:51
```

## Tests

The calibration and speed maths run without torch or model weights —
`ultralytics` is imported inside `main()` precisely so this stays cheap:

```bash
cd tools/site-speed-monitor
python3 -m unittest discover -v
```

The suite drives synthetic vehicles across a known patch at known speeds and
asserts the estimator recovers them exactly.

## Accuracy caveats — read before anyone gets a ticket

- **Speed is only as good as the calibration.** A 10% error in your measured
  rectangle is a 10% error in every reading.
- **Only the marked ground plane is valid.** A vehicle outside the calibrated
  quadrilateral is extrapolated, and perspective error grows fast past the
  edges. Readings far from the patch should be discarded, not trusted.
- **The bottom-centre of the box is assumed to touch the ground.** Occlusion
  (a vehicle behind a container), a bouncing box, or a tall truck whose box
  bottom is a bumper rather than a tyre all shift that point and therefore the
  speed.
- **Estimation window is 5 frames** (~0.17 s at 30 fps), so readings are
  responsive but jittery. Widen `maxlen` in `track_history` to smooth at the
  cost of lag.
- **Track ID swaps** between two vehicles that cross produce one nonsense
  reading each. ByteTrack is decent, not perfect.
- This is an MVP for **site safety awareness** — spotting that the yard has a
  speeding problem. It is not a calibrated legal metering device, and nobody
  should be penalised on its say-so without a human reviewing the footage.

## Not done yet

- `TODO` in the code: persist violations (Prisma) and notify the site manager
  (Resend / webhook). Right now they only print.
- No clip retention — a violation should save the frames around it, or the
  alert is unreviewable.
- Direction filtering (ignore vehicles leaving the site), per-zone limits, and
  day/night thresholds are all unimplemented.
- No `.pt` weight pinning; `yolov8n.pt` is fetched at runtime.
