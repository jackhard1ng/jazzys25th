Drop player headshots in this folder. They will be served at
/jazzys25th/headshots/<name>.png in production.

Naming convention (case-insensitive, spaces become hyphens):
  Jack         → jack.png
  Isabel       → isabel.png
  Keegan       → keegan.png
  Hallie       → hallie.png
  Isabelle     → isabelle.png
  ...

Supported extensions (tried in this order): .png, .jpg, .jpeg

The PlayerPortrait component falls back through:
  1. Photo uploaded by the player from their phone (base64)
  2. /headshots/<name>.png
  3. /headshots/<name>.jpg
  4. /headshots/<name>.jpeg
  5. First-letter silhouette circle

Square images crop best (the portraits are rendered as circles in the
voting / murder / endgame UIs and as the rectangular shield-frame on
the Portrait Wall).

Recommended: 300x300 or 400x400 JPEG/PNG, < 100KB each.
