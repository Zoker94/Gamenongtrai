# Quần áo = nửa thân

Nhân vật được chia làm 2 nửa tại đường eo (mép trên quần short của nhân vật gốc):
- Áo (ô Áo) thay NGUYÊN nửa trên, kể cả đầu, lấy thẳng từ GIF "nhân vật mặc áo".
- Quần (ô Quần) thay NGUYÊN nửa dưới, lấy thẳng từ GIF "nhân vật mặc quần".
- Ô không mặc gì: dùng nửa đó của nhân vật gốc.

Mỗi món là một thư mục `assets/source/wear/<id>_<f|m>/` (_f nữ, _m nam; id có chữ `pants` là quần):
- `turnaround.gif`: dáng đứng 8 hướng (khung d = hướng d của game).
- `walk_<d>.gif`: đi hướng d, khung 68x68 như `char_f/walk_<d>.gif`.

Cắt: `python3 tools/wear_cut.py <id> char_f red`, rồi `python3 tools/build_assets.py`.
