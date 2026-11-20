# Game Trends

Công cụ nội bộ theo dõi **game mobile đang trend theo từng quốc gia và toàn cầu** trên App Store và Google Play. Hoàn toàn miễn phí: không cần API key, không cần server.

- **Thu thập:** GitHub Actions chạy mỗi ngày lúc 08:17 giờ VN. Dữ liệu được commit vào `data/`.
- **Hiển thị:** trang tĩnh deploy lên GitHub Pages (`site/` + JSON do `scripts/build.mjs` sinh ra).

## Nguồn dữ liệu

| Store | Bảng xếp hạng | Chỉ số tăng trưởng |
|---|---|---|
| App Store | Apple iTunes RSS (chính chủ), thể loại Games, theo quốc gia | Số đánh giá theo từng nước (iTunes Lookup API), dùng thay cho lượt tải |
| Google Play | `google-play-scraper` (scrape), danh mục GAME, theo quốc gia | Số lượt cài thực tế (top 50 mỗi bảng) |

## Dashboard có gì

- **Thể loại:** mỗi thể loại (Puzzle, RPG, Strategy…) có bảng xếp hạng riêng do store cung cấp, top 50 mỗi nước. Bảng toàn cầu của thể loại cũng được tính riêng. iOS có 16 thể loại, Android có 17.
- **Ảnh store listing:** cửa sổ chi tiết game hiện screenshot hiện tại (Android có thêm ảnh header, video và mô tả ngắn). Khi game đổi bộ ảnh, tool ghi lại ngày đổi và giữ 5 bộ ảnh cũ gần nhất để theo dõi creative. Tool chỉ lưu URL ảnh trong `data/listings.json`, không tải file ảnh về repo.
- **Bảng xếp hạng:** Top Free / Top Grossing theo nước, hoặc **Toàn cầu**. Điểm toàn cầu = Σ trọng số nước × (101 − hạng) / 100; trọng số đặt trong `config.json`.
- **Đang lên:** tăng hạng nhiều nhất so với 7 ngày trước.
- **Mới vào top:** không có mặt trong top ở bất kỳ ngày nào trong 7 ngày trước.
- **Tăng lượt cài / đánh giá:** sắp xếp theo mức tăng tuyệt đối trong 7 ngày.
- Lọc theo thể loại, tìm kiếm, bấm vào một game để xem biểu đồ hạng theo thời gian. Bộ lọc được lưu trên URL nên copy link gửi team được.

> Các cột 1 ngày / 7 ngày cần đủ số ngày dữ liệu tương ứng mới hiển thị. Dữ liệu lịch sử bắt đầu tính từ lần chạy đầu tiên.

## Chạy trên máy

```bash
npm install
npm run collect   # ~25 phút (phần iOS chậm nhất do Apple giới hạn tốc độ gọi Lookup API)
npm run dev       # build + mở http://localhost:5173
```

Chỉ chạy một store: `STORE=ios npm run collect` hoặc `STORE=android npm run collect`.

## Deploy lên GitHub

1. Tạo repo trên GitHub rồi push code lên nhánh `main`.
2. **Settings → Pages → Source: GitHub Actions**.
3. **Actions → Collect & deploy → Run workflow** để chạy lần đầu. Từ đó workflow tự chạy mỗi ngày.

**Lưu ý về repo private:** GitHub Pages với repo private chỉ có ở gói trả phí (Pro/Team). Nếu dùng tài khoản free:
- Để repo **public**. Dữ liệu chỉ là bảng xếp hạng công khai, không có gì nhạy cảm. Hoặc:
- Để repo private và deploy `dist/` sang **Cloudflare Pages** (miễn phí với repo private, có thể khoá bằng Cloudflare Access). Hoặc:
- Để repo private, không dùng Pages, mọi người `git pull` rồi chạy `npm run dev` trên máy.

GitHub Actions không giới hạn số phút với repo public. Với repo private, gói free có 2.000 phút/tháng, trong khi mỗi lần chạy mất khoảng 25–30 phút (khoảng 900 phút/tháng), vẫn nằm trong hạn mức. Muốn chạy nhanh hơn thì đặt `genres.enabled: false`.

## Tuỳ chỉnh (`config.json`)

- `countries`: danh sách nước và trọng số khi tính điểm toàn cầu.
- `charts`: `free`, `grossing` (có thể thêm `paid`).
- `limit`: số hạng mỗi bảng (tối đa 200 với iOS).
- `genres.enabled` / `genres.limit`: bật bảng theo thể loại và số hạng mỗi bảng thể loại.
- `android.detailTopN` / `genreDetailTopN`: lấy lượt cài và ảnh listing cho top N game mỗi bảng chung / bảng thể loại.
- `historyDays`: số ngày lịch sử hiển thị trên dashboard.

## Dung lượng

Mỗi ngày khoảng 360 KB (gzip) trong `data/daily/`, tức khoảng 130 MB/năm. `data/listings.json` (URL ảnh) khoảng 14 MB, git chỉ lưu phần thay đổi giữa các ngày. Khi repo quá nặng, có thể chuyển các file daily cũ sang nơi khác.

## Giới hạn

- Google Play không có API chính thức. Nếu scraper hỏng, chạy `npm update google-play-scraper`. Workflow vẫn ghi dữ liệu iOS nếu chỉ phần Android lỗi.
- Không có số doanh thu thật. Top Grossing chỉ cho biết vị trí tương đối.
- GitHub có thể tạm dừng workflow hẹn giờ nếu repo không có hoạt động trong 60 ngày.
