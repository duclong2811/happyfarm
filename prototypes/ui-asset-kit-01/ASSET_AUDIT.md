# UI Kit 01 Asset Audit

This is a preview-only audit. The supplied asset sheet is a flattened art-direction sheet, not a production sprite atlas. No additional sprites were cropped for this correction.

| Asset | Text | Numbers | Item labels | Neighboring artwork/background | Allowed use |
| --- | --- | --- | --- | --- | --- |
| `assets/approved-reference.png` | Yes | Yes | Yes | Entire concept scene and all neighboring UI | Comparison reference only; never a component or gameplay background |
| `assets/inventory-header-barn.png` | Yes: partial category text remains | No | Yes | Yes: panel/tab material remains | **REJECTED**; replace with clean title decoration |
| `assets/inventory-close.png` | Yes: partial category text remains | No | Yes | Yes: neighboring panel/card material remains | **REJECTED**; replace with clean close artwork |
| `assets/inventory-leaf-corner.png` | No | No | No | Yes: surrounding wood/frame fragment | **REJECTED**; replace with clean corner layer |
| `assets/apple-icon.png` | No visible label after the current crop | No | No | Yes: residual card/background edge remains | **REJECTED**; re-export clean transparent Apple icon |
| `assets/inventory-frame-center.svg` | No | No | No | No | Preview candidate; not approved final artwork |
| `assets/inventory-slot.svg` | No | No | No | No | Preview candidate; not approved final artwork |
| `assets/inventory-slot-selected.svg` | No | No | No | No | Preview candidate; not approved final artwork |
| `assets/inventory-slot-disabled.svg` | No | No | No | No | Preview candidate; not approved final artwork |
| `assets/real-gameplay-01-world-hud.png` | Existing live HUD text | Existing live HUD values | Existing live HUD labels | Genuine 3D world and current UI | **REFERENCE_ONLY**; native 1040 × 823 staging crop |
| `assets/gameplay-1440x900.png` | Missing | Missing | Missing | Missing | Not required now; supplied desktop reference is 1040 × 823 |
| `assets/gameplay-390x844.png` | Missing | Missing | Missing | Missing | Required real mobile gameplay capture before mobile approval |

The corrected preview uses the genuine `real-gameplay-01-world-hud.png` scene and does not use any rejected raster crop as title, close, corner, or Apple artwork. The Apple crop remains listed only so the contamination is explicit; the panel shows an `APPLE ART` replacement slot until a clean export is supplied.

## Replaceable artwork slots

- `title-decoration`: clean illustrated barn/warehouse ornament;
- `panel-frame`: scalable wood outer frame and corner layers;
- `parchment-body`: scalable interior surface;
- `item-slot.normal`: normal slot surface;
- `item-slot.selected`: selected border/highlight;
- `item-slot.disabled`: disabled surface/contrast treatment;
- `close-button`: clean close control with no neighboring pixels;
- `warehouse-icon`: real approved Warehouse/resource icon;
- resource counter icons: only for real current game data.

The preview represents these slots using DOM-labelled placeholders where clean approved artwork is missing. Labels and quantities remain DOM text.
