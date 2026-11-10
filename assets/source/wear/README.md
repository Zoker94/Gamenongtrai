# Quần áo = nửa thân

Nhân vật được chia làm 2 nửa tại đường eo (mép trên quần short của nhân vật gốc):
- Áo (ô Áo) thay NGUYÊN nửa trên, kể cả đầu.
- Quần/váy (ô Quần) thay NGUYÊN nửa dưới.
- Ô không mặc gì: dùng nửa đó của nhân vật gốc.

Mỗi món đồ có atlas riêng `client/public/assets/wear/<id>.webp` (+ `.json`), game chỉ tải khi mặc.
Biểu tượng cửa hàng `wri_<id>` nằm trong atlas chính.

## Bộ đồ vẽ bằng PixelLab (đủ mọi hoạt ảnh)

Danh mục: `outfits.json`. Mỗi bộ (`outfit_*`) cho ra 1 áo + 1 quần, kèm các biến thể đổi màu.
Khung hình: đứng 8 hướng, đi 8 hướng, thu hoạch, cuốc, tưới (đúng các khung nhân vật gốc có).

1. `create_character_state` trên nhân vật gốc PixelLab (nữ `8cfb2704-…`, nam `eb5f7703-…`) với mô tả bộ đồ.
2. `python tools/outfit_frames.py export char_f <thư mục>`: xuất mọi khung gốc thành lô ≤15 khung 64px theo hướng.
3. Mỗi lô: `transfer_outfit` (ảnh tham chiếu = hướng tương ứng của trạng thái mặc đồ) để giữ nguyên tư thế, chỉ đổi quần áo.
4. `python tools/outfit_frames.py import char_f <plan.json> <kết quả> outfit_<tên>`: lưu vào `outfit_<tên>/src/`.
5. `python tools/wear_cut.py outfits`: cắt nửa trên/dưới, tạo biến thể màu, sinh `shared/wearables.ts`.
6. `python tools/build_assets.py`: dựng atlas.

Biến thể màu trong `outfits.json`: `hue` (xoay sắc độ), `sat`/`val` (độ bão hoà/độ sáng), hoặc `tint` (nhuộm một màu, giữ bóng đổ).
Chỉ điểm ảnh của chính món đồ bị đổi màu (không đụng tóc, mặt).

## Hướng trái = lật hướng phải

Nhân vật gốc nữ có hướng 5, 6, 7 (trái) đúng bằng hướng 3, 2, 1 lật ngang, nên chỉ cần
transfer 5 hướng (0–4); `outfit_frames.py import` tự lật và căn các khung còn thiếu.

## Biểu tượng cửa hàng

`icons/<tên>.png`: icon 48px vẽ bằng PixelLab (`create_1_direction_object`, 16 icon một lượt).
Món gốc dùng icon theo id (hoặc trường `"icon"`), biến thể đổi màu icon bằng code
(hoặc trỏ `"icon"` sang một icon khác đã vẽ).

## Bộ mặc định

`outfit_default_f/m` (`"default": true`): áo thun trắng + quần short jean lấy thẳng từ
nhân vật gốc, có sẵn cho mọi nhân vật (không bán).
