# Nông Trại Sủng Vật 🌾🐾

Web game 2D pixel art kết hợp **nông trại** và **săn bắt, nuôi sủng vật**. Chạy được trên cả PC và điện thoại.
Có 3 bản đồ: Nông trại (đã xong), Thành phố và Công viên (sắp làm).

## Chạy game

```bash
npm install
npm run build      # đóng gói client vào dist/
npm start          # máy chủ: http://localhost:8080
```

Khi phát triển (tự tải lại khi sửa code):

```bash
npm run dev        # Vite: http://localhost:5173, server game chạy ở cổng 8080
```

Yêu cầu Node.js ≥ 22.18 (máy chủ chạy trực tiếp file TypeScript, không cần bước build).
Muốn cắt lại sprite từ ảnh gốc thì chạy `npm run assets` (cần Python 3 và Pillow).

## Điều khiển

| | PC | Điện thoại |
|---|---|---|
| Di chuyển | WASD / phím mũi tên, hoặc click vào nơi muốn đến | Cần điều khiển ảo, hoặc chạm vào nơi muốn đến |
| Dùng công cụ | Space / E, hoặc click vào ô bên cạnh | Nút tròn, hoặc chạm vào ô bên cạnh |
| Đổi công cụ | phím 1–9, Q / Tab, lăn chuột | chạm vào thanh công cụ |

Vòng chơi: **Cuốc** xới đất trong ruộng → chọn **hạt giống** để gieo → **bình tưới** tưới nước
(mỗi giai đoạn lớn cần tưới 1 lần) → cây chín thì bấm để thu hoạch → bán ở **rương vàng** cạnh nhà,
mua hạt ở **bao hạt giống**.

## Cấu trúc

```
assets/source/     ảnh asset gốc (2 sprite sheet)
tools/             script Python cắt sprite, tách nền, nén thành 1 atlas PNG
  sprites.py       toạ độ từng sprite trên sheet gốc (sửa ở đây để thêm sprite)
client/            game chạy trên trình duyệt (TypeScript + Canvas 2D, không dùng engine)
  public/assets/   atlas.png + atlas.json (được tạo bởi tools/build_assets.py)
  src/world.ts     vẽ nền theo chunk dựng sẵn, va chạm
  src/main.ts      vòng lặp game, camera, vẽ theo thứ tự Y
server/index.ts    máy chủ Node: phục vụ file tĩnh (brotli/gzip, cache) + WebSocket /ws
shared/            code dùng chung cho client và server
  rules.ts         luật chơi: cây trồng, xới, gieo, tưới, thu hoạch, mua bán
  maps/farm.ts     bản đồ nông trại (64×44 ô), địa hình là hàm liên tục terrainAt()
```

## Tối ưu để nhẹ và mượt

- **Dung lượng tải**: khoảng 125 KB tổng cộng. Toàn bộ 200 sprite nằm trong 1 atlas PNG 8-bit (~106 KB), JS ~14 KB sau gzip.
  Sprite được thu nhỏ về đúng kích thước pixel art (ô 32px) rồi phóng to bằng số nguyên khi vẽ, nên vẫn sắc nét.
- **Vẽ nhanh**: nền (đường đất, nước, cỏ cao, bóng đổ, hoa nhỏ, vạch sân đấu) được vẽ sẵn một lần ở độ chi tiết 4px vào các chunk 512×512. Mỗi khung hình chỉ cần vài lệnh `drawImage`
  cho nền, cộng với các vật thể đang nằm trong màn hình.
- Không tạo object mới trong vòng lặp game (dùng pool), giới hạn devicePixelRatio ở 2, zoom số nguyên.
  Ảnh được giải mã bằng `createImageBitmap` để không làm khựng luồng chính.
- **Máy chủ có quyền quyết định cuối cùng**: client áp dụng hành động ngay để người chơi không thấy độ trễ,
  còn server kiểm tra lại bằng cùng file luật `shared/rules.ts`. Cây lớn dựa theo mốc thời gian,
  nên server không cần chạy vòng lặp liên tục.
- Nếu không kết nối được server, game vẫn chơi offline và lưu bằng localStorage.
  Khi có server, tiến trình được lưu ở `data/saves/<id>.json`.
