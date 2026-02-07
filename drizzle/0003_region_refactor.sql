-- Custom migration: Consolidate x, y, width, height, polygon_points into single JSON region column
-- Region format: { shape: "rectangle"|"polygon"|"oval", data: { x, y, width, height, points? } }

-- Step 1: Add new region column
ALTER TABLE user_captions ADD COLUMN `region` text;

-- Step 2: Migrate existing data into region JSON
UPDATE user_captions SET region = json_object(
  'shape', CASE WHEN polygon_points IS NOT NULL THEN 'polygon' ELSE 'rectangle' END,
  'data', CASE
    WHEN polygon_points IS NOT NULL THEN json_object(
      'x', x, 'y', y, 'width', width, 'height', height,
      'points', json(polygon_points)
    )
    ELSE json_object('x', x, 'y', y, 'width', width, 'height', height)
  END
);

-- Step 3: Drop old columns (SQLite 3.35.0+)
ALTER TABLE user_captions DROP COLUMN `x`;
ALTER TABLE user_captions DROP COLUMN `y`;
ALTER TABLE user_captions DROP COLUMN `width`;
ALTER TABLE user_captions DROP COLUMN `height`;
ALTER TABLE user_captions DROP COLUMN `polygon_points`;
