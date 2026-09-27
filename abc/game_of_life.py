"""A small terminal simulation of Conway's Game of Life.

Run: python3 game_of_life.py
Try: python3 game_of_life.py --pattern random --seed 42 --steps 30
"""

import argparse
import random
import time


def next_generation(live, width, height):
    """Apply the Game of Life rules to a finite grid."""
    next_live = set()
    for y in range(height):
        for x in range(width):
            neighbors = sum(
                (x + dx, y + dy) in live
                for dy in (-1, 0, 1)
                for dx in (-1, 0, 1)
                if (dx, dy) != (0, 0)
            )
            if neighbors == 3 or (neighbors == 2 and (x, y) in live):
                next_live.add((x, y))
    return next_live


def starting_cells(pattern, width, height, seed):
    if pattern == "random":
        rng = random.Random(seed)
        return {
            (x, y)
            for y in range(height)
            for x in range(width)
            if rng.random() < 0.25
        }

    # Glider: moves diagonally, returning to its original shape every 4 steps.
    glider = {(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)}
    offset_x, offset_y = width // 4, height // 4
    return {(x + offset_x, y + offset_y) for x, y in glider}


def render(live, width, height, generation):
    board_width = width * 2
    rows = ["CONWAY'S GAME OF LIFE".center(board_width)]
    rows.append(f"Generation {generation:>3}  •  Live cells {len(live):>3}".center(board_width))
    rows.append("┌" + "─" * board_width + "┐")
    for y in range(height):
        rows.append("│" + "".join("██" if (x, y) in live else "  " for x in range(width)) + "│")
    rows.append("└" + "─" * board_width + "┘")
    return "\n".join(rows)


def main():
    parser = argparse.ArgumentParser(description="Run Conway's Game of Life in the terminal.")
    parser.add_argument("--width", type=int, default=30)
    parser.add_argument("--height", type=int, default=15)
    parser.add_argument("--steps", type=int, default=20, help="Number of generations to advance")
    parser.add_argument("--delay", type=float, default=0.15, help="Seconds between frames")
    parser.add_argument("--pattern", choices=("glider", "random"), default="glider")
    parser.add_argument("--seed", type=int, default=42, help="Seed for the random pattern")
    parser.add_argument("--no-clear", action="store_true", help="Print every generation instead of redrawing")
    args = parser.parse_args()

    if args.width < 5 or args.height < 5 or args.steps < 0 or args.delay < 0:
        parser.error("width and height must be at least 5; steps and delay cannot be negative")

    live = starting_cells(args.pattern, args.width, args.height, args.seed)
    for generation in range(args.steps + 1):
        if not args.no_clear:
            print("\033[2J\033[H", end="")
        elif generation:
            print()
        print(render(live, args.width, args.height, generation), flush=True)
        if generation < args.steps:
            time.sleep(args.delay)
            live = next_generation(live, args.width, args.height)


if __name__ == "__main__":
    main()
