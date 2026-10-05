CREATE TABLE villages
(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  tile_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  -- Village whose settlers founded (or whose administrators conquered) this village. Uses one of its expansion slots.
  parent_village_id INTEGER DEFAULT NULL,

  UNIQUE (tile_id),

  FOREIGN KEY (tile_id) REFERENCES tiles (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  FOREIGN KEY (parent_village_id) REFERENCES villages (id)
    ON DELETE SET NULL
) STRICT;
