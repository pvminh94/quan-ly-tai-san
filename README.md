# AMS Pro — Hệ thống Quản lý Tài sản Doanh nghiệp

Ứng dụng web quản lý tài sản (Asset Management System) **tiếng Việt, đầy đủ nghiệp vụ**, kèm **Trình thiết kế báo cáo tự thiết kế** (Report Designer) theo phong cách Crystal Reports nhưng do chính dự án này xây dựng.

> **Chạy trong 30 giây** — không cần cài đặt gì thêm ngoài Node.js ≥ 18:
>
> ```bash
> npm start          # mở http://localhost:3000
> ```
>
> Lần chạy đầu tiên hệ thống tự khởi tạo dữ liệu mẫu tiếng Việt (132 tài sản, 18 người dùng, 9 mẫu báo cáo…).

**Tài khoản demo**

| Tài khoản | Mật khẩu | Vai trò |
|---|---|---|
| `admin` | `Admin@123` | Quản trị hệ thống (toàn quyền) |
| `ketoan.truong` | `User@123` | Kế toán tài sản |
| `thukho` | `User@123` | Thủ kho |
| `kythuat.01` | `User@123` | Kỹ thuật viên |
| `nhanvien.01` | `User@123` | Nhân viên (chỉ xem dữ liệu của mình) |

---

## 1. Điểm nổi bật

| Nhóm | Nội dung |
|---|---|
| **Nghiệp vụ** | 22 phân hệ: tài sản, danh mục, vị trí/kho, nhà cung cấp, hợp đồng, cấp phát – thu hồi, điều chuyển, bảo trì – sửa chữa, khấu hao, kiểm kê, thanh lý, bảo hành, tài liệu đính kèm, người dùng, vai trò, nhật ký, phiên, thông báo, mẫu báo cáo… |
| **Quy trình phê duyệt** | Phiếu điều chuyển / thanh lý / bảo trì / cấp phát có luồng trạng thái: lập → chờ duyệt → duyệt/từ chối → hoàn thành, ghi vết người duyệt & lý do từ chối |
| **Khấu hao** | 6 phương pháp (đường thẳng, số dư giảm dần, số dư giảm dần có điều chỉnh, theo sản lượng, theo tỷ lệ, không khấu hao), chạy khấu hao theo kỳ, xem trước, ghi sổ, chứng từ bảng tính khấu hao |
| **Trình thiết kế báo cáo** | Kéo–thả, 8 dải in (band), 13 loại phần tử, biểu thức & hàm tổng hợp, nhóm – sắp xếp – lọc – tham số, khổ giấy A4/A5/A3/Letter/Legal/hoá đơn, lưới & bám lưới, ghost preview dữ liệu mẫu, undo/redo, xuất HTML/CSV/Excel/Word, xem trước + in |
| **Chứng từ in** | 9 mẫu chứng từ khổ A4 chuẩn văn bản hành chính Việt Nam: biên bản bàn giao, biên bản điều chuyển, phiếu bảo trì, biên bản thanh lý, biên bản kiểm kê, phiếu bảo hành, nhãn/tem tài sản, bảng tính khấu hao, bảng kê tài sản theo hợp đồng |
| **Quét mã QR / mã vạch** | Bộ sinh **QR thật theo ISO/IEC 18004** (phiên bản 1–10, 4 mức sửa lỗi) và **Code 128 thật theo ISO/IEC 15417** (bộ ký tự A/B/C tự động, checksum mod 103, lề trắng 10 module) — không dùng thư viện ngoài; tem tài sản in ra có mã QR `ams://asset/<mã>` + mã vạch Code 128 chạy hết chiều ngang tem; trang **Quét mã** dùng camera điện thoại để kiểm kê nhanh: tự nhận diện, tự ghi nhận, tiến độ, lịch sử, hoàn tác |
| **Quản trị** | Ma trận phân quyền 23 phân hệ × 6 hành động, phạm vi dữ liệu (toàn hệ thống / phòng ban / cá nhân), nhật ký thao tác, quản lý phiên đăng nhập, sao lưu – phục hồi, xuất CSDL JSON & script SQL (MySQL/PostgreSQL), thùng rác & khôi phục |
| **Giao diện** | SPA thuần JavaScript, tiếng Việt 100%, sáng/tối, thu gọn menu, Ctrl+K tìm kiếm nhanh, thông báo, biểu đồ SVG tự vẽ, biểu mẫu sinh tự động từ metadata, in ấn chuyên nghiệp |

