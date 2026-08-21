"""
Site Speed Monitor -- MVP
Detects vehicles in a video stream, tracks them frame-to-frame, and estimates
real-world speed using a calibrated ground-plane homography.

Requires:
    pip install -r requirements.txt

Usage:
    python speed_monitor.py --source 0                     # webcam
    python speed_monitor.py --source video.mp4             # video file
    python speed_monitor.py --source rtsp://<ip-camera-url> # IP camera stream
    python speed_monitor.py --source video.mp4 --no-display # headless / server
"""

import argparse
import json
import time
from collections import defaultdict, deque

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# STEP 1: CALIBRATION
# ---------------------------------------------------------------------------
# Before running for real: mark 4 known points on the ground in the camera's
# view (e.g. corners of a rectangle taped/painted on the lot, measured with a
# tape measure), note their pixel coordinates in a still frame, and set the
# two arrays below (or pass --calibration calib.json to override them without
# editing code). This lets us convert pixel movement into real-world speed
# regardless of camera angle or distance -- no stereo camera or radar needed.
#
# Example calibration: a 10m x 6m rectangle marked on the ground.

SRC_PIXELS = np.float32([
    [120, 480],   # bottom-left corner, in pixels
    [1150, 480],  # bottom-right corner
    [980, 260],   # top-right corner
    [300, 260],   # top-left corner
])

DST_METERS = np.float32([
    [0, 0],
    [10, 0],
    [10, 6],
    [0, 6],
])


def _make_homography(src_pixels, dst_meters):
    """Solve pixel -> ground-plane metres, failing loudly on bad calibration."""
    src = np.asarray(src_pixels, dtype=np.float32).reshape(-1, 2)
    dst = np.asarray(dst_meters, dtype=np.float32).reshape(-1, 2)
    if len(src) != 4 or len(dst) != 4:
        raise ValueError("Calibration needs exactly 4 pixel points and 4 metre points.")

    homography, _ = cv2.findHomography(src, dst)
    if homography is None:
        raise ValueError(
            "Calibration failed: the 4 points are degenerate (collinear or "
            "duplicated). Pick 4 corners that form a real quadrilateral."
        )
    return homography


HOMOGRAPHY = _make_homography(SRC_PIXELS, DST_METERS)


def load_calibration(path):
    """Replace the built-in calibration with one from a JSON file.

    {"src_pixels": [[x, y] x4], "dst_meters": [[x, y] x4]}
    Both lists must be in the SAME corner order.
    """
    global SRC_PIXELS, DST_METERS, HOMOGRAPHY

    with open(path) as fh:
        data = json.load(fh)
    try:
        src, dst = data["src_pixels"], data["dst_meters"]
    except KeyError as exc:
        raise ValueError(f"{path}: missing key {exc}") from exc

    homography = _make_homography(src, dst)  # validate before mutating globals
    SRC_PIXELS = np.float32(src)
    DST_METERS = np.float32(dst)
    HOMOGRAPHY = homography
    return HOMOGRAPHY


def pixel_to_ground(point):
    """Convert an (x, y) pixel coordinate to real-world (x, y) meters."""
    px = np.array([[point]], dtype=np.float32)
    world = cv2.perspectiveTransform(px, HOMOGRAPHY)
    return world[0][0]


# ---------------------------------------------------------------------------
# STEP 2: SPEED ESTIMATION FROM TRACKED POSITIONS
# ---------------------------------------------------------------------------

SPEED_LIMIT_KMH = 15  # set per site, e.g. harbor yard limit; override with --limit
ALERT_COOLDOWN_S = 10  # don't re-alert on the same vehicle every frame
TRACK_TIMEOUT_S = 30  # forget a track this long after it was last seen

track_history = defaultdict(lambda: deque(maxlen=5))  # last 5 (time, ground_xy)
_last_seen = {}  # track_id -> timestamp of its most recent detection
_last_alert = {}  # track_id -> timestamp of its most recent violation alert


def update_speed(track_id, pixel_center, timestamp):
    ground_xy = pixel_to_ground(pixel_center)
    history = track_history[track_id]
    history.append((timestamp, ground_xy))
    _last_seen[track_id] = timestamp

    if len(history) < 2:
        return None

    (t0, p0), (t1, p1) = history[0], history[-1]
    dt = t1 - t0
    if dt <= 0:
        return None

    dist_m = np.linalg.norm(np.array(p1) - np.array(p0))
    speed_kmh = (dist_m / dt) * 3.6
    return speed_kmh


