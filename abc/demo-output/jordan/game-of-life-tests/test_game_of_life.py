"""Focused regression tests for the repository's Game of Life implementation."""

import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest


SOURCE = Path(__file__).resolve().parents[3] / "game_of_life.py"
SPEC = importlib.util.spec_from_file_location("game_of_life", SOURCE)
life = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(life)


class StillLifeTests(unittest.TestCase):
    def test_block_is_stable(self):
        block = {(1, 1), (2, 1), (1, 2), (2, 2)}
        self.assertEqual(life.next_generation(block, 5, 5), block)

    def test_beehive_is_stable(self):
        beehive = {(2, 1), (3, 1), (1, 2), (4, 2), (2, 3), (3, 3)}
        self.assertEqual(life.next_generation(beehive, 6, 5), beehive)


class OscillatorTests(unittest.TestCase):
    def test_blinker_flips_and_returns_after_two_generations(self):
        horizontal = {(1, 2), (2, 2), (3, 2)}
        vertical = {(2, 1), (2, 2), (2, 3)}
        self.assertEqual(life.next_generation(horizontal, 5, 5), vertical)
        self.assertEqual(life.next_generation(vertical, 5, 5), horizontal)

    def test_toad_has_period_two(self):
        phase_a = {(2, 1), (3, 1), (4, 1), (1, 2), (2, 2), (3, 2)}
        phase_b = {(3, 0), (1, 1), (4, 1), (1, 2), (4, 2), (2, 3)}
        self.assertEqual(life.next_generation(phase_a, 7, 5), phase_b)
        self.assertEqual(life.next_generation(phase_b, 7, 5), phase_a)


class EdgeHandlingTests(unittest.TestCase):
    def test_corner_cells_do_not_wrap_across_edges(self):
        corner_pair = {(0, 0), (4, 4)}
        self.assertEqual(life.next_generation(corner_pair, 5, 5), set())

    def test_birth_does_not_wrap_from_opposite_edges(self):
        live = {(0, 1), (0, 2), (4, 1)}
        self.assertNotIn((4, 2), life.next_generation(live, 5, 5))


class InvalidInputTests(unittest.TestCase):
    def assert_cli_rejects(self, *args):
        result = subprocess.run(
            [sys.executable, str(SOURCE), *args], capture_output=True, text=True
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("error:", result.stderr)

    def test_rejects_dimensions_below_minimum(self):
        self.assert_cli_rejects("--width", "4", "--no-clear")
        self.assert_cli_rejects("--height", "4", "--no-clear")

    def test_rejects_negative_steps_and_delay(self):
        self.assert_cli_rejects("--steps", "-1", "--no-clear")
        self.assert_cli_rejects("--delay", "-0.1", "--no-clear")

    def test_rejects_unknown_pattern(self):
        self.assert_cli_rejects("--pattern", "spaceship", "--no-clear")


if __name__ == "__main__":
    unittest.main(verbosity=2)
