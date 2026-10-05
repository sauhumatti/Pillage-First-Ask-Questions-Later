CREATE TABLE battle_reports
(
  id INTEGER PRIMARY KEY,
  report_id INTEGER NOT NULL UNIQUE,
  origin_tile_id INTEGER NOT NULL,
  target_tile_id INTEGER NOT NULL,
  -- boolean
  is_raid INTEGER NOT NULL CHECK (is_raid IN (0, 1)),
  loot_wood INTEGER NOT NULL CHECK (loot_wood >= 0),
  loot_clay INTEGER NOT NULL CHECK (loot_clay >= 0),
  loot_iron INTEGER NOT NULL CHECK (loot_iron >= 0),
  loot_wheat INTEGER NOT NULL CHECK (loot_wheat >= 0),
  item_id INTEGER,
  item_amount INTEGER CHECK (item_amount > 0),
  -- boolean
  can_attacker_see_full_report INTEGER NOT NULL CHECK (can_attacker_see_full_report IN (0, 1)),
  attacker_points INTEGER NOT NULL CHECK (attacker_points >= 0),
  defender_points INTEGER NOT NULL CHECK (defender_points >= 0),
  -- Set when administrators lowered the target's loyalty
  loyalty_before INTEGER CHECK (loyalty_before BETWEEN 0 AND 100),
  loyalty_after INTEGER CHECK (loyalty_after BETWEEN 0 AND 100),
  -- boolean
  is_village_conquered INTEGER NOT NULL DEFAULT 0 CHECK (is_village_conquered IN (0, 1)),

  CHECK ((item_id IS NULL) = (item_amount IS NULL)),

  FOREIGN KEY (report_id) REFERENCES reports (id) ON DELETE CASCADE,
  FOREIGN KEY (origin_tile_id) REFERENCES tiles (id),
  FOREIGN KEY (target_tile_id) REFERENCES tiles (id)
) STRICT;
