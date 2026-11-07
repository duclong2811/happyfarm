# HappyFarm production 2.5D UI art

`generate_premium_ui.py` is the editable local source for the button, navigation-frame and item-slot
family used by the planting toolbar, navigation and HUD.

It uses the installed Python 3.11 + Pillow toolchain to render real RGBA layers with:

- independent contact shadow pass;
- top/bottom material gradients baked into the raster artwork;
- inset bevel and highlight passes;
- fixed corner leaf ornaments;
- transparent centers for DOM text and item artwork.

The outputs are consumed with CSS `border-image` 9-slice rules. The reference screenshots are never
read by the generator and are not shipped as UI layers.

Run from the repository root:

```powershell
python tools/ui-art/generate_premium_ui.py
```

Outputs are written to:

`apps/web/src/assets/ui/premium-2_5d/`

The source and generated files are project-owned artwork; no third-party source material is used.
