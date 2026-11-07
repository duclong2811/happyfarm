# HappyFarm — Mộc asset contact-sheet manifest

Phạm vi của manifest này chỉ là duyệt asset. Không có thay đổi terrain, đảo, LOD, collision, NPC,
gameplay hoặc UI production.

Contact sheet dev: `apps/web/moc-asset-contact-sheet.html`.

## Nguồn và cách kiểm kê

- GLB registry: `apps/web/src/render/environment-model-urls.ts`, `building-model-urls.ts`,
  `prop-model-urls.ts`, `model-urls.ts`, `character-model-urls.ts`.
- Shared loader/cache: `apps/web/src/render/model-library.ts`.
- GLB thumbnail renderer dùng chung: `apps/web/src/render/thumbnail.ts`.
- HOME world usage: `apps/web/src/render/world.ts`, `world-config.ts`, `composition.ts`,
  `landmarks.ts`, `terrain.ts`.
- Asset provenance/license chỉ ghi theo bằng chứng trong `docs/ASSET_LICENSES.md`; không suy đoán
  license từ tên file.

## 20 mẫu đề xuất cho Mộc

| Nhóm | ID / builder | Trạng thái | HOME evidence / scale |
| --- | --- | --- | --- |
| Cây | `tree_broad_2` | GLB có registry + file | HOME scenery HERO, `unitScale=1`, scale theo `SceneryInstance` |
| Cây | `tree_broad_3` | GLB có registry + file | HOME planted tree path, `TREE_MODEL_SCALE≈1.52` |
| Cây | `tree_pine_2` | GLB có registry + file | HOME scenery HERO, `unitScale=1` |
| Cây | `resource_wildwood` | generated GLB có registry + file | HOME forestry tree path, envelope generated 1 |
| Cây | `resource_pine` | generated GLB có registry + file | Chưa có path HOME trực tiếp; chỉ candidate |
| Bụi/cảnh quan | `bush_leafy` | GLB có registry + file | HOME scenery HERO, `unitScale=1` |
| Bụi/cảnh quan | `bush_flowering` | GLB có registry + file | HOME scenery HERO, `unitScale=1` |
| Bụi/cảnh quan | `rock_boulder_1` | GLB có registry + file | HOME scenery HERO, `unitScale=1` |
| Bụi/cảnh quan | `plant_grass_tall` | GLB có registry + file | HOME detail scenery, `unitScale=1` |
| Nhà/kho | `farm.barn.t2` | GLB có registry + file | storage tier 2, `sizeWorld=6.4m` |
| Nhà/kho | `farm.barn.t1` | GLB có registry + file | storage tier 1, `sizeWorld=4.6m` |
| Nhà/kho | `farm.openbarn.t1` | GLB có registry + file | HOME open barn, `sizeWorld=5.2m` |
| Nhà ở | `buildFarmhouse()` | procedural có builder | HOME tier 1 fallback, builder scale `1.7` |
| Gỗ | `resource_wildwood_stump` | generated GLB có registry + file | forestry residue/presentation, scale theo prop |
| Gỗ | `resource_pine_stump` | generated GLB có registry + file | forestry residue/presentation, scale theo prop |
| Props | `prop_wagon` | GLB có registry + file | HOME barn yard, `sizeWorld=2.2m` |
| Props | `prop_crate_wooden` | GLB có registry + file | yard dressing, `sizeWorld=0.7m` |
| Props | `prop_axe` | GLB có registry + file | forestry tool presentation, `sizeWorld=0.8m` |
| Props | `prop_anvil_log` / `prop_workbench` | GLB có registry + file | work yard, lần lượt `1.2m` / `1.9m` |

`prop_anvil_log` và `prop_workbench` được gộp một dòng ở bảng để giữ bảng ngắn; contact sheet tách
thành hai card riêng.

## Kết nối và procedural không phải một asset GLB

- `road.dirt.t1`, `road.stone.t3`: procedural road, render qua `createThumbnailRenderer()` →
  `buildRoadSpec()`/`ribbonSurface()`/`stonePlateSurface()`.
- `prop_fence_rail_long`: GLB đã có và đang được HOME composition dùng.
- `addHarbour()`: dock/harbour HOME là procedural, không có GLB riêng; contact sheet có card builder
  để không nhầm dock là asset file.
- `buildMarketStall()`: công trình procedural HOME, không có GLB riêng.
- `addPond()`, `addPlaza()`, `buildTerrain()`: surface/landscape procedural; không phải asset model
  độc lập.

## Thiếu / chưa dùng trực tiếp

- `RESERVED_BUILDINGS` có `WAREHOUSE` ladder/plot nhưng chưa có model hoặc builder độc lập; card này
  cố ý hiện nhãn thiếu, không dùng barn hoặc ảnh khác làm thay thế.
- `resource_pine` và `resource_hardwood` có file + registry nhưng chưa được path HOME hiện tại gọi
  trực tiếp; không đánh dấu chúng là “đang dùng ở HOME”.
- Các model khác trong repo (crop, fish, ore, UI) bị loại khỏi bảng vì không liên quan đến thiết kế
  cảnh quan Mộc.

## License evidence

Các asset imported/normalized được tham chiếu theo `docs/ASSET_LICENSES.md`, trong đó repo ghi rõ
nguồn Quaternius/Kenney và CC0 ở các pack tương ứng. Manifest này không bổ sung license mới và không
suy đoán license cho phần procedural/generated.

## Trạng thái render/capture

Dev server đã phục vụ trang và endpoint module trả HTTP 200 tại
`http://127.0.0.1:5175/moc-asset-contact-sheet.html`. Phiên này không có browser/WebGL capture khả
dụng (`Browser is not available: iab`), nên chưa bàn giao PNG nhóm đã chụp và chưa gọi đây là nghiệm
thu hình ảnh. Khi mở trang bằng browser local, các card sẽ render từ GLB/procedural hiện có; nút `Tải
PNG contact sheet nhóm` xuất PNG theo từng nhóm và nút còn lại xuất manifest JSON.
