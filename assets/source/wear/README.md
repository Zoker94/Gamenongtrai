# Quần áo (lớp ghép lên nhân vật)

Mỗi món đồ là một thư mục `assets/source/wear/<id>/`.

- `turnaround.gif`: ảnh gốc người dùng gửi (nhân vật mặc đồ, 8 hướng xoay theo chiều kim đồng hồ: xuống, xuống-trái, trái, lên-trái, lên, lên-phải, phải, xuống-phải).
- `idle_<d>.png`: lớp ÁO đã tách, cùng khung 68x68 với `assets/source/char_f/idle_<d>.gif`, vẽ thẳng đè lên thân.
  `d` theo quy ước của game: 0 xuống, 1 xuống-phải, 2 phải, 3 lên-phải, 4 lên, 5 lên-trái, 6 trái, 7 xuống-trái.

Cách ghép đúng cho mọi động tác: với mỗi động tác (đứng, đi, cuốc, tưới, thu hoạch...) cần một GIF
"nhân vật mặc đồ" vẽ trên CHÍNH các khung của GIF gốc (cùng khung 68x68, cùng vị trí, cùng số khung).
Khi đó lớp đồ = các điểm ảnh khác với GIF gốc, tách tự động theo từng khung.

jacket_red_f: áo khoác đỏ của nhân vật nữ. Hiện chỉ có dáng đứng 8 hướng, tách theo màu đỏ
(ảnh gốc vẽ riêng, không trùng điểm ảnh với nhân vật trong game nên phía sau/bên hông còn lộ vai áo trắng).
