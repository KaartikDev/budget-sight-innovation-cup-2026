# Game of Life regression suite

Run from the repository root:

```sh
python3 demo-output/jordan/game-of-life-tests/test_game_of_life.py
```

The suite exercises block and beehive still lifes, blinker and toad oscillators,
finite-grid edge behavior, and invalid command-line input. It imports the
existing `game_of_life.py` without modifying it.

## Results

Final run: **9 tests passed** against the existing implementation. No
implementation failures were observed. During test authoring, the toad's
expected first phase was initially recorded incorrectly; correcting that test
fixture made the oscillator checks pass. This was a test expectation issue,
not a change to the implementation.