---

## 2. Kiến trúc

```
quan-ly-tai-san/
├─ package.json                # không phụ thuộc thư viện ngoài (zero-dependency)
├─ server/
│  ├─ server.js                # HTTP server, CORS, tệp tĩnh, SPA fallback, tự seed
│  ├─ routes.js                # toàn bộ API (REST): xác thực, CRUD, nghiệp vụ, báo cáo, quản trị
│  ├─ seed.js                  # sinh dữ liệu mẫu tiếng Việt (deterministic)
│  ├─ lib/
│  │  ├─ store.js              # CSDL JSON: atomic write, debounce, backup, soft delete
│  │  ├─ util.js               # tiện ích: ngày, số, chuỗi, mã tự sinh, truy vấn danh sách
│  │  ├─ schema.js             # metadata 22 thực thể → sinh danh sách, biểu mẫu, quyền
│  │  ├─ auth.js               # scrypt + HMAC-SHA256 token, kiểm tra quyền
│  │  ├─ service.js            # tầng nghiệp vụ: khấu hao, tổng hợp KPI, dataset báo cáo
│  │  ├─ http.js               # router mini, gửi/nhận, phục vụ tệp tĩnh an toàn
│  │  ├─ report-engine.js      # động cơ báo cáo theo dải + xuất HTML/CSV/XLSX/DOCX
│  │  ├─ qr.js                 # bộ sinh mã QR theo chuẩn ISO/IEC 18004 (thuần JS)
│  │  ├─ documents.js          # 9 mẫu chứng từ in (HTML khổ A4)
│  │  └─ zip.js                # đóng gói ZIP để tạo .docx/.xlsx không cần thư viện
│  └─ tools/
│     ├─ reset-seed.js         # khởi tạo lại dữ liệu mẫu (có sao lưu trước)
│     ├─ smoke-test.js         # kiểm thử API đầu-cuối (190 phép kiểm tra)
│     ├─ ui-test.js            # kiểm thử giao diện bằng DOM thật (jsdom, tuỳ chọn)
│     └─ qr-test.js            # kiểm chứng mã QR bằng bộ giải mã độc lập (tuỳ chọn)
└─ public/                     # SPA
   ├─ index.html
   ├─ css/app.css              # hệ thống thiết kế + theme tối + CSS trình thiết kế + quy tắc in
   └─ js/
      ├─ core.js               # App: state, HTTP, quyền, router hash, tiện ích
      ├─ ui.js                 # thành phần UI: bảng dữ liệu, modal, biểu mẫu theo metadata…
      ├─ charts.js             # biểu đồ SVG (cột, đường, tròn, xếp chồng, sparkline)
      ├─ pages.js              # trang nghiệp vụ: danh sách/chi tiết/sửa, kiểm kê, báo cáo…
      ├─ scan.js               # TRANG QUÉT MÃ QR/MÃ VẠCH (camera điện thoại → kiểm kê nhanh)
      ├─ dashboard.js          # bảng điều khiển & phân tích
      ├─ designer.js           # TRÌNH THIẾT KẾ BÁO CÁO
      ├─ admin.js              # phân hệ quản trị
      └─ app.js                # đăng nhập, menu, định tuyến, thông báo, khởi động
```

**Công nghệ:** Node.js thuần (CommonJS) + JavaScript ES2018 trên trình duyệt. Không npm install, không bundler, không framework. CSDL là tệp JSON `data/db.json` với ghi atomic — phù hợp chạy nội bộ, demo, hoặc làm bản mẫu trước khi chuyển sang MySQL/PostgreSQL (có sẵn công cụ kết xuất script SQL).

---

## 3. Cài đặt & chạy

```bash
# 1) Yêu cầu: Node.js >= 18 (không cần npm install)
node -v

# 2) Chạy
npm start                 # http://localhost:3000
npm run dev               # tự khởi động lại khi sửa mã nguồn (node --watch)

# 3) Biến môi trường (tuỳ chọn)
PORT=8080 HOST=0.0.0.0 npm start
```