def should_alert(track_id, timestamp, cooldown=ALERT_COOLDOWN_S):
    """True at most once per `cooldown` seconds for a given vehicle.

    Without this a single speeding vehicle prints (and would page the site
    manager) on every frame it is visible.
    """
    last = _last_alert.get(track_id)
    if last is not None and timestamp - last < cooldown:
        return False
    _last_alert[track_id] = timestamp
    return True


def prune_tracks(now, timeout=TRACK_TIMEOUT_S):
    """Drop vehicles that have left the frame, so memory stays flat on a
    camera that runs for weeks."""
    stale = [tid for tid, seen in _last_seen.items() if now - seen > timeout]
    for tid in stale:
        track_history.pop(tid, None)
        _last_seen.pop(tid, None)
        _last_alert.pop(tid, None)
    return len(stale)


# ---------------------------------------------------------------------------
# STEP 3: DETECTION + TRACKING LOOP
# ---------------------------------------------------------------------------

def is_live_source(source):
    """Webcams and network streams arrive in real time; files do not."""
    if isinstance(source, int):
        return True
    return str(source).lower().startswith(("rtsp://", "rtmp://", "http://", "https://"))


def make_clock(source):
    """Return frame_index -> timestamp in seconds.

    For a live camera, wall-clock time is the truth. For a file, it is NOT:
    the loop runs as fast (or as slow) as inference allows, so wall-clock
    timing would report speeds scaled by however fast we happened to decode.
    Use the video's own frame rate instead.
    """
    if is_live_source(source):
        return lambda frame_idx: time.time()

    cap = cv2.VideoCapture(source)
    fps = cap.get(cv2.CAP_PROP_FPS) if cap.isOpened() else 0
    cap.release()

    if not fps or not np.isfinite(fps) or fps <= 0:
        print(f"[WARN] Could not read a frame rate from {source}; assuming 30 fps. "
              f"Speeds will be wrong if the real rate differs.")
        fps = 30.0
    return lambda frame_idx: frame_idx / fps


def main(source, speed_limit=SPEED_LIMIT_KMH, calibration=None, display=True):
    from ultralytics import YOLO  # imported here so calibration/speed math is
                                  # usable (and testable) without torch installed

    if calibration:
        load_calibration(calibration)
        print(f"[INFO] Calibration loaded from {calibration}")

    clock = make_clock(source)
    model = YOLO("yolov8n.pt")  # nano model -- fast enough for a Raspberry Pi
    vehicle_classes = [2, 3, 5, 7]  # COCO: car, motorcycle, bus, truck

    for frame_idx, result in enumerate(
        model.track(source=source, stream=True, persist=True, classes=vehicle_classes)
    ):
        frame = result.orig_img
        timestamp = clock(frame_idx)

        boxes = result.boxes
        if boxes is not None and boxes.id is not None:
            for box, track_id in zip(boxes.xyxy.cpu(), boxes.id.int().cpu().tolist()):
                x1, y1, x2, y2 = box.tolist()
                center = ((x1 + x2) / 2, y2)  # bottom-center = point touching ground

                speed = update_speed(track_id, center, timestamp)

                color = (0, 255, 0)
                label = f"ID {track_id}"
                if speed is not None:
                    label += f" {speed:.1f} km/h"
                    if speed > speed_limit and should_alert(track_id, timestamp):
                        color = (0, 0, 255)
                        print(f"[VIOLATION] Track {track_id} at {speed:.1f} km/h "
                              f"(limit {speed_limit}) -- {time.strftime('%H:%M:%S')}")
                        # TODO: log to DB (Prisma) + ping site manager (Resend/webhook) here
                    elif speed > speed_limit:
                        color = (0, 0, 255)  # still drawn red, alert just debounced

                cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
                cv2.putText(frame, label, (int(x1), int(y1) - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

        prune_tracks(timestamp)

        if display:
            try:
                cv2.imshow("Site Speed Monitor", frame)
            except cv2.error:
                # opencv-python-headless has no GUI support; keep processing.
                print("[WARN] No GUI available (headless OpenCV build) -- "
                      "continuing without a preview window. Use --no-display "
                      "to silence this.")
                display = False
                continue
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    if display:
        cv2.destroyAllWindows()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="0", help="0 for webcam, path to video, or RTSP URL")
    parser.add_argument("--limit", type=float, default=SPEED_LIMIT_KMH,
                        help=f"speed limit in km/h (default {SPEED_LIMIT_KMH})")
    parser.add_argument("--calibration", help="JSON file with src_pixels + dst_meters")
    parser.add_argument("--no-display", dest="display", action="store_false",
                        help="skip the preview window (servers / headless OpenCV)")
    args = parser.parse_args()
    src = int(args.source) if args.source.isdigit() else args.source
    main(src, speed_limit=args.limit, calibration=args.calibration, display=args.display)
