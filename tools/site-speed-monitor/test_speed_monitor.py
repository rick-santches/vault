"""Tests for the calibration + speed math. No model weights or GPU needed:
speed_monitor imports ultralytics only inside main().

    python3 -m unittest discover tools/site-speed-monitor
"""

import json
import os
import tempfile
import unittest

import numpy as np

import speed_monitor as sm


def straight_calibration():
    """A head-on 20m x 10m patch, 1 metre = 10 pixels, no perspective.
    Speeds computed under it should come out exact."""
    src = [[0, 200], [200, 200], [200, 0], [0, 0]]
    dst = [[0, 0], [20, 0], [20, 10], [0, 10]]
    return src, dst


class CalibrationTest(unittest.TestCase):
    def setUp(self):
        self._saved = sm.HOMOGRAPHY

    def tearDown(self):
        sm.HOMOGRAPHY = self._saved

    def test_corners_map_to_their_measured_metres(self):
        src, dst = straight_calibration()
        sm.HOMOGRAPHY = sm._make_homography(src, dst)
        for pixel, metres in zip(src, dst):
            np.testing.assert_allclose(sm.pixel_to_ground(pixel), metres, atol=1e-3)

    def test_midpoint_maps_to_centre_of_the_patch(self):
        src, dst = straight_calibration()
        sm.HOMOGRAPHY = sm._make_homography(src, dst)
        np.testing.assert_allclose(sm.pixel_to_ground((100, 100)), [10, 5], atol=1e-3)

    def test_degenerate_points_raise_instead_of_silently_returning_none(self):
        collinear = [[0, 0], [10, 0], [20, 0], [30, 0]]
        _, dst = straight_calibration()
        with self.assertRaises(ValueError):
            sm._make_homography(collinear, dst)

    def test_wrong_point_count_raises(self):
        with self.assertRaises(ValueError):
            sm._make_homography([[0, 0], [1, 0], [1, 1]], [[0, 0], [1, 0], [1, 1]])

    def test_load_calibration_from_json(self):
        src, dst = straight_calibration()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "calib.json")
            with open(path, "w") as fh:
                json.dump({"src_pixels": src, "dst_meters": dst}, fh)
            sm.load_calibration(path)
        np.testing.assert_allclose(sm.pixel_to_ground((100, 100)), [10, 5], atol=1e-3)

    def test_bad_calibration_file_leaves_the_current_one_intact(self):
        before = sm.HOMOGRAPHY.copy()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "calib.json")
            with open(path, "w") as fh:
                json.dump({"src_pixels": [[0, 0]] * 4, "dst_meters": [[0, 0]] * 4}, fh)
            with self.assertRaises(ValueError):
                sm.load_calibration(path)
        np.testing.assert_allclose(sm.HOMOGRAPHY, before)


class SpeedTest(unittest.TestCase):
    def setUp(self):
        self._saved = sm.HOMOGRAPHY
        src, dst = straight_calibration()
        sm.HOMOGRAPHY = sm._make_homography(src, dst)
        sm.track_history.clear()
        sm._last_seen.clear()
        sm._last_alert.clear()

    def tearDown(self):
        sm.HOMOGRAPHY = self._saved

    def drive(self, track_id, speed_kmh, fps=30, frames=10):
        """Move a vehicle along +x at a known speed; return the last estimate."""
        speed_ms = speed_kmh / 3.6
        speed = None
        for frame in range(frames):
            t = frame / fps
            x_m = speed_ms * t
            speed = sm.update_speed(track_id, (x_m * 10, 100), t)  # 10 px per metre
        return speed

    def test_first_sighting_has_no_speed_yet(self):
        self.assertIsNone(sm.update_speed(1, (0, 100), 0.0))

    def test_recovers_a_known_speed(self):
        self.assertAlmostEqual(self.drive(1, 12.0), 12.0, places=3)

    def test_recovers_a_second_known_speed(self):
        self.assertAlmostEqual(self.drive(2, 27.5), 27.5, places=3)

    def test_stationary_vehicle_reads_zero(self):
        for frame in range(5):
            speed = sm.update_speed(3, (500, 100), frame / 30)
        self.assertAlmostEqual(speed, 0.0, places=6)

    def test_repeated_timestamp_is_rejected_not_divided_by_zero(self):
        sm.update_speed(4, (0, 100), 5.0)
        self.assertIsNone(sm.update_speed(4, (50, 100), 5.0))

    def test_tracks_are_independent(self):
        self.drive(5, 10.0)
        self.assertAlmostEqual(self.drive(6, 40.0), 40.0, places=3)


class AlertAndPruneTest(unittest.TestCase):
    def setUp(self):
        sm.track_history.clear()
        sm._last_seen.clear()
        sm._last_alert.clear()

    def test_alert_fires_once_then_is_debounced(self):
        self.assertTrue(sm.should_alert(1, 100.0, cooldown=10))
        self.assertFalse(sm.should_alert(1, 105.0, cooldown=10))
        self.assertFalse(sm.should_alert(1, 109.9, cooldown=10))

    def test_alert_fires_again_after_the_cooldown(self):
        sm.should_alert(1, 100.0, cooldown=10)
        self.assertTrue(sm.should_alert(1, 111.0, cooldown=10))

    def test_debounce_is_per_vehicle(self):
        sm.should_alert(1, 100.0, cooldown=10)
        self.assertTrue(sm.should_alert(2, 100.0, cooldown=10))

    def test_stale_tracks_are_forgotten(self):
        sm.update_speed(1, (500, 400), 0.0)
        sm.update_speed(2, (500, 400), 100.0)
        self.assertEqual(sm.prune_tracks(100.0, timeout=30), 1)
        self.assertNotIn(1, sm.track_history)
        self.assertIn(2, sm.track_history)

    def test_pruning_keeps_memory_flat_across_many_vehicles(self):
        for tid in range(500):
            sm.update_speed(tid, (500, 400), float(tid))
            sm.prune_tracks(float(tid), timeout=30)
        self.assertLessEqual(len(sm.track_history), 31)


class ClockTest(unittest.TestCase):
    def test_live_sources_are_recognised(self):
        self.assertTrue(sm.is_live_source(0))
        self.assertTrue(sm.is_live_source("rtsp://cam.local/stream"))
        self.assertTrue(sm.is_live_source("http://cam.local/mjpeg"))

    def test_files_are_not_live(self):
        self.assertFalse(sm.is_live_source("yard.mp4"))
        self.assertFalse(sm.is_live_source("/data/clips/yard.mov"))

    def test_file_clock_follows_the_video_not_the_wall_clock(self):
        # A missing file falls back to 30 fps, which is all this asserts:
        # frame 60 is two seconds into the video however long decoding took.
        clock = sm.make_clock("does-not-exist.mp4")
        self.assertAlmostEqual(clock(60), 2.0)
        self.assertAlmostEqual(clock(0), 0.0)


if __name__ == "__main__":
    unittest.main()
