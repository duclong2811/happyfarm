# Ngũ Hành — bản thiết kế quần đảo hàng xóm

HOME_ISLAND là đảo Thổ: giữ nguyên ô đất, farm, công trình, resource và các tọa độ đã lưu. Bốn đảo
hàng xóm dùng cùng một khung template deterministic nhưng mỗi đảo có silhouette, địa hình và nhịp
khám phá riêng. Chuyên môn hóa chỉ là trọng tâm cảnh quan/NPC, không phải hard lock nghề.

## Nguyên tắc địa hình

- Silhouette được tạo từ superellipse méo nhẹ bằng các lobe tần số thấp; bờ có headland và vịnh,
  không dùng đĩa tròn đều.
- Bờ gồm nước sâu, dải cát ướt và mặt đất nâng có cạnh bên; ground height và collision dùng cùng
  profile để tránh nhân vật đi trên nước hoặc lọt qua bờ.
- Bố cục lấy nguyên tắc địa hình đảo thực tế: vùng thấp gần bờ, đường sống lưng hoặc đồi ở giữa,
  gió và nước định hình các vịnh; mọi landmark có khoảng trống và tuyến đi rõ.
- Seed cố định chỉ dùng cho layout scenery. Không random theo F5, không tạo state/economy.

## Năm đảo

| Đảo | Silhouette / địa hình | Bờ / bến / đường khám phá | Landmark | Nghề chính / phụ | NPC / mở rộng |
|---|---|---|---|---|---|
| **Thổ — HOME_ISLAND** | đảo lớn, lõi farm và cao độ hiện hữu | bến và đường hiện hữu; không di chuyển tọa độ đã lưu | làng, hồ, núi lửa | farm là chính; mọi nghề quy mô nhỏ | farm người chơi; mở rộng theo land contract hiện tại |
| **Mộc** | hình lá bất đối xứng, lowland ở bến, sống lưng rừng cao hơn | vịnh phía tây-nam; đường đất từ bến qua grove tới nhà NPC, có vòng lookout | grove, lookout đá, vòng đá/rừng | lâm nghiệp chính; farm nhỏ, khai khoáng nhẹ, câu cá bờ | NPC ở đồng trống phía đông; mở rộng rừng/đường mòn về bắc |
| **Kim** | hai sườn đá lệch, đồi lõm và mặt đá lộ thiên | bãi cập phía tây; đường ziczac qua chân đồi | mỏ lộ thiên, cột đá, trạm cân | khai khoáng chính; lâm nghiệp bụi, farm khe thấp, câu cá nhỏ | NPC ở thềm thấp; mở rộng hầm và sân quặng |
| **Thủy** | đảo thấp, nhiều doi cát và lagoon | bến cong phía nam; boardwalk ven lagoon | đầm phá, hải đăng, cầu gỗ | thủy sản chính; đất trồng nhỏ, rừng ngập, quặng bờ | NPC ở bãi cao trung tâm; mở rộng cầu/bến |
| **Hỏa** | đồng cỏ, đất đỏ, đồi ấm và lõi đất bằng | vịnh nông phía nam; đường đất đỏ tới khu chuồng | giếng nước, đồi đỏ, khu chuồng | chăn nuôi chính; farm, rừng thưa, khoáng nhỏ | NPC ở cạnh khu chuồng; mở rộng đồng cỏ và chuồng |

## Phạm vi triển khai hiện tại

Chỉ Mộc được render/khám phá trong phase này. Kim, Thủy và Hỏa có template/blueprint ổn định để
phase sau nối vào cùng island identity và travel contract. Hỏa chưa có sản phẩm hoặc economy chăn
nuôi; layout chỉ là cảnh quan và vùng dự trữ.