Dữ liệu nằm ở `data/db.json`. Xoá thư mục `data/` rồi chạy lại để hệ thống tự tạo lại dữ liệu mẫu.

---

## 4. Kiểm thử

```bash
npm test                       # 190 phép kiểm tra API đầu-cuối (tự khởi động máy chủ ở cổng 3111)
node server/tools/smoke-test.js --port 3000     # chạy trên máy chủ đang mở
node server/tools/smoke-test.js --keep          # giữ lại dữ liệu kiểm thử để xem

# Kiểm thử giao diện (cần jsdom, chỉ dùng khi kiểm thử):
npm install --no-save jsdom
node server/tools/ui-test.js 3000               # duyệt 35 đường dẫn, 77 phép kiểm tra, bắt lỗi JS

# Kiểm chứng mã QR bằng bộ giải mã độc lập (cần ZXing, chỉ dùng khi kiểm thử):
npm install --no-save @zxing/library qrcode-generator
node server/tools/qr-test.js                    # 147 phép kiểm chứng QR + mã vạch Code 128
```

`ui-test.js` gồm **77 phép kiểm tra**: nạp 8 mô-đun SPA, đăng nhập, dựng menu theo phân quyền, duyệt toàn bộ 34 đường dẫn (không phát sinh lỗi JavaScript), tìm kiếm nhanh, biểu đồ SVG, biểu mẫu sinh theo metadata, Trình thiết kế báo cáo (dải in, phần tử, ghost preview), **hộp thoại xác nhận trả về đúng giá trị**, **xoá bản ghi thật qua giao diện**, **trang quét mã** (khung camera, quét thử, tra cứu mã, đổi kết quả, lịch sử, tiến độ, hoàn tác, hộp thoại in tem) và **toàn bộ luồng đăng xuất → đăng nhập lại** (cookie bị xoá, phiên thu hồi, quay về màn hình đăng nhập). Cả hai bộ kiểm thử đều tự dọn dẹp dữ liệu: dòng kiểm kê, tài sản, bản ghi nghiệp vụ đều được trả về đúng trạng thái trước khi chạy (chỉ ghi thêm **nhật ký hệ thống** và phiên đăng nhập — đúng như khi dùng thật), nên chạy lại nhiều lần cũng không làm lệch dữ liệu mẫu.

`qr-test.js` gồm **147 phép kiểm chứng** cho cả mã QR và mã vạch in trên tem:

| Mục | Nội dung |
|---|---|
| 0–1 | Giải mã QR do hệ thống sinh bằng bộ giải mã độc lập **ZXing** (mã tài sản, liên kết `ams://`, tiếng Việt có dấu, chuỗi dài) |
| 2 | 10 phiên bản × 4 mức sửa lỗi × 3 độ dài (kể cả trường hợp sát dung lượng) — tất cả giải mã đúng |
| 3 | **Đối chiếu từng ô** với bộ sinh tham chiếu `qrcode-generator` — 0 ô khác biệt |
| 4 | **Khoét mã QR từ chính tem in ra rồi giải mã lại** — chứng minh tem quét được |
| 5 | **Mã vạch Code 128**: bảng pattern 0–106 trùng ZXing, giải mã các mã do hệ thống sinh, nội dung tiếng Việt chuyển ASCII, **khoét mã vạch từ tem in rồi giải mã**, và kiểm tra **X-dimension ≈ 0,47 mm/module** (khuyến nghị ≥ 0,25 mm) |

Công cụ này cần cài thêm thư viện kiểm thử (`@zxing/library`, tuỳ chọn `qrcode-generator`); ứng dụng chạy thật không phụ thuộc chúng. Bộ kiểm thử chỉ chạy khi bạn cài thư viện kiểm thử — ứng dụng không phụ thuộc chúng.

`smoke-test.js` gồm **190 phép kiểm tra**: sức khoẻ hệ thống & chặn truy cập tệp ngoài, xác thực & phân quyền (nhân viên bị chặn 403), CRUD + tìm kiếm không dấu + sắp xếp + lọc + xuất CSV + nhập JSON + thùng rác, toàn bộ luồng nghiệp vụ (cấp phát → điều chuyển → bảo trì → khấu hao → kiểm kê → thanh lý), báo cáo & trình thiết kế (4 định dạng kết xuất, mọi mẫu hệ thống phải ra dữ liệu), 9 chứng từ in, **quét mã QR/mã vạch** (bộ sinh QR, tra cứu mã, luồng quét kiểm kê, tem có mã QR), và phân hệ quản trị (sao lưu, xuất CSDL/SQL, nhật ký, phiên, đặt lại mật khẩu, khoá/mở tài khoản).

