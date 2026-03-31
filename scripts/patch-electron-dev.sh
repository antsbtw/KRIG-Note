#!/bin/bash
# Patch Electron dev binary for macOS — set app name and icon
# This runs after npm install to customize the dev experience.

ELECTRON_APP="node_modules/electron/dist/Electron.app"
PLIST="$ELECTRON_APP/Contents/Info.plist"
ICON_SRC="build/icon.icns"
ICON_DST="$ELECTRON_APP/Contents/Resources/electron.icns"

if [ ! -f "$PLIST" ]; then
  echo "Electron plist not found, skipping dev patch."
  exit 0
fi

# Patch app name
/usr/libexec/PlistBuddy -c "Set CFBundleName 'KRIG Note'" "$PLIST" 2>/dev/null
/usr/libexec/PlistBuddy -c "Set CFBundleDisplayName 'KRIG Note'" "$PLIST" 2>/dev/null

# Patch icon
if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$ICON_DST"
fi

echo "✅ Patched Electron dev binary: KRIG Note"
