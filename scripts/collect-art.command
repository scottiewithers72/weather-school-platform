#!/bin/bash
# Double-click this file on your Mac to copy the generated fal.ai artwork
# from ~/image-gen-output into the website's assets/art folder with the
# correct filenames. Safe to run repeatedly.
SRC="$HOME/image-gen-output"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/assets/art"
mkdir -p "$ROOT/sites/canes/assets/art" "$ROOT/sites/earthsphere/assets/art"
echo "Copying art from $SRC"

copy() {
  if [ -f "$SRC/$1" ]; then
    cp "$SRC/$1" "$DEST/$2"
    case "$2" in
      canes-*) cp "$SRC/$1" "$ROOT/sites/canes/assets/art/$2" ;;
      es-*)    cp "$SRC/$1" "$ROOT/sites/earthsphere/assets/art/$2" ;;
    esac
    echo "  ✓ $2"
  else
    echo "  ✗ MISSING: $1 ($2)"
  fi
}

# Cane's Weather School — FINAL on-model set, regenerated 2026-06-15 with the
# RETRAINED canedog lock (19 refs). White body, tan patches, upright ears.
# (Hero & Storms 101 kept from the earlier good batch; the other six are new.)
copy CanetheWeatherDog_0_1781226022480.jpg canes-hero.jpg
copy CanetheWeatherDog_0_1781226032861.jpg canes-storms-101.jpg
copy CanetheWeatherDog_0_1781740617552.jpg canes-hurricane-hunters.jpg
copy CanetheWeatherDog_0_1781740628733.jpg canes-weather-academy.jpg
copy CanetheWeatherDog_0_1781740648099.jpg canes-sun.jpg
copy CanetheWeatherDog_0_1781740655613.jpg canes-volcanoes.jpg
copy CanetheWeatherDog_0_1781740677754.jpg canes-ocean.jpg
copy CanetheWeatherDog_0_1781741565756.jpg canes-earth-explorers.jpg

# EarthSphere Academy
copy img_0_1781224579925.jpg es-hero.jpg
copy img_0_1781224589466.jpg es-meteorology.jpg
copy img_0_1781224592101.jpg es-meteorology2.jpg
copy img_0_1781224595744.jpg es-weather-detectives.jpg
copy img_0_1781224599171.jpg es-atmosphere.jpg
copy img_0_1781224610123.jpg es-earthspace.jpg

# EarthSphere severe-weather / hazards set (added on Scott's request)
copy img_0_1781226088170.jpg es-hurricane-space.jpg
copy img_0_1781226091218.jpg es-blizzard.jpg
copy img_0_1781226093389.jpg es-ice-storm.jpg
copy img_0_1781226097098.jpg es-fault.jpg
copy img_0_1781226105310.jpg es-volcano.jpg
copy img_0_1781226197279.jpg es-oceanography.jpg
copy img_0_1781226202116.jpg es-living-planet.jpg
copy img_0_1781226205821.jpg es-climate.jpg

echo "Done. Both sites will now show the artwork."
read -p "Press Enter to close..."