---

## 5. Phân hệ nghiệp vụ

### 5.1 Tài sản (`#/assets`)
- ~60 trường thông tin, nhóm theo thẻ: nhận diện (mã, tên, serial, model, hãng), phân loại, tài chính (giá mua, VAT, vận chuyển, lắp đặt, nguyên giá, giá trị thanh lý), khấu hao, bảo hành, sử dụng, kế toán.
- Tự tính: **nguyên giá**, **khấu hao tháng**, **hao mòn luỹ kế**, **giá trị còn lại**, tiến độ khấu hao, tuổi tài sản, số ngày bảo hành còn lại, cảnh báo (đến hạn bảo trì, sắp hết bảo hành, đã khấu hao hết).
- Thao tác nhanh trên từng dòng: cấp phát, điều chuyển, bảo trì, thanh lý, in tem, in bảng khấu hao, xem lịch sử, sửa, xoá.
- Trang chi tiết có thẻ **Lịch sử hoạt động** dạng dòng thời gian (cấp phát, điều chuyển, bảo trì, khấu hao, bảo hành, thanh lý) và thẻ dữ liệu liên quan.
- Lọc theo trạng thái / phòng ban / danh mục / vị trí / khoảng ngày; tìm kiếm **không dấu** ("may phay" khớp "Máy phay").

### 5.2 Cấp phát – Thu hồi, Điều chuyển, Bảo trì, Thanh lý
- Mỗi loại phiếu là một phân hệ CRUD đầy đủ, có trạng thái quy trình và **tự động cập nhật tài sản** khi hoàn tất (bàn giao → *đang sử dụng* + người sử dụng; thu hồi → *trong kho*; điều chuyển → đổi phòng ban/vị trí/người dùng; bảo trì → *bảo trì* → *đang sử dụng* + chi phí; thanh lý → *đã thanh lý* + lãi/lỗ).
- Hộp thoại chuyên dụng: chọn tài sản có tìm kiếm, chọn người nhận/phòng ban/vị trí, phụ kiện kèm theo, tình trạng bàn giao, dự kiến trả.

### 5.3 Khấu hao (`#/depreciations`)
- 6 phương pháp: `straight_line`, `declining_balance`, `double_declining`, `units_of_production`, `rate_based`, `none`.
- **Chạy khấu hao theo kỳ**: xem trước từng tài sản (giá trị đầu kỳ, mức khấu hao, luỹ kế, giá trị cuối kỳ), chọn phạm vi (toàn bộ / phòng ban / danh mục), ghi đè kỳ đã ghi sổ, kết quả trả về chi tiết từng dòng.
- Chứng từ *Bảng tính khấu hao tài sản* in theo tài sản với tài khoản Nợ/Có.

### 5.4 Kiểm kê (`#/stocktakes`)
- Tạo đợt kiểm kê theo phạm vi, hệ thống **tự sinh danh sách dòng kiểm kê** từ sổ sách (kèm vị trí sổ sách, người sử dụng sổ sách).
- **Màn hình kiểm kê chuyên dụng**: nhập nhanh, đánh dấu khớp / không tìm thấy / sai vị trí / hư hỏng / phát hiện thêm, ghi người kiểm kê & thời điểm, thanh tiến độ.
- Khi ghi nhận thiếu/sai vị trí, hệ thống tự cập nhật trạng thái tài sản; chốt kiểm kê ghi mốc thời gian kiểm kê lên tài sản.
- **Quét mã kiểm kê nhanh**: từ danh sách đợt kiểm kê hoặc màn hình kiểm kê bấm **📷 Quét mã QR** để mở trang quét đã gắn sẵn đợt kiểm kê (xem 5.5).

### 5.5 Quét mã QR / mã vạch — kiểm kê nhanh bằng điện thoại (`#/scan`)

Đường dẫn: `#/scan` (mở trực tiếp), `#/scan?stocktake=<id>` (gắn sẵn đợt kiểm kê), `#/scan?code=<mã>` (tra cứu sẵn một mã).

