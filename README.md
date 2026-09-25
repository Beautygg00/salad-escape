# 🥬 Salad Escape

A small 3D browser game: you're a salad in Maria's flat. She's vegan, she's cooking a *minestrone di verdure*, and you're the missing vegetable.

**▶ Play:** https://beautygg00.github.io/salad-escape/

## How to escape
1. Find **3 chopsticks** on the floor. They build a ramp up to the sofa.
2. Grab **3 basil leaves** on the sofa to unlock **Super Leap**.
3. Jump onto the sofa back, get to the window sill, **hold E** to open the window, and jump out.

Hide in boxes, the laundry basket, under the blanket or behind the monstera. If Maria sees you go in, she'll check. Under the table she has to kneel first, so run.

**Controls:** WASD / arrows to move · mouse to look (click to lock) · Space to jump · Shift to sprint · E to interact · Esc to pause. Touch controls on phones.

## Tech
- The room was rebuilt in **Blender** from photos of a real flat and exported to glTF (`assets/`).
- The game uses **three.js** (loaded from a CDN, no build step).
- The music and sound effects are synthesised live with the Web Audio API. The music tempo follows Maria's alert level.

## Run locally
```bash
python3 serve.py
# open http://localhost:8123
```
