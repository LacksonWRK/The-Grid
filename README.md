# THE GRID

A neon take on classic Dots and Boxes, for 2–4 players (any seat can be a CPU). It's built for iPad and Apple Pencil.

**Play:** https://lacksonwrk.github.io/The-Grid/. Open it in Safari, then tap Share → Add to Home Screen.

## Rules

- On your turn, draw one line between two neighboring dots. Lines are straight only, never diagonal.
- Close the 4th side of a square and it fills with your color. Walls count as sides.
- The turn always passes to the next player, even after a capture.
- **Classic scoring:** 1 point per square.
- **Combo scoring:** touching squares of your color form a group worth N × N.
- The game ends when every line is drawn, and the highest score wins.

## Themes

Settings (the cog in a game, or Settings on the title screen) picks the look: **Neon**, **Pencil & Paper** (graph paper, pencil dots, marker lines) or **Toy Box** (studs, bricks and plates). Quit to menu keeps the game, so Resume game picks it back up.

## Editing

`index.html` is generated, so don't edit it directly. Edit the files in `src/`, then run `python3 build.py` to rebuild it. Tests live in `tests/`: `sim.py` runs full-game simulations, `input.py` checks touch and Pencil input, and `ai_strength.js` compares CPU difficulties.