- **Camera điện thoại**: dùng `getUserMedia` + `BarcodeDetector` của trình duyệt, tự dò và đọc liên tục; hỗ trợ QR, Code128, Code39/93, EAN-8/13, UPC-A/E, ITF, Codabar, DataMatrix, PDF417 (chỉ hiện loại máy hỗ trợ). Có khung ngắm, tia quét và **rung + tiếng bíp** khi nhận mã.
- **Tự ghi nhận (auto)**: mặc định bật — quét được là ghi ngay kết quả **Khớp** vào đợt kiểm kê, không cần chạm màn hình; bỏ chọn nếu muốn quét rồi tự chọn kết quả.
- **Chống trùng**: cùng một mã trong 1,5 giây chỉ tính một lần → cầm điện thoại quét liên tục không bị nhân đôi dòng kiểm kê.
- **Bốn kết quả chuẩn**: Khớp • Sai vị trí • Hư hỏng • Không tìm thấy (+ **Phát hiện thêm** khi tài sản không có trong danh sách sổ sách). Ghi kèm số lượng kiểm kê thực tế và ghi chú.
- **Không có camera vẫn dùng được**: nhập mã bằng tay, **chụp/đọc mã từ ảnh** (kéo–thả tệp), hoặc nút **Quét thử** để mô phỏng quét ngay trên máy tính.
- **Theo dõi & sửa sai**: thẻ tiến độ (đã kiểm kê / còn lại / khớp / lệch / tỷ lệ %), **lịch sử 20 lượt quét gần nhất** kèm người quét – giờ quét, mỗi dòng có nút **↩ Hoàn tác** để bỏ lượt ghi nhận sai.
- **In tem để quét**: mọi tài sản có nút **🏷 In tem QR**; chọn số nhãn (2–16, mặc định 8) → in hàng loạt tem khổ A4. Mỗi tem có **mã QR `ams://asset/<mã>`** (lề trắng 4 module, mức sửa lỗi Q) và **mã vạch Code 128 chạy hết chiều ngang tem** (X-dimension ≈ 0,47 mm/module — vượt mức tối thiểu 0,25 mm nên máy quét cầm tay đọc tốt).
- **Mã mà hệ thống hiểu**: mã tài sản (`TS-2026-00001`), liên kết QR trên tem (`ams://asset/TS-2026-00001`), liên kết kiểm kê (`ams://stocktake/<mã đợt>/asset/<id>)`, số sê-ri, hoặc mã đợt kiểm kê. Không phân biệt chữ hoa/thường, bỏ qua dấu cách và gạch dưới.
- **API tương ứng**: `GET /api/scan/lookup`, `POST /api/scan/count`, `GET /api/scan/history`.

### 5.6 Báo cáo & Trình thiết kế báo cáo
- **28 nguồn dữ liệu** dùng chung cho báo cáo, gồm 21 bảng nghiệp vụ và 7 khung nhìn tổng hợp (`v_asset_full`, `v_depreciation_by_period`, `v_asset_value_by_dept`, `v_maintenance_history`, `v_stocktake_result`, `v_user_assets`, `v_asset_ledger`).
- **9 mẫu báo cáo hệ thống**: tài sản theo phòng ban, khấu hao theo kỳ, biên bản kiểm kê, sổ tài sản cố định, giá trị theo phòng ban, lịch sử bảo trì, tài sản theo nhân viên, thanh lý, tem tài sản.
- Nhân bản mẫu để tuỳ biến, lưu thành mẫu mới, đánh số phiên bản khi lưu.

### 5.7 Quản trị hệ thống (`#/admin`)
| Trang | Nội dung |
|---|---|
| Trạng thái hệ thống | Phiên bản, thời gian hoạt động, dung lượng CSDL, bộ nhớ, số phiên, số bản ghi từng bảng |
| Người dùng | Tài khoản, vai trò, phòng ban, khoá/mở, đặt lại mật khẩu, trạng thái đổi mật khẩu |
| Vai trò & phân quyền | Ma trận 23 phân hệ × 6 hành động (xem/thêm/sửa/xoá/duyệt/kết xuất), phạm vi dữ liệu, chọn nhanh |
| Nhật ký hệ thống | Mọi thao tác (đăng nhập, tạo/sửa/xoá, duyệt, kết xuất, cấu hình) kèm IP, HTTP, **diff dữ liệu cũ → mới** |
| Phiên đăng nhập | Thiết bị, IP, thời điểm, thu hồi phiên từ xa |
| Cấu hình | Doanh nghiệp (in trên báo cáo), quy tắc đánh mã, khấu hao mặc định, cảnh báo & mẫu email, định dạng hệ thống |
| Sao lưu & phục hồi | Tạo/tải lên/tải xuống/phục hồi bản sao lưu, tự sao lưu trước thao tác nguy hiểm |
| Công cụ dữ liệu | Kết xuất CSDL JSON, kết xuất script SQL (MySQL/PostgreSQL), nhập CSDL, thùng rác & khôi phục, khởi tạo lại dữ liệu mẫu |

---

## 6. Trình thiết kế báo cáo

Mở từ **Báo cáo → 🎨 Thiết kế** (hoặc đường dẫn `#/reports/designer/:id`).

### 6.1 Cấu trúc báo cáo (8 dải)
`reportTitle` (tiêu đề) · `pageHeader` (đầu trang, lặp) · `columnHeader` (tiêu đề cột, lặp) · `groupHeader` · `detail` · `groupFooter` · `pageFooter` (chân trang, lặp) · `reportFooter` (tổng kết cuối).

### 6.2 13 loại phần tử
Trường dữ liệu · Văn bản tĩnh · Công thức/Tổng hợp · Đường kẻ · Hình chữ nhật · Hình ảnh/Logo · Số trang · Trang X/Y · Ngày giờ in · Thông tin hệ thống · Khối văn bản dài · **Mã vạch Code 128** · **Mã QR**.

Hai phần tử mã hoá dùng bộ sinh thật trong `server/lib/qr.js` (QR, ISO/IEC 18004) và `server/lib/barcode.js` (Code 128, ISO/IEC 15417): tự chọn bộ ký tự A/B/C và bề rộng tối ưu, tự thêm lề trắng chuẩn, nội dung tiếng Việt được chuyển sang ASCII không dấu. Phần tử mã vạch nhận thêm khoá `quiet` (lề trắng, mặc định 10 module) và `showText` (in nội dung dưới mã).

### 6.3 Tham số theo nguồn dữ liệu
Mỗi mẫu hệ thống được gắn bộ tham số phù hợp với nguồn dữ liệu: tài sản lọc theo *Từ/Đến ngày mua* + *Phòng ban*; khấu hao/sổ tài sản lọc theo *Từ/Đến kỳ (YYYY-MM)*; báo cáo theo phòng ban lọc theo *Phòng ban*; lịch sử bảo trì lọc theo khoảng ngày thực hiện; các báo cáo khác lọc theo từ khoá. Tham số không áp dụng được cho nguồn dữ liệu sẽ tự động bị bỏ qua thay vì lọc sạch dữ liệu.

### 6.4 Định dạng & biểu thức
- Định dạng: `text`, `money`, `number`, `percent`, `date`, `datetime`, `bool` với số chữ số thập phân, tiền tố/hậu tố, chữ hoa, canh lề ngang/dọc, viền, màu chữ/nền, gạch chân, in nghiêng/đậm.
- Token trong chuỗi: `{field}`, `{company.name}`, `{params.x}`, `{date}`, `{time}`, `{page}`, `{pages}`, `{rowIndex}`, `{footer}`.
- Hàm tổng hợp: `SUM`, `COUNT`, `AVG`, `MIN`, `MAX`, `COUNT_DISTINCT`, `FIRST`, `LAST`, `CONCAT` với phạm vi `report` / `group` / `page`.

### 6.5 Thao tác
Kéo từ danh sách trường (49 trường với dataset *assets*) hoặc từ thanh công cụ vào dải in; kéo–thả di chuyển, 8 tay nắm đổi kích thước, chọn nhiều đối tượng, canh lề & phân bố đều, nhân bản, thứ tự lớp, **lưới + bám lưới**, **ghost preview** (xem dữ liệu mẫu thật mờ phía sau), phóng to/thu nhỏ, hoàn tác/làm lại.

Phím tắt: `Ctrl+S` lưu · `Ctrl+Z` / `Ctrl+Y` hoàn tác/làm lại · `Ctrl+D` nhân bản · `Ctrl+C/V` sao chép/dán · `F5` xem trước · mũi tên di chuyển 1 mm (`Shift` + mũi tên 10 mm) · `Delete` xoá.

### 6.6 Tab bên phải
**Thuộc tính** (định dạng, dữ liệu, khung viền) · **Dữ liệu** (nguồn dữ liệu, nhóm, sắp xếp, lọc, tham số) · **Trang** (khổ giấy, hướng giấy, lề, số dòng, tuỳ chọn lặp tiêu đề cột) · **Quy tắc** (ẩn phần tử rỗng, chữ hoa, công thức có điều kiện).

### 6.7 Kết xuất
Xem trước trong khung nhúng · In/PDF qua hộp thoại in của trình duyệt · **HTML** (bản in phân trang) · **CSV** · **Excel (.xlsx)** · **Word (.docx)** — hai định dạng Office được tạo trực tiếp bằng bộ đóng gói ZIP nội bộ, không cần thư viện ngoài.

### 6.8 Hợp đồng dữ liệu (dành cho lập trình viên)
```jsonc
// POST /api/reports/render
{
  "templateId": 1,                 // hoặc "dataset" + "design" tuỳ biến
  "format": "html|csv|xlsx|docx",
  "params": { "fromDate": "2026-01-01", "toDate": "2026-12-31" }
}
```
Thiết kế: `{ paperSize, orientation, margins{top,right,bottom,left}, bands{...}, groups[], sorting[], filters[], parameters[], options{} }`.
Phần tử: `{ id, type, x, y, w, h (mm), field, text, expr, align, valign, fontSize, bold, italic, underline, color, bgColor, border, format, decimals, wrap, uppercase, suppressIfEmpty, visible }`.

---

## 7. API

Xác thực bằng cookie `ams_token` (HttpOnly) hoặc header `Authorization: Bearer <token>`.

| Nhóm | Đường dẫn |
|---|---|
| Xác thực | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password` |
| Metadata | `GET /api/meta`, `GET /api/lookups/:collection`, `GET /api/settings`, `PUT /api/settings`, `GET /api/numbering/preview/:entity` |
| Bảng điều khiển | `GET /api/dashboard/summary`, `GET /api/dashboard/analytics?groupBy=&metric=` |
| CRUD dùng chung | `GET|POST /api/entities/:entity`, `GET|PUT|PATCH|DELETE /api/entities/:entity/:id`, `GET /api/entities/:entity/trash`, `POST /api/entities/:entity/:id/restore`, `GET /api/entities/:entity/export.csv`, `POST /api/entities/:entity/import` |
| Nghiệp vụ | `POST /api/depreciations/run`, `GET /api/depreciations/preview`, `POST /api/stocktakes/:id/generate-items`, `POST /api/stocktakes/:id/items/:itemId`, `POST /api/stocktakes/:id/close`, `POST /api/{transfers|disposals|maintenances|assignments}/:id/:action`, `GET /api/assets/:id/history` |
| Báo cáo | `GET /api/reports/datasets`, `GET /api/reports/datasets/:key/data`, `POST /api/reports/preview`, `POST /api/reports/render`, `POST /api/reports/templates/clone`, `GET /api/reports/blank-design` |
| Chứng từ | `GET /api/documents/:type/:id` (riêng tem tài sản: `GET /api/documents/label/:assetId?copies=8`) |
| Quét mã | `GET /api/scan/lookup?code=&stocktakeId=`, `POST /api/scan/count` (`{stocktakeId, code, result, countedQty, note}`), `GET /api/scan/history?stocktakeId=&limit=` |
| Quản trị | `GET /api/admin/system`, `/permission-matrix`, `/backups`, `POST /api/admin/backup`, `/restore-backup`, `/upload-backup`, `GET /api/admin/db/export`, `POST /api/admin/db/import`, `GET /api/admin/db/export-sql?dialect=mysql|postgres`, `POST /api/admin/reset-demo`, `DELETE /api/admin/audit-logs`, `DELETE /api/admin/sessions/:id`, `POST /api/admin/users/:id/reset-password`, `POST /api/admin/users/:id/toggle-status` |
| Thông báo | `GET /api/notifications`, `POST /api/notifications/mark`, `POST /api/notifications/refresh-alerts` |
| Khác | `GET /api/health` |

Quy ước: thành công `{ data, meta }`; lỗi `{ error: true, message, status }` (kèm `errors` khi 422, 409 khi trùng khoá nghiệp vụ). Danh sách hỗ trợ `?q=`, `?page=`, `?limit=`, `?sort=`, `?order=`, `?filter[field]=value`.

### Tham số truy vấn danh sách
```bash
# Tìm kiếm không dấu + sắp xếp + lọc + phân trang
curl -b cookie.txt "http://localhost:3000/api/entities/assets?q=may%20phay&sort=originalCost&order=desc&filter[status]=in_use&page=1&limit=20"
```

---

## 8. Bảo mật

- Mật khẩu băm bằng **scrypt** (salt riêng cho từng người dùng); chính sách độ dài tối thiểu, bắt buộc đổi mật khẩu sau khi được cấp lại; khoá tài khoản sau N lần sai.
- Phiên đăng nhập lưu phía máy chủ, token ký **HMAC-SHA256** bằng khoá bí mật sinh một lần trong `data/.secret.key`, cookie `HttpOnly` + `SameSite=Lax`, có thời hạn và thu hồi từ xa.
- Phân quyền 2 lớp: **phân hệ × hành động** và **phạm vi dữ liệu** (toàn hệ thống / phòng ban / chỉ dữ liệu của mình).
- **Xác thực hai đường**: ngoài cookie, ứng dụng gửi kèm `Authorization: Bearer <token>` cho mọi lời gọi API và lưu token vào **bộ lưu trữ an toàn** (tự chuyển sang bộ nhớ tạm nếu trình duyệt chặn `localStorage`). Nhờ vậy app vẫn chạy khi cookie không dùng được — **khung nhúng sandbox/iframe**, chế độ ẩn danh chặn cookie, hoặc truy cập qua proxy. Máy chủ trả `Access-Control-Allow-Origin: *` cho `Origin: null` để khung nhúng sandbox không bị chặn CORS.
- Mở tài liệu/báo cáo **trực tiếp bằng trình duyệt** khi phiên đã hết hạn sẽ nhận **trang HTML tiếng Việt** ("Phiên làm việc đã hết hạn — lỗi 401" kèm nút *Đăng nhập lại* / *Quay lại*) thay vì JSON thô.
- Nhật ký ghi vết mọi thao tác kèm IP, đường dẫn, phương thức, HTTP status và diff dữ liệu.
- Phục vụ tệp tĩnh có chống thoát thư mục (traversal); tệp CSDL và khoá bí mật không bao giờ được phục vụ qua HTTP.

---

## 9. Triển khai

**Chạy nội bộ / máy chủ nội bộ**
```bash
PORT=3000 HOST=0.0.0.0 npm start
# hoặc chạy nền bằng pm2/systemd
pm2 start server/server.js --name ams-pro
```

**Sau reverse proxy (Nginx)**
```nginx
server {
  listen 80;
  server_name ams.congty.vn;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

**Sao lưu định kỳ:** hệ thống tự tạo bản sao lưu trước mọi thao tác nguy hiểm; nên đặt cron gọi `POST /api/admin/backup` hoặc sao chép thư mục `data/backups` ra ngoài máy chủ.

**Chuyển sang MySQL/PostgreSQL:** dùng *Quản trị → Công cụ dữ liệu → Kết xuất script SQL*, sau đó chỉnh `server/lib/store.js` sang trình điều khiển CSDL tương ứng (tầng nghiệp vụ trong `service.js` không phụ thuộc cơ chế lưu trữ).

---

## 10. Lộ trình mở rộng gợi ý

- Gửi email/SMS thật cho cảnh báo bảo trì & bàn giao (mẫu email đã có sẵn trong cấu hình).
- Quét mã vạch/QR bằng điện thoại để kiểm kê nhanh (mã Code128/QR đã in được trên tem tài sản).
- Đồng bộ với phần mềm kế toán qua tệp kết xuất hoặc API trung gian.
- Ứng dụng di động PWA và chữ ký số trên chứng từ.

---

## 11. Giấy phép

MIT — xem tệp `LICENSE`. Dự án do **pvminh94** phát triển.
