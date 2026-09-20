'use strict';
/**
 * seed.js — Khởi tạo dữ liệu mẫu tiếng Việt cho hệ thống
 * Bao gồm: cấu hình, vai trò, người dùng, danh mục, kho/vị trí, nhà cung cấp,
 *          hợp đồng, tài sản (~120), cấp phát, điều chuyển, bảo trì, khấu hao,
 *          bảo hành, kiểm kê, thanh lý, mẫu báo cáo hệ thống, nhật ký.
 */

const store = require('./lib/store');
const schema = require('./lib/schema');
const auth = require('./lib/auth');
const util = require('./lib/util');
const service = require('./lib/service');
const reports = require('./lib/report-engine');

/* ------------------------- Tiện ích ngẫu nhiên ------------------------- */

let seedValue = 20240919;
function rnd() {
  seedValue = (seedValue * 1103515245 + 12345) & 0x7fffffff;
  return seedValue / 0x7fffffff;
}
function pick(arr) {
  return arr[Math.floor(rnd() * arr.length)];
}
function int(min, max) {
  return Math.floor(rnd() * (max - min + 1)) + min;
}
function dateStr(d) {
  return new Date(d).toISOString().slice(0, 10);
}
function daysAgo(n) {
  return dateStr(Date.now() - n * 86400000);
}
function isoAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

/* ------------------------------- DỮ LIỆU ------------------------------- */

const DEPARTMENTS = [
  { code: 'BGD', name: 'Ban Giám đốc', phone: '02838221100', email: 'bgd@ams.vn', costCenter: 'CC100', budgetYear: 2500000000 },
  { code: 'HCNS', name: 'Phòng Hành chính - Nhân sự', phone: '02838221101', email: 'hcns@ams.vn', costCenter: 'CC200', budgetYear: 1800000000 },
  { code: 'KTTC', name: 'Phòng Kế toán - Tài chính', phone: '02838221102', email: 'ketoan@ams.vn', costCenter: 'CC300', budgetYear: 1200000000 },
  { code: 'CNTT', name: 'Phòng Công nghệ thông tin', phone: '02838221103', email: 'cntt@ams.vn', costCenter: 'CC400', budgetYear: 3500000000 },
  { code: 'KDT', name: 'Phòng Kinh doanh - Tiếp thị', phone: '02838221104', email: 'kinhdoanh@ams.vn', costCenter: 'CC500', budgetYear: 900000000 },
  { code: 'SX1', name: 'Phân xưởng Sản xuất 1', phone: '02838221105', email: 'sx1@ams.vn', costCenter: 'CC600', budgetYear: 4200000000 },
  { code: 'SX2', name: 'Phân xưởng Sản xuất 2', phone: '02838221106', email: 'sx2@ams.vn', costCenter: 'CC700', budgetYear: 3800000000 },
  { code: 'QA', name: 'Phòng Quản lý chất lượng (QA/QC)', phone: '02838221107', email: 'qa@ams.vn', costCenter: 'CC800', budgetYear: 750000000 },
  { code: 'KHO', name: 'Bộ phận Kho vận', phone: '02838221108', email: 'khovan@ams.vn', costCenter: 'CC900', budgetYear: 600000000 },
];

const CATEGORIES = [
  { code: 'THIET-BI-VP', name: 'Thiết bị văn phòng', life: 60, rate: 20, type: 'tool', cycle: 180 },
  { code: 'MAY-TINH', name: 'Máy tính & Thiết bị CNTT', life: 48, rate: 25, type: 'tool', cycle: 180, parent: 'THIET-BI-VP' },
  { code: 'MAY-IN', name: 'Máy in - Máy scan - Photocopy', life: 60, rate: 20, type: 'tool', cycle: 180, parent: 'THIET-BI-VP' },
  { code: 'MAY-CHIEU', name: 'Máy chiếu & Thiết bị trình chiếu', life: 60, rate: 20, type: 'tool', cycle: 180, parent: 'THIET-BI-VP' },
  { code: 'DIEN-THOAI', name: 'Điện thoại & Thiết bị liên lạc', life: 36, rate: 33, type: 'tool', cycle: 365, parent: 'THIET-BI-VP' },
  { code: 'NOI-THAT', name: 'Nội thất văn phòng', life: 96, rate: 12, type: 'fixed', cycle: 365 },
  { code: 'THIET-BI-SX', name: 'Thiết bị sản xuất', life: 120, rate: 10, type: 'fixed', cycle: 90 },
  { code: 'MAY-CNC', name: 'Máy gia công CNC', life: 144, rate: 8, type: 'fixed', cycle: 90, parent: 'THIET-BI-SX' },
  { code: 'MAY-NEN', name: 'Máy nén khí & Hệ thống khí nén', life: 120, rate: 10, type: 'fixed', cycle: 90, parent: 'THIET-BI-SX' },
  { code: 'BANG-TAI', name: 'Hệ thống băng tải', life: 120, rate: 10, type: 'fixed', cycle: 120, parent: 'THIET-BI-SX' },
  { code: 'PHUONG-TIEN', name: 'Phương tiện vận tải', life: 120, rate: 10, type: 'fixed', cycle: 90 },
  { code: 'O-TO', name: 'Ô tô - Xe tải', life: 120, rate: 10, type: 'fixed', cycle: 90, parent: 'PHUONG-TIEN' },
  { code: 'XE-NANG', name: 'Xe nâng & Thiết bị nâng hạ', life: 96, rate: 12, type: 'fixed', cycle: 90, parent: 'PHUONG-TIEN' },
  { code: 'THIET-BI-MANG', name: 'Thiết bị mạng & Máy chủ', life: 60, rate: 20, type: 'fixed', cycle: 180 },
  { code: 'SERVER', name: 'Máy chủ & Thiết bị lưu trữ', life: 60, rate: 20, type: 'fixed', cycle: 180, parent: 'THIET-BI-MANG' },
  { code: 'CCDC', name: 'Công cụ - Dụng cụ', life: 24, rate: 50, type: 'tool', cycle: 180 },
  { code: 'TS-VO-HINH', name: 'Tài sản vô hình (Phần mềm, Bản quyền)', life: 36, rate: 33, type: 'intangible', cycle: 365 },
  { code: 'THIET-BI-AN-TOAN', name: 'Thiết bị an toàn - PCCC', life: 60, rate: 20, type: 'fixed', cycle: 180 },
  { code: 'THIET-BI-Y-TE', name: 'Thiết bị y tế & Sức khoẻ', life: 84, rate: 14, type: 'fixed', cycle: 180 },
  { code: 'THIET-BI-KHO', name: 'Thiết bị kho vận', life: 96, rate: 12, type: 'fixed', cycle: 120 },
];

const LOCATIONS = [
  { code: 'KHO-TONG', name: 'Kho tổng - Trung tâm phân phối', type: 'warehouse', address: 'Lô C12 KCN Tân Bình, TP.HCM', capacity: 1200 },
  { code: 'TRA-A', name: 'Toà nhà A - Trụ sở chính', type: 'building', address: 'Số 12 Nguyễn Huệ, Q.1, TP.HCM', capacity: 800 },
  { code: 'A-T1', name: 'Tầng 1 - Toà nhà A (Tiếp tân, Kho nhỏ)', type: 'floor', parent: 'TRA-A', capacity: 150 },
  { code: 'A-T1-LT', name: 'Phòng Lễ tân A1-01', type: 'room', parent: 'A-T1', capacity: 30 },
  { code: 'A-T2', name: 'Tầng 2 - Khối văn phòng', type: 'floor', parent: 'TRA-A', capacity: 400 },
  { code: 'A-T2-PKT', name: 'Phòng Kế toán A2-01', type: 'room', parent: 'A-T2', capacity: 60 },
  { code: 'A-T2-PNS', name: 'Phòng Nhân sự A2-02', type: 'room', parent: 'A-T2', capacity: 50 },
  { code: 'A-T2-PKD', name: 'Phòng Kinh doanh A2-03', type: 'room', parent: 'A-T2', capacity: 80 },
  { code: 'A-T3', name: 'Tầng 3 - Khối kỹ thuật & CNTT', type: 'floor', parent: 'TRA-A', capacity: 300 },
  { code: 'A-T3-SERVER', name: 'Phòng máy chủ A3-01 (Data Center)', type: 'room', parent: 'A-T3', capacity: 60 },
  { code: 'A-T3-PKT', name: 'Phòng Kỹ thuật A3-02', type: 'room', parent: 'A-T3', capacity: 70 },
  { code: 'NHA-MAY-B', name: 'Nhà máy sản xuất B', type: 'site', address: 'KCN Long Hậu, Long An', capacity: 1500 },
  { code: 'B-X1', name: 'Xưởng sản xuất 1', type: 'room', parent: 'NHA-MAY-B', capacity: 700 },
  { code: 'B-X2', name: 'Xưởng sản xuất 2', type: 'room', parent: 'NHA-MAY-B', capacity: 700 },
  { code: 'B-QA', name: 'Phòng thí nghiệm QA/QC', type: 'room', parent: 'NHA-MAY-B', capacity: 120 },
  { code: 'SHOWROOM', name: 'Showroom & Kho trưng bày', type: 'site', address: '145 Võ Văn Kiệt, Q.5, TP.HCM', capacity: 300 },
  { code: 'XE-CONTAINER', name: 'Phương tiện: Xe container 29C-123.45', type: 'vehicle', capacity: 0 },
];

const SUPPLIERS = [
  { code: 'NCC001', name: 'Công ty TNHH Tin học Sao Việt', tax: '0301234567', contact: 'Nguyễn Thành Nam', phone: '0903112233', email: 'sales@saoviet.vn', address: '52 Nguyễn Văn Cừ, Q.5, TP.HCM', bank: 'VCB - 0071000123456', rating: 'A' },
  { code: 'NCC002', name: 'Công ty CP Thiết bị Văn phòng Ánh Dương', tax: '0312345678', contact: 'Trần Thu Hà', phone: '0908224455', email: 'info@anhduong.com.vn', address: '89 Lý Thường Kiệt, Q.10, TP.HCM', bank: 'ACB - 123456789', rating: 'A' },
  { code: 'NCC003', name: 'Công ty TNHH Máy công nghiệp Đông Á', tax: '0309876543', contact: 'Lê Quốc Bảo', phone: '0912334455', email: 'dongabao@dongacnc.vn', address: 'KCN Tân Tạo, Bình Tân, TP.HCM', bank: 'BIDV - 3101000012345', rating: 'A' },
  { code: 'NCC004', name: 'Công ty CP Cơ khí Chính xác Việt Nhật', tax: '0311223344', contact: 'Phạm Văn Tú', phone: '0938776655', email: 'vietnhat@vietnhatjp.vn', address: 'KCN Long Hậu, Long An', bank: 'Vietinbank - 101200012345', rating: 'B' },
  { code: 'NCC005', name: 'Công ty TNHH Phần mềm Bình Minh', tax: '0314455667', contact: 'Đỗ Minh Châu', phone: '0945667788', email: 'contact@binhminhsoft.vn', address: 'Toà nhà Bitexco, Q.1, TP.HCM', bank: 'TPBank - 0987654321', rating: 'A' },
  { code: 'NCC006', name: 'Công ty CP Ô tô Hoàng Long', tax: '0305566778', contact: 'Nguyễn Hoàng Long', phone: '0909887766', email: 'sales@hoanglongauto.vn', address: '401 Nguyễn Văn Linh, Q.7, TP.HCM', bank: 'MB - 5012345678', rating: 'B' },
  { code: 'NCC007', name: 'Công ty TNHH Bảo trì - Kỹ thuật Tân Tiến', tax: '0317788990', contact: 'Vũ Tấn Phát', phone: '0913778899', email: 'tientan@tientan.com.vn', address: 'KCN Vĩnh Lộc, Bình Chánh, TP.HCM', bank: 'Sacombank - 0600123456', rating: 'A' },
  { code: 'NCC008', name: 'Công ty CP Nội thất Hoà Phát Interior', tax: '0309988776', contact: 'Bùi Thị Mai', phone: '0977112233', email: 'hophat@interior.vn', address: 'Q.12, TP.HCM', bank: 'Vietcombank - 0071000987654', rating: 'B' },
  { code: 'NCC009', name: 'Công ty TNHH Thiết bị An toàn PCCC Toàn Thắng', tax: '0316677889', contact: 'Trịnh Văn Thắng', phone: '0933112244', email: 'toanthang@pccc.vn', address: 'Bình Tân, TP.HCM', bank: 'Agribank - 1600201234567', rating: 'C' },
  { code: 'NCC010', name: 'Công ty CP Vietcombank - CN HCM', tax: '0300000001', contact: 'Phòng Doanh nghiệp 3', phone: '02838221100', email: 'pdn3@vcb.com.vn', address: '29 Bến Chương Dương, Q.1', bank: 'VCB', rating: 'A' },
];

const USERS = [
  { username: 'admin', fullName: 'Nguyễn Văn Minh', email: 'minh.nguyen@ams.vn', phone: '0901234567', dept: 'BGD', position: 'Tổng Giám đốc', role: 'ADMIN', password: 'Admin@123' },
  { username: 'giamdoc', fullName: 'Trần Quốc Cường', email: 'cuong.tran@ams.vn', phone: '0902345678', dept: 'BGD', position: 'Phó Tổng Giám đốc', role: 'MANAGER' },
  { username: 'ketoan.truong', fullName: 'Trần Thị Hồng', email: 'hong.tran@ams.vn', phone: '0903456789', dept: 'KTTC', position: 'Kế toán trưởng', role: 'ACCOUNTANT' },
  { username: 'ketoan.ts', fullName: 'Lê Thị Ngọc', email: 'ngoc.le@ams.vn', phone: '0904567890', dept: 'KTTC', position: 'Kế toán tài sản', role: 'ACCOUNTANT' },
  { username: 'thukho', fullName: 'Phạm Văn Hải', email: 'hai.pham@ams.vn', phone: '0905678901', dept: 'KHO', position: 'Thủ kho', role: 'WAREHOUSE' },
  { username: 'kythuat.01', fullName: 'Đặng Quốc Bảo', email: 'bao.dang@ams.vn', phone: '0906789012', dept: 'SX1', position: 'Kỹ thuật viên bảo trì', role: 'TECHNICIAN' },
  { username: 'kythuat.02', fullName: 'Nguyễn Trung Kiên', email: 'kien.nguyen@ams.vn', phone: '0907890123', dept: 'SX2', position: 'Trưởng nhóm bảo trì', role: 'TECHNICIAN' },
  { username: 'cntt.01', fullName: 'Hoàng Anh Tuấn', email: 'tuan.hoang@ams.vn', phone: '0908901234', dept: 'CNTT', position: 'Trưởng phòng CNTT', role: 'MANAGER' },
  { username: 'cntt.02', fullName: 'Vũ Thị Lan', email: 'lan.vu@ams.vn', phone: '0909012345', dept: 'CNTT', position: 'Quản trị hệ thống', role: 'WAREHOUSE' },
  { username: 'ns.01', fullName: 'Bùi Thanh Vân', email: 'van.bui@ams.vn', phone: '0910123456', dept: 'HCNS', position: 'Trưởng phòng HCNS', role: 'MANAGER' },
  { username: 'ns.02', fullName: 'Ngô Thị Thu', email: 'thu.ngo@ams.vn', phone: '0911234567', dept: 'HCNS', position: 'Chuyên viên hành chính', role: 'VIEWER' },
  { username: 'kd.01', fullName: 'Đinh Quang Huy', email: 'huy.dinh@ams.vn', phone: '0912345678', dept: 'KDT', position: 'Giám đốc kinh doanh', role: 'MANAGER' },
  { username: 'kd.02', fullName: 'Lý Thị Cẩm', email: 'cam.ly@ams.vn', phone: '0913456789', dept: 'KDT', position: 'Nhân viên kinh doanh', role: 'VIEWER' },
  { username: 'sx.01', fullName: 'Trương Văn Định', email: 'dinh.truong@ams.vn', phone: '0914567890', dept: 'SX1', position: 'Quản đốc phân xưởng 1', role: 'MANAGER' },
  { username: 'sx.02', fullName: 'Cao Minh Trí', email: 'tri.cao@ams.vn', phone: '0915678901', dept: 'SX2', position: 'Quản đốc phân xưởng 2', role: 'MANAGER' },
  { username: 'qa.01', fullName: 'Hồ Thị Bích', email: 'bich.ho@ams.vn', phone: '0916789012', dept: 'QA', position: 'Trưởng phòng QA/QC', role: 'MANAGER' },
  { username: 'nhanvien.01', fullName: 'Dương Văn Sơn', email: 'son.duong@ams.vn', phone: '0917890123', dept: 'SX1', position: 'Công nhân vận hành', role: 'VIEWER' },
  { username: 'nhanvien.02', fullName: 'Mai Thị Hạnh', email: 'hanh.mai@ams.vn', phone: '0918901234', dept: 'KTTC', position: 'Nhân viên kế toán', role: 'VIEWER' },
];

const ASSET_TEMPLATES = [
  { cat: 'MAY-TINH', names: ['Laptop Dell Latitude 5440', 'Laptop HP ProBook 450 G10', 'Laptop Lenovo ThinkPad E14', 'Máy tính để bàn Dell OptiPlex 7010', 'Máy tính để bàn HP EliteDesk 800 G9'], brands: ['Dell', 'HP', 'Lenovo'], price: [18500000, 32000000], unit: 'Bộ', life: 48, rate: 25 },
  { cat: 'MAY-IN', names: ['Máy in HP LaserJet Pro M404dn', 'Máy photocopy Ricoh MP 2014AD', 'Máy scan Canon DR-C230', 'Máy in màu Epson L15150'], brands: ['HP', 'Ricoh', 'Canon', 'Epson'], price: [6500000, 42000000], unit: 'Cái', life: 60, rate: 20 },
  { cat: 'MAY-CHIEU', names: ['Máy chiếu Epson EB-X51', 'Máy chiếu Panasonic PT-LB425'], brands: ['Epson', 'Panasonic'], price: [12000000, 26000000], unit: 'Cái', life: 60, rate: 20 },
  { cat: 'DIEN-THOAI', names: ['Điện thoại iPhone 15 Pro', 'Điện thoại Samsung Galaxy S24', 'Tổng đài điện thoại Panasonic KX-NS300'], brands: ['Apple', 'Samsung', 'Panasonic'], price: [7000000, 30000000], unit: 'Cái', life: 36, rate: 33 },
  { cat: 'NOI-THAT', names: ['Bàn làm việc chữ L gỗ công nghiệp', 'Ghế xoay văn phòng Ergonomic', 'Tủ hồ sơ 4 ngăn sắt', 'Bàn họp lớn 12 chỗ', 'Kệ tài liệu gỗ 5 tầng', 'Tủ đựng quần áo nhân viên'], brands: ['Hoà Phát', 'Xingfa', 'Hoà Phát Interior'], price: [1500000, 28000000], unit: 'Bộ', life: 96, rate: 12 },
  { cat: 'MAY-CNC', names: ['Máy phay CNC Haas VF-2', 'Máy tiện CNC Takisawa NEX-108', 'Trung tâm gia công đứng DMG MORI CMX 600V', 'Máy cắt dây CNC Sodick AQ400L'], brands: ['Haas', 'Takisawa', 'DMG MORI', 'Sodick'], price: [450000000, 1850000000], unit: 'Máy', life: 144, rate: 8 },
  { cat: 'MAY-NEN', names: ['Máy nén khí trục vít Atlas Copco GA30', 'Máy sấy khí nén Ingersoll Rand', 'Bình tích áp khí nén 3000L'], brands: ['Atlas Copco', 'Ingersoll Rand'], price: [85000000, 620000000], unit: 'Máy', life: 120, rate: 10 },
  { cat: 'BANG-TAI', names: ['Hệ thống băng tải con lăn 12m', 'Băng tải cao su nghiêng 8m', 'Băng tải PVC sản xuất lắp ráp'], brands: ['Đông Á', 'Việt Nhật'], price: [75000000, 420000000], unit: 'Bộ', life: 120, rate: 10 },
  { cat: 'O-TO', names: ['Xe ô tô Toyota Camry 2.5Q', 'Xe ô tô Ford Transit 16 chỗ', 'Xe tải Hyundai Mighty N250', 'Xe bán tải Ford Ranger Wildtrak'], brands: ['Toyota', 'Ford', 'Hyundai'], price: [680000000, 1450000000], unit: 'Chiếc', life: 120, rate: 10 },
  { cat: 'XE-NANG', names: ['Xe nâng điện Toyota 8FBE20', 'Xe nâng dầu Komatsu FD30T-17', 'Xe nâng tay cao 2.5 tấn'], brands: ['Toyota', 'Komatsu'], price: [45000000, 780000000], unit: 'Chiếc', life: 96, rate: 12 },
  { cat: 'SERVER', names: ['Máy chủ Dell PowerEdge R750', 'Thiết bị lưu trữ NAS Synology RS3621', 'Tủ rack 42U kèm PDU'], brands: ['Dell', 'Synology', 'APC'], price: [42000000, 680000000], unit: 'Bộ', life: 60, rate: 20 },
  { cat: 'THIET-BI-MANG', names: ['Switch Cisco Catalyst 2960X 48 port', 'Router Fortigate 100F', 'Thiết bị WiFi Aruba AP-515', 'Firewall Palo Alto PA-3220'], brands: ['Cisco', 'Fortinet', 'Aruba', 'Palo Alto'], price: [12000000, 350000000], unit: 'Bộ', life: 60, rate: 20 },
  { cat: 'CCDC', names: ['Máy khoan bê tông Bosch GBH 2-26', 'Máy hàn điện tử Jasic ARC-200', 'Bộ dụng cụ sửa chữa 108 chi tiết', 'Máy đo khoảng cách laser Bosch GLM 50'], brands: ['Bosch', 'Jasic', 'Total'], price: [1200000, 18500000], unit: 'Bộ', life: 24, rate: 50 },
  { cat: 'TS-VO-HINH', names: ['Phần mềm ERP SAP Business One (25 user)', 'Bản quyền Microsoft 365 Business (50 user)', 'Phần mềm thiết kế AutoCAD 2024 (5 seat)', 'Phần mềm quản lý kho WMS'], brands: ['SAP', 'Microsoft', 'Autodesk', 'Bình Minh'], price: [85000000, 980000000], unit: 'Bộ', life: 36, rate: 33 },
  { cat: 'THIET-BI-AN-TOAN', names: ['Hệ thống báo cháy địa chỉ 200 điểm', 'Bình chữa cháy CO2 5kg', 'Camera giám sát Hikvision DS-2CD', 'Đầu ghi hình 32 kênh Hikvision', 'Bộ đèn thoát hiểm khẩn cấp'], brands: ['Hochiki', 'Hikvision', 'Toàn Thắng'], price: [800000, 220000000], unit: 'Bộ', life: 60, rate: 20 },
  { cat: 'THIET-BI-KHO', names: ['Xe đẩy hàng 4 bánh 500kg', 'Kệ chứa hàng trung tải 6 tầng', 'Máy đóng gói carton bán tự động', 'Cân điện tử 300kg'], brands: ['Đông Á', 'Đài Loan', 'Việt Nam'], price: [2500000, 95000000], unit: 'Bộ', life: 96, rate: 12 },
  { cat: 'THIET-BI-Y-TE', names: ['Máy đo huyết áp điện tử Omron HEM-7136', 'Tủ thuốc y tế 2 cánh', 'Máy lọc nước uống RO công nghiệp'], brands: ['Omron', 'Karofi', 'Samsung'], price: [1200000, 48000000], unit: 'Cái', life: 84, rate: 14 },
];

const MAINTENANCE_ISSUES = [
  'Thiết bị phát tiếng ồn bất thường khi vận hành, cần kiểm tra vòng bi và hệ thống truyền động.',
  'Màn hình hiển thị lỗi, không khởi động được, nghi ngờ hỏng nguồn cấp.',
  'Rò rỉ dầu thuỷ lực tại đường ống cao áp, cần thay gioăng làm kín.',
  'Bụi bẩn tích tụ nhiều trong khoang làm mát, cần vệ sinh và bảo dưỡng định kỳ.',
  'Cảm biến an toàn hoạt động không ổn định, cần hiệu chỉnh lại.',
  'Đầu in bị kẹt giấy liên tục, cần kiểm tra rulo và bộ phận kéo giấy.',
  'Hệ thống điện chập chờn, cần kiểm tra Aptomat và dây dẫn.',
  'Độ chính xác gia công giảm, cần căn chỉnh lại trục chính.',
  'Ống dẫn khí nén rò rỉ, áp suất không đạt yêu cầu kỹ thuật.',
  'Bánh xe di chuyển bị mòn, cần thay thế để đảm bảo an toàn.',
];

const REPORT_TEMPLATES = [
  {
    code: 'MBC-001',
    name: 'Danh sách tài sản theo phòng ban',
    description: 'Báo cáo tổng hợp toàn bộ tài sản nhóm theo phòng ban, có tổng giá trị theo nhóm và tổng cộng.',
    dataset: 'assets',
    groupBy: 'departmentName',
    columns: [
      { key: 'code', label: 'Mã tài sản', w: 30, align: 'center' },
      { key: 'name', label: 'Tên tài sản', w: 62, align: 'left' },
      { key: 'categoryName', label: 'Danh mục', w: 34, align: 'left' },
      { key: 'locationName', label: 'Vị trí', w: 30, align: 'left' },
      { key: 'purchaseDate', label: 'Ngày mua', w: 22, align: 'center', format: 'date' },
      { key: 'originalCost', label: 'Nguyên giá', w: 30, align: 'right', format: 'money' },
      { key: 'bookValue', label: 'Giá trị còn lại', w: 30, align: 'right', format: 'money' },
    ],
  },
  {
    code: 'MBC-002',
    name: 'Bảng khấu hao tài sản theo kỳ',
    description: 'Tổng hợp khấu hao theo kỳ (tháng), nhóm theo kỳ kế toán.',
    dataset: 'v_depreciation_by_period',
    groupBy: 'period',
    columns: [
      { key: 'assetCode', label: 'Mã tài sản', w: 30, align: 'center' },
      { key: 'assetName', label: 'Tên tài sản', w: 62, align: 'left' },
      { key: 'departmentName', label: 'Phòng ban', w: 34, align: 'left' },
      { key: 'openingValue', label: 'Giá trị đầu kỳ', w: 30, align: 'right', format: 'money' },
      { key: 'depreciationAmount', label: 'Khấu hao kỳ', w: 30, align: 'right', format: 'money' },
      { key: 'accumulated', label: 'Hao mòn luỹ kế', w: 30, align: 'right', format: 'money' },
      { key: 'closingValue', label: 'Giá trị còn lại', w: 30, align: 'right', format: 'money' },
    ],
  },
  {
    code: 'MBC-003',
    name: 'Biên bản kiểm kê tài sản',
    description: 'Kết quả kiểm kê chi tiết theo từng đợt, có đối chiếu vị trí sổ sách và thực tế.',
    dataset: 'v_stocktake_result',
    groupBy: 'stocktakeCode',
    columns: [
      { key: 'assetCode', label: 'Mã tài sản', w: 28, align: 'center' },
      { key: 'assetName', label: 'Tên tài sản', w: 58, align: 'left' },
      { key: 'expectedLocationName', label: 'Vị trí sổ sách', w: 34, align: 'left' },
      { key: 'locationName', label: 'Vị trí thực tế', w: 34, align: 'left' },
      { key: 'assigneeName', label: 'Người sử dụng', w: 32, align: 'left' },
      { key: 'result', label: 'Kết quả', w: 24, align: 'center' },
      { key: 'countedByName', label: 'Người kiểm kê', w: 30, align: 'left' },
    ],
  },
  {
    code: 'MBC-004',
    name: 'Sổ theo dõi tài sản cố định',
    description: 'Sổ tài sản cố định đầy đủ thông tin: nguyên giá, khấu hao, giá trị còn lại, tình trạng sử dụng.',
    dataset: 'v_asset_full',
    columns: [
      { key: 'code', label: 'Mã tài sản', w: 28, align: 'center' },
      { key: 'name', label: 'Tên tài sản', w: 54, align: 'left' },
      { key: 'categoryName', label: 'Danh mục', w: 30, align: 'left' },
      { key: 'departmentName', label: 'Phòng ban', w: 30, align: 'left' },
      { key: 'assigneeName', label: 'Người sử dụng', w: 30, align: 'left' },
      { key: 'originalCost', label: 'Nguyên giá', w: 28, align: 'right', format: 'money' },
      { key: 'accumulatedDepreciation', label: 'Hao mòn', w: 26, align: 'right', format: 'money' },
      { key: 'bookValue', label: 'Còn lại', w: 28, align: 'right', format: 'money' },
      { key: 'depreciationProgress', label: '% KH', w: 16, align: 'center', format: 'number' },
    ],
  },
  {
    code: 'MBC-005',
    name: 'Giá trị tài sản theo phòng ban',
    description: 'Tổng hợp giá trị nguyên giá và giá trị còn lại của tài sản theo từng phòng ban.',
    dataset: 'v_asset_value_by_dept',
    columns: [
      { key: 'code', label: 'Mã PB', w: 24, align: 'center' },
      { key: 'name', label: 'Tên phòng ban', w: 62, align: 'left' },
      { key: 'managerName', label: 'Trưởng bộ phận', w: 44, align: 'left' },
      { key: 'assetCount', label: 'Số tài sản', w: 24, align: 'center', format: 'number' },
      { key: 'originalValue', label: 'Nguyên giá', w: 34, align: 'right', format: 'money' },
      { key: 'totalValue', label: 'Giá trị còn lại', w: 34, align: 'right', format: 'money' },
    ],
  },
  {
    code: 'MBC-006',
    name: 'Lịch sử bảo trì & chi phí',
    description: 'Danh sách các lần bảo trì - sửa chữa kèm chi phí, nhóm theo phòng ban.',
    dataset: 'v_maintenance_history',
    groupBy: 'departmentName',
    columns: [
      { key: 'code', label: 'Số phiếu', w: 26, align: 'center' },
      { key: 'assetCode', label: 'Mã TS', w: 26, align: 'center' },
      { key: 'assetName', label: 'Tên tài sản', w: 54, align: 'left' },
      { key: 'type', label: 'Loại', w: 26, align: 'center' },
      { key: 'actualDate', label: 'Ngày TH', w: 24, align: 'center', format: 'date' },
      { key: 'vendorName', label: 'Đơn vị thực hiện', w: 40, align: 'left' },
      { key: 'cost', label: 'Chi phí', w: 26, align: 'right', format: 'money' },
      { key: 'partsCost', label: 'Vật tư', w: 24, align: 'right', format: 'money' },
      { key: 'totalCost', label: 'Tổng', w: 28, align: 'right', format: 'money' },
    ],
  },
  {
    code: 'MBC-007',
    name: 'Tài sản đang sử dụng theo nhân viên',
    description: 'Danh sách nhân viên và tài sản đang được giao quản lý, sử dụng (dùng để ký xác nhận).',
    dataset: 'v_user_assets',
    columns: [
      { key: 'employeeCode', label: 'Mã NV', w: 26, align: 'center' },
      { key: 'fullName', label: 'Họ và tên', w: 44, align: 'left' },
      { key: 'departmentName', label: 'Phòng ban', w: 44, align: 'left' },
      { key: 'position', label: 'Chức vụ', w: 40, align: 'left' },
      { key: 'assetCount', label: 'Số tài sản', w: 24, align: 'center', format: 'number' },
      { key: 'assetValue', label: 'Tổng giá trị còn lại', w: 38, align: 'right', format: 'money' },
    ],
  },
  {
    code: 'MBC-008',
    name: 'Báo cáo thanh lý tài sản',
    description: 'Tổng hợp các tài sản đã thanh lý: nguyên giá, giá trị còn lại, giá bán và lãi/lỗ.',
    dataset: 'disposals',
    columns: [
      { key: 'code', label: 'Số phiếu', w: 26, align: 'center' },
      { key: 'assetCode', label: 'Mã TS', w: 26, align: 'center' },
      { key: 'assetName', label: 'Tên tài sản', w: 52, align: 'left' },
      { key: 'date', label: 'Ngày TL', w: 22, align: 'center', format: 'date' },
      { key: 'originalCost', label: 'Nguyên giá', w: 30, align: 'right', format: 'money' },
      { key: 'bookValue', label: 'Giá trị còn lại', w: 30, align: 'right', format: 'money' },
      { key: 'salePrice', label: 'Giá bán', w: 28, align: 'right', format: 'money' },
      { key: 'profitLoss', label: 'Lãi/(Lỗ)', w: 28, align: 'right', format: 'money' },
    ],
  },
];

/* ------------------------- Tạo mẫu thiết kế báo cáo ------------------------- */

function buildDesign(spec) {
  const cols = spec.columns || [];
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  const base = reports.blankDesign({ paperSize: 'A4', orientation: totalW > 200 ? 'landscape' : 'portrait', title: spec.name.toUpperCase() });
  const size = { portrait: 210, landscape: 297 }[base.orientation] || 210;
  const contentWidth = size - 24;
  const scale = contentWidth / totalW;
  let x = 0;
  const colElems = [];
  const detailElems = [];
  cols.forEach((c, i) => {
    const w = c.w * scale;
    colElems.push(
      Object.assign(
        {
          id: 'c' + i,
          type: 'field',
          x,
          y: 0,
          w,
          h: 9,
          field: c.key,
          label: c.label,
          align: c.align || 'left',
          bold: true,
          fontSize: 8.5,
          bgColor: '#dbeafe',
          border: true,
          borderColor: '#94a3b8',
          format: c.format || 'text',
          valign: 'middle',
        },
        {}
      )
    );
    detailElems.push({
      id: 'd' + i,
      type: 'field',
      x,
      y: 0,
      w,
      h: 7,
      field: c.key,
      align: c.align || 'left',
      fontSize: 8.5,
      border: true,
      borderColor: '#cbd5e1',
      format: c.format || 'text',
      valign: 'middle',
      wrap: false,
    });
    x += w;
  });

  base.bands.columnHeader = { height: 9, elements: colElems };
  base.bands.detail = { height: 7, elements: detailElems };
  base.bands.reportTitle = {
    height: 26,
    elements: [
      { id: 't1', type: 'text', x: 0, y: 0, w: contentWidth, h: 6, text: '{company.name}', fontSize: 10.5, bold: true, align: 'center', uppercase: true, color: '#1e3a8a' },
      { id: 't2', type: 'text', x: 0, y: 5.5, w: contentWidth, h: 5, text: 'Địa chỉ: {company.address} — ĐT: {company.phone} — MST: {company.taxCode}', fontSize: 8, align: 'center', color: '#64748b' },
      { id: 't3', type: 'text', x: 0, y: 12, w: contentWidth, h: 8, text: spec.name.toUpperCase(), fontSize: 15, bold: true, align: 'center', uppercase: true, color: '#0f172a' },
      { id: 't4', type: 'text', x: 0, y: 19.5, w: contentWidth, h: 4.5, text: 'Kỳ báo cáo: từ ngày {params.fromDate} đến ngày {params.toDate}', fontSize: 8.5, align: 'center', italic: true, color: '#475569' },
      { id: 't5', type: 'text', x: 0, y: 23.5, w: contentWidth, h: 4, text: 'Ngày in: {date} {time} — Người in: {user.fullName}', fontSize: 8, align: 'right', italic: true, color: '#6b7280' },
    ],
  };
  if (spec.groupBy) {
    base.groups = [{ field: spec.groupBy, label: spec.groupBy }];
    base.bands.groupHeader = {
      height: 8,
      elements: [
        {
          id: 'g1',
          type: 'text',
          x: 0,
          y: 0,
          w: contentWidth,
          h: 8,
          text: '▸ NHÓM: {groupValue}',
          fontSize: 9.5,
          bold: true,
          bgColor: '#f1f5f9',
          border: true,
          borderColor: '#94a3b8',
          align: 'left',
        },
      ],
    };
    const moneyCols = cols.filter((c) => c.format === 'money' || c.format === 'number');
    base.bands.groupFooter = {
      height: 8,
      elements: [
        { id: 'gf1', type: 'text', x: 0, y: 0, w: contentWidth * 0.55, h: 8, text: 'Cộng nhóm ({COUNT(group)} dòng):', fontSize: 9, bold: true, align: 'right', bgColor: '#f8fafc', border: true },
        {
          id: 'gf2',
          type: 'expr',
          x: contentWidth * 0.55,
          y: 0,
          w: contentWidth * 0.45,
          h: 8,
          expr: moneyCols.length ? '{SUM(' + moneyCols[moneyCols.length - 1].key + ',group)}' : '{COUNT(group)}',
          fontSize: 9,
          bold: true,
          align: 'right',
          bgColor: '#f8fafc',
          border: true,
          format: 'money',
        },
      ],
    };
  }
  const totalMoney = cols.filter((c) => c.format === 'money');
  base.bands.reportFooter = {
    height: 30,
    elements: [
      {
        id: 'r1',
        type: 'expr',
        x: 0,
        y: 0,
        w: contentWidth,
        h: 8,
        expr: totalMoney.length
          ? 'TỔNG CỘNG TOÀN BÁO CÁO: {COUNT()} bản ghi — Tổng ' + totalMoney[totalMoney.length - 1].label + ': {SUM(' + totalMoney[totalMoney.length - 1].key + ')}'
          : 'TỔNG CỘNG: {COUNT()} bản ghi',
        fontSize: 10.5,
        bold: true,
        align: 'left',
        bgColor: '#eff6ff',
        border: true,
        borderColor: '#2563eb',
        format: 'text',
      },
      { id: 'r2', type: 'text', x: 0, y: 12, w: contentWidth / 3, h: 16, text: 'Người lập biểu\n(Ký, họ tên)', align: 'center', fontSize: 9, wrap: true, color: '#334155' },
      { id: 'r3', type: 'text', x: contentWidth / 3, y: 12, w: contentWidth / 3, h: 16, text: 'Kế toán trưởng\n(Ký, họ tên)', align: 'center', fontSize: 9, wrap: true, color: '#334155' },
      { id: 'r4', type: 'text', x: (contentWidth * 2) / 3, y: 12, w: contentWidth / 3, h: 16, text: 'Giám đốc\n(Ký, họ tên, đóng dấu)', align: 'center', fontSize: 9, wrap: true, color: '#334155' },
    ],
  };
  const deptParam = { name: 'departmentId', label: 'Phòng ban', type: 'ref', ref: 'departments', applyTo: 'departmentId', op: '=', required: false, default: '' };
  // Tham số phải phù hợp với từng nguồn dữ liệu (tránh lọc theo trường không tồn tại)
  const parameterSets = {
    assets: [
      { name: 'fromDate', label: 'Từ ngày mua', type: 'date', applyTo: 'purchaseDate', op: '>=', required: false, default: '' },
      { name: 'toDate', label: 'Đến ngày mua', type: 'date', applyTo: 'purchaseDate', op: '<=', required: false, default: '' },
      deptParam,
    ],
    v_asset_full: [
      { name: 'fromDate', label: 'Từ ngày mua', type: 'date', applyTo: 'purchaseDate', op: '>=', required: false, default: '' },
      { name: 'toDate', label: 'Đến ngày mua', type: 'date', applyTo: 'purchaseDate', op: '<=', required: false, default: '' },
      deptParam,
    ],
    depreciations: [
      { name: 'fromPeriod', label: 'Từ kỳ (YYYY-MM)', type: 'text', applyTo: 'period', op: '>=', required: false, default: '' },
      { name: 'toPeriod', label: 'Đến kỳ (YYYY-MM)', type: 'text', applyTo: 'period', op: '<=', required: false, default: '' },
    ],
    v_depreciation_by_period: [
      { name: 'fromPeriod', label: 'Từ kỳ (YYYY-MM)', type: 'text', applyTo: 'period', op: '>=', required: false, default: '' },
      { name: 'toPeriod', label: 'Đến kỳ (YYYY-MM)', type: 'text', applyTo: 'period', op: '<=', required: false, default: '' },
    ],
    v_asset_ledger: [
      { name: 'fromPeriod', label: 'Từ kỳ (YYYY-MM)', type: 'text', applyTo: 'period', op: '>=', required: false, default: '' },
      { name: 'toPeriod', label: 'Đến kỳ (YYYY-MM)', type: 'text', applyTo: 'period', op: '<=', required: false, default: '' },
    ],
    v_asset_value_by_dept: [
      { name: 'departmentId', label: 'Phòng ban', type: 'ref', ref: 'departments', applyTo: 'id', op: '=', required: false, default: '' },
    ],
    v_user_assets: [deptParam, { name: 'keyword', label: 'Tìm theo họ tên', type: 'text', applyTo: 'fullName', op: 'like', required: false, default: '' }],
    v_stocktake_result: [{ name: 'stocktakeId', label: 'Đợt kiểm kê', type: 'ref', ref: 'stocktakes', applyTo: 'stocktakeId', op: '=', required: false, default: '' }],
    maintenances: [
      { name: 'fromDate', label: 'Từ ngày', type: 'date', applyTo: 'actualDate', op: '>=', required: false, default: '' },
      { name: 'toDate', label: 'Đến ngày', type: 'date', applyTo: 'actualDate', op: '<=', required: false, default: '' },
      { name: 'status', label: 'Trạng thái', type: 'text', applyTo: 'status', op: '=', required: false, default: '' },
    ],
    v_maintenance_history: [
      { name: 'fromDate', label: 'Từ ngày', type: 'date', applyTo: 'actualDate', op: '>=', required: false, default: '' },
      { name: 'toDate', label: 'Đến ngày', type: 'date', applyTo: 'actualDate', op: '<=', required: false, default: '' },
    ],
    disposals: [
      { name: 'fromDate', label: 'Từ ngày', type: 'date', applyTo: 'date', op: '>=', required: false, default: '' },
      { name: 'toDate', label: 'Đến ngày', type: 'date', applyTo: 'date', op: '<=', required: false, default: '' },
    ],
    contracts: [{ name: 'keyword', label: 'Tìm theo số/tên hợp đồng', type: 'text', applyTo: 'name', op: 'like', required: false, default: '' }],
    warranties: [{ name: 'keyword', label: 'Tìm theo đơn vị bảo hành', type: 'text', applyTo: 'provider', op: 'like', required: false, default: '' }],
  };
  base.parameters = parameterSets[spec.dataset] || [];
  // Dòng mô tả kỳ báo cáo phải khớp với tham số của từng nguồn dữ liệu
  const titleBand = base.bands.reportTitle;
  const t4 = titleBand.elements.find((e) => e.id === 't4');
  if (t4) {
    if (base.parameters.some((x) => x.name === 'fromDate')) t4.text = 'Kỳ báo cáo: từ ngày {params.fromDate} đến ngày {params.toDate}';
    else if (base.parameters.some((x) => x.name === 'fromPeriod')) t4.text = 'Kỳ báo cáo: từ {params.fromPeriod} đến {params.toPeriod}';
    else t4.text = 'Ngày lập báo cáo: {date}';
  }
  return base;
}

/* ------------------------------ CHẠY SEED ------------------------------ */

function run(opts) {
  const o = opts || {};
  if (o.fresh) store.reset();
  if (!store.isEmpty() && !o.force) return { skipped: true };

  seedValue = o.seedValue || 20240919;
  const now = new Date();
  const cfg = schema.DEFAULT_SETTINGS;
  const passwordSaltHash = (p) => auth.hashPassword(p);

  /* -------- Cấu hình -------- */
  store.insert('settings', { key: 'company', value: util.clone(cfg.company) });
  store.insert('settings', { key: 'system', value: util.clone(cfg.system) });
  store.insert('settings', { key: 'numbering', value: util.clone(cfg.numbering) });
  store.insert('settings', { key: 'depreciation', value: util.clone(cfg.depreciation) });
  store.insert('settings', { key: 'notifications', value: util.clone(cfg.notifications) });
  store.insert('settings', { key: 'report', value: util.clone(cfg.report) });

  /* -------- Vai trò -------- */
  const perm = schema.permissionsFor;
  const allModules = schema.PERMISSION_MODULES.map((m) => m.key);
  const roles = [
    {
      code: 'ADMIN',
      name: 'Quản trị hệ thống',
      description: 'Toàn quyền trên mọi module, quản lý người dùng, phân quyền, sao lưu và cấu hình hệ thống.',
      permissions: schema.fullPermissions(),
      dataScope: 'all',
      isSystem: true,
    },
    {
      code: 'MANAGER',
      name: 'Ban Giám đốc / Quản lý',
      description: 'Xem toàn bộ dữ liệu, phê duyệt các phiếu điều chuyển - thanh lý - bảo trì, xem & in báo cáo.',
      permissions: Object.assign(schema.permissionsFor(['dashboard', 'assets', 'categories', 'suppliers', 'departments', 'locations', 'assignments', 'transfers', 'maintenances', 'depreciations', 'stocktakes', 'disposals', 'warranties', 'contracts', 'reports', 'attachments'], ['view', 'create', 'update', 'approve', 'export']), {}),
      dataScope: 'all',
      isSystem: false,
    },
    {
      code: 'ACCOUNTANT',
      name: 'Kế toán tài sản',
      description: 'Quản lý tài sản, khấu hao, thanh lý, hợp đồng, xuất - in báo cáo kế toán.',
      permissions: Object.assign(
        schema.permissionsFor(['dashboard', 'assets', 'categories', 'suppliers', 'departments', 'locations', 'depreciations', 'disposals', 'contracts', 'reports', 'attachments', 'warranties'], ['view', 'create', 'update', 'export']),
        { depreciations: ['view', 'create', 'update', 'delete', 'approve', 'export'], disposals: ['view', 'create', 'update', 'export'] }
      ),
      dataScope: 'all',
      isSystem: false,
    },
    {
      code: 'WAREHOUSE',
      name: 'Thủ kho / Quản lý tài sản',
      description: 'Quản lý kho, cấp phát - thu hồi, điều chuyển, kiểm kê, in nhãn tài sản.',
      permissions: Object.assign(
        schema.permissionsFor(['dashboard', 'assets', 'categories', 'locations', 'assignments', 'transfers', 'stocktakes', 'maintenances', 'attachments', 'reports'], ['view', 'create', 'update', 'export']),
        { stocktakes: ['view', 'create', 'update', 'delete', 'approve', 'export'] }
      ),
      dataScope: 'all',
      isSystem: false,
    },
    {
      code: 'TECHNICIAN',
      name: 'Kỹ thuật viên / Bảo trì',
      description: 'Tiếp nhận và xử lý phiếu bảo trì, sửa chữa, cập nhật tình trạng kỹ thuật tài sản.',
      permissions: Object.assign(
        schema.permissionsFor(['dashboard', 'assets', 'maintenances', 'warranties', 'locations', 'attachments', 'reports'], ['view', 'create', 'update', 'export']),
        { maintenances: ['view', 'create', 'update', 'delete', 'approve', 'export'] }
      ),
      dataScope: 'all',
      isSystem: false,
    },
    {
      code: 'VIEWER',
      name: 'Nhân viên (chỉ xem)',
      description: 'Chỉ xem tài sản được giao cho mình và các báo cáo được phép.',
      permissions: Object.assign(schema.permissionsFor(['dashboard', 'assets', 'assignments', 'maintenances', 'warranties', 'reports'], ['view']), { reports: ['view', 'export'] }),
      dataScope: 'own',
      isSystem: false,
    },
  ];
  roles.forEach((r) => store.insert('roles', r));
  const roleByCode = {};
  store.all('roles').forEach((r) => (roleByCode[r.code] = r.id));

  /* -------- Phòng ban -------- */
  DEPARTMENTS.forEach((d) => {
    store.insert('departments', {
      code: d.code,
      name: d.name,
      phone: d.phone,
      email: d.email,
      costCenter: d.costCenter,
      budgetYear: d.budgetYear,
      parentId: null,
      note: '',
    });
  });
  const deptByCode = {};
  store.all('departments').forEach((d) => (deptByCode[d.code] = d.id));

  /* -------- Người dùng -------- */
  let userSeq = 0;
  USERS.forEach((u, idx) => {
    userSeq += 1;
    const pass = u.password || 'User@123';
    const { salt, hash } = passwordSaltHash(pass);
    store.insert('users', {
      employeeCode: 'NV' + util.pad(userSeq, 4),
      username: u.username,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      departmentId: deptByCode[u.dept] || null,
      position: u.position,
      roleId: roleByCode[u.role],
      managerId: null,
      status: idx === 16 ? 'pending' : 'active',
      joinDate: daysAgo(int(400, 3000)),
      passwordSalt: salt,
      passwordHash: hash,
      mustChangePassword: false,
      failedAttempts: 0,
      lastLoginAt: idx < 8 ? isoAgo(int(0, 12)) : null,
      note: '',
      avatar: '',
    });
  });
  const users = store.all('users');
  const userByUsername = {};
  users.forEach((u) => (userByUsername[u.username] = u));
  // Cập nhật trưởng bộ phận
  const managerMap = {
    BGD: 'admin',
    HCNS: 'ns.01',
    KTTC: 'ketoan.truong',
    CNTT: 'cntt.01',
    KDT: 'kd.01',
    SX1: 'sx.01',
    SX2: 'sx.02',
    QA: 'qa.01',
    KHO: 'thukho',
  };
  Object.keys(managerMap).forEach((code) => {
    const dept = store.findOne('departments', (d) => d.code === code);
    const mgr = userByUsername[managerMap[code]];
    if (dept && mgr) store.update('departments', dept.id, { managerId: mgr.id });
  });

  /* -------- Danh mục tài sản -------- */
  CATEGORIES.forEach((c) =>
    store.insert('categories', {
      code: c.code,
      name: c.name,
      parentId: c.parent ? null : null,
      description: 'Danh mục ' + c.name.toLowerCase() + ' phục vụ quản lý tài sản và tính khấu hao.',
      defaultUsefulLife: c.life,
      defaultDepreciationRate: c.rate,
      defaultType: c.type,
      maintenanceCycleDays: c.cycle,
      note: '',
    })
  );
  const catByCode = {};
  store.all('categories').forEach((c) => (catByCode[c.code] = c.id));
  CATEGORIES.filter((c) => c.parent).forEach((c) => store.update('categories', catByCode[c.code], { parentId: catByCode[c.parent] }));

  /* -------- Vị trí / Kho -------- */
  LOCATIONS.forEach((l) =>
    store.insert('locations', {
      code: l.code,
      name: l.name,
      type: l.type,
      parentId: l.parent ? catByCode[l.parent] || null : null,
      address: l.address || cfg.company.address,
      capacity: l.capacity || 0,
      managerId: userByUsername['thukho'].id,
      note: '',
    })
  );
  LOCATIONS.filter((l) => l.parent).forEach((l) => {
    const loc = store.findOne('locations', (x) => x.code === l.code);
    const parent = store.findOne('locations', (x) => x.code === l.parent);
    if (loc && parent) store.update('locations', loc.id, { parentId: parent.id });
  });
  const locByCode = {};
  store.all('locations').forEach((l) => (locByCode[l.code] = l.id));

  /* -------- Nhà cung cấp -------- */
  SUPPLIERS.forEach((s) =>
    store.insert('suppliers', {
      code: s.code,
      name: s.name,
      taxCode: s.tax,
      contactName: s.contact,
      phone: s.phone,
      email: s.email,
      address: s.address,
      bankAccount: s.bank,
      bankName: (s.bank || '').split(' - ')[0],
      rating: s.rating,
      note: '',
    })
  );
  const supplierByCode = {};
  store.all('suppliers').forEach((s) => (supplierByCode[s.code] = s.id));

  /* -------- Hợp đồng -------- */
  const CONTRACTS = [
    { code: 'HD-2024-0001', name: 'Hợp đồng mua sắm thiết bị CNTT đợt 1/2024', type: 'purchase', supplier: 'NCC001', value: 2850000000, signDate: daysAgo(500), endDate: daysAgo(-260) },
    { code: 'HD-2024-0002', name: 'Hợp đồng cung cấp máy CNC trung tâm gia công', type: 'purchase', supplier: 'NCC003', value: 12500000000, signDate: daysAgo(620), endDate: daysAgo(-120) },
    { code: 'HD-2024-0003', name: 'Hợp đồng mua sắm xe tải & phương tiện vận chuyển', type: 'purchase', supplier: 'NCC006', value: 6800000000, signDate: daysAgo(430), endDate: daysAgo(-330) },
    { code: 'HD-2024-0004', name: 'Hợp đồng triển khai phần mềm ERP SAP Business One', type: 'service', supplier: 'NCC005', value: 1450000000, signDate: daysAgo(300), endDate: daysAgo(-60) },
    { code: 'HD-2023-0005', name: 'Hợp đồng bảo trì hệ thống máy nén khí (năm 2023-2024)', type: 'service', supplier: 'NCC007', value: 480000000, signDate: daysAgo(700), endDate: daysAgo(30) },
    { code: 'HD-2024-0006', name: 'Hợp đồng mua sắm nội thất văn phòng tầng 3', type: 'purchase', supplier: 'NCC008', value: 920000000, signDate: daysAgo(220), endDate: daysAgo(-140) },
    { code: 'HD-2024-0007', name: 'Hợp đồng bảo hiểm tài sản toàn công ty 2024-2025', type: 'insurance', supplier: 'NCC010', value: 350000000, signDate: daysAgo(180), endDate: daysAgo(-180) },
    { code: 'HD-2024-0008', name: 'Hợp đồng cung cấp & lắp đặt hệ thống PCCC nhà máy B', type: 'construction', supplier: 'NCC009', value: 1180000000, signDate: daysAgo(360), endDate: daysAgo(-5) },
  ];
  CONTRACTS.forEach((c) =>
    store.insert('contracts', {
      code: c.code,
      name: c.name,
      type: c.type,
      supplierId: supplierByCode[c.supplier],
      signDate: c.signDate,
      startDate: c.signDate,
      endDate: c.endDate,
      value: c.value,
      currency: 'VND',
      paymentTerms: 'Thanh toán 30% sau khi ký hợp đồng, 60% khi nghiệm thu, 10% sau bảo hành 12 tháng.',
      status: new Date(c.endDate) < now ? 'expired' : 'active',
      note: '',
    })
  );
  const contractList = store.all('contracts');

  /* -------- Tài sản -------- */
  const departmentsForAssign = ['HCNS', 'KTTC', 'CNTT', 'KDT', 'SX1', 'SX2', 'QA', 'KHO'];
  const locationsByDept = {
    HCNS: 'A-T2-PNS',
    KTTC: 'A-T2-PKT',
    CNTT: 'A-T3-PKT',
    KDT: 'A-T2-PKD',
    SX1: 'B-X1',
    SX2: 'B-X2',
    QA: 'B-QA',
    KHO: 'KHO-TONG',
  };
  const usersByDept = {};
  users.forEach((u) => {
    const dept = store.find('departments', u.departmentId);
    if (!dept) return;
    usersByDept[dept.code] = usersByDept[dept.code] || [];
    usersByDept[dept.code].push(u);
  });

  let assetSeq = 0;
  const assets = [];
  const totalTarget = 132;
  let t = 0;
  while (assetSeq < totalTarget) {
    const tpl = ASSET_TEMPLATES[t % ASSET_TEMPLATES.length];
    const catId = catByCode[tpl.cat];
    const qty = tpl.unit === 'Bộ' && rnd() < 0.25 ? int(2, 8) : 1;
    const name = pick(tpl.names) + (qty > 1 ? ` (lô ${qty} ${tpl.unit.toLowerCase()})` : '');
    const price = int(tpl.price[0], tpl.price[1]);
    const roundPrice = Math.round(price / 100000) * 100000;
    const purchaseDate = daysAgo(int(20, 1900));
    const deptCode = pick(departmentsForAssign);
    const deptId = deptByCode[deptCode];
    const deptUsers = usersByDept[deptCode] || [];
    const assignee = deptUsers.length ? pick(deptUsers) : users[0];
    const statusRoll = rnd();
    const status =
      statusRoll < 0.6 ? 'in_use' : statusRoll < 0.72 ? 'in_stock' : statusRoll < 0.82 ? 'maintenance' : statusRoll < 0.87 ? 'allocated' : statusRoll < 0.92 ? 'warranty' : statusRoll < 0.96 ? 'pending_disposal' : 'damaged';
    const condition = status === 'damaged' ? pick(['poor', 'broken']) : status === 'maintenance' ? pick(['fair', 'good']) : pick(['new', 'good', 'good', 'good', 'fair']);
    const warrantyMonths = pick([12, 12, 24, 24, 36]);
    const usefulLife = tpl.life;
    const vat = pick([0, 8, 10, 10]);
    const supplierCodes = Object.keys(supplierByCode);
    const supplierId = supplierByCode[pick(supplierCodes)];
    const contract = contractList[assetSeq % contractList.length];
    const code = 'TS-' + now.getFullYear() + '-' + util.pad(assetSeq + 1, 5);
    const serial = 'SN' + int(10000000, 99999999) + tpl.cat.replace(/[^A-Z]/g, '').slice(0, 3);
    const record = store.insert('assets', {
      code,
      name,
      categoryId: catId,
      type: tpl.cat.includes('VO-HINH') ? 'intangible' : tpl.unit === 'Bộ' && tpl.cat === 'CCDC' ? 'tool' : 'fixed',
      status,
      condition,
      quantity: qty,
      unit: tpl.unit,
      model: pick(tpl.brands) + ' ' + int(100, 9999),
      serial,
      brand: pick(tpl.brands),
      origin: pick(['Việt Nam', 'Trung Quốc', 'Nhật Bản', 'Hàn Quốc', 'Đức', 'Mỹ', 'Đài Loan']),
      specs: 'Thông số kỹ thuật theo tài liệu kèm theo của nhà sản xuất ' + pick(tpl.brands) + '.',
      purchaseDate,
      supplierId,
      contractId: rnd() < 0.6 ? contract.id : null,
      invoiceNo: 'HD' + int(100000, 999999),
      invoiceDate: purchaseDate,
      purchasePrice: qty > 1 ? Math.round(roundPrice / qty) : roundPrice,
      vatPercent: vat,
      transportCost: rnd() < 0.4 ? Math.round(roundPrice * 0.01 / 100000) * 100000 : 0,
      installCost: tpl.price[0] > 50000000 ? Math.round(roundPrice * 0.02 / 100000) * 100000 : 0,
      otherCost: 0,
      depreciationMethod: pick(['straight_line', 'straight_line', 'straight_line', 'declining_balance', 'double_declining']),
      usefulLife,
      depreciationRate: tpl.rate,
      salvageValue: Math.round(roundPrice * (tpl.cat === 'O-TO' ? 0.1 : 0.05) / 100000) * 100000,
      depreciationStart: purchaseDate,
      warrantyMonths,
      warrantyStart: purchaseDate,
      insured: rnd() < 0.35,
      insuranceCompany: rnd() < 0.35 ? pick(['Bảo Việt', 'PVI', 'Bảo Minh', 'PTI']) : '',
      insuranceValue: rnd() < 0.35 ? roundPrice : 0,
      insuranceExpiry: dateStr(new Date(new Date(purchaseDate).getTime() + 365 * 86400000)),
      locationId: locByCode[locationsByDept[deptCode]] || locByCode['KHO-TONG'],
      departmentId: deptId,
      assigneeId: ['in_use', 'allocated'].includes(status) ? assignee.id : null,
      assignedDate: ['in_use', 'allocated'].includes(status) ? purchaseDate : null,
      responsibleId: (usersByDept[deptCode] && usersByDept[deptCode][0] ? usersByDept[deptCode][0].id : null),
      nextMaintenanceAt: daysAgo(int(-180, 200)),
      imageUrl: '',
      tags: [tpl.cat.toLowerCase(), deptCode.toLowerCase()],
      note: '',
      isDeleted: false,
    });
    assets.push(record);
    assetSeq += 1;
    t += 1;
  }

  /* -------- Khấu hao 12 kỳ gần nhất -------- */
  const periods = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.push(`${d.getFullYear()}-${util.pad(d.getMonth() + 1, 2)}`);
  }
  let depSeq = 0;
  assets.forEach((a) => {
    const startIdx = int(0, 3);
    periods.slice(startIdx).forEach((period) => {
      const upTo = new Date(period + '-28T23:59:59');
      const dec = service.decorateAsset(a, { upTo });
      const prevAcc = 0;
      const opening = Number(dec.originalCost || 0);
      const amount = Math.max(0, Math.min(dec.monthlyDepreciation, opening));
      const monthsIn = util.monthsBetween(a.depreciationStart || a.purchaseDate, upTo) + 1;
      if (monthsIn <= 0) return;
      const accumulated = Math.min(Math.round(dec.monthlyDepreciation * monthsIn), Math.round(dec.originalCost - (a.salvageValue || 0)));
      depSeq += 1;
      store.insert('depreciations', {
        code: 'KH-' + period.replace('-', '') + '-' + util.pad(depSeq, 5),
        period,
        assetId: a.id,
        assetCode: a.code,
        assetName: a.name,
        departmentName: service.nameOf('departments', a.departmentId),
        method: a.depreciationMethod,
        openingValue: Math.round(dec.originalCost - Math.round(dec.monthlyDepreciation * (monthsIn - 1))),
        depreciationAmount: Math.round(dec.monthlyDepreciation),
        accumulated,
        closingValue: Math.max(Number(a.salvageValue || 0), Math.round(dec.originalCost - accumulated)),
        expenseAccount: '642',
        assetAccount: '214',
        runBy: 'ketoan.ts',
        runAt: isoAgo(int(1, 360)),
        status: 'posted',
        note: 'Khấu hao tự động kỳ ' + period,
      });
      // Cập nhật hao mòn luỹ kế cuối kỳ vào tài sản (chỉ với kỳ mới nhất)
      if (period === periods[periods.length - 1]) {
        store.update('assets', a.id, { accumulatedDepreciation: accumulated, depreciationPeriods: monthsIn });
      }
    });
  });

  /* -------- Cấp phát / thu hồi -------- */
  const assignTypes = ['assign', 'assign', 'assign', 'recover', 'lend', 'return'];
  for (let i = 0; i < 68; i++) {
    const a = pick(assets);
    const type = pick(assignTypes);
    const toUser = pick(users.filter((u) => u.status === 'active'));
    const dept = store.find('departments', toUser.departmentId);
    const date = daysAgo(int(1, 900));
    store.insert('assignments', {
      code: 'CP-' + date.slice(0, 4) + date.slice(5, 7) + '-' + util.pad(i + 1, 4),
      type,
      assetId: a.id,
      assetCode: a.code,
      assetName: a.name,
      toUserId: type === 'recover' ? null : toUser.id,
      toUserName: type === 'recover' ? '' : toUser.fullName,
      fromUserId: userByUsername['thukho'].id,
      fromUserName: userByUsername['thukho'].fullName,
      departmentId: dept ? dept.id : null,
      departmentName: dept ? dept.name : '',
      locationId: a.locationId,
      date,
      expectedReturnDate: type === 'lend' ? dateStr(new Date(new Date(date).getTime() + 30 * 86400000)) : null,
      conditionAtHandover: pick(['new', 'good', 'good', 'fair']),
      accessories: pick(['Kèm túi chống sốc, sạc, chuột', 'Kèm đầy đủ phụ kiện theo hãng', 'Kèm hộp, sách hướng dẫn', 'Không']),
      purpose: pick(['Công tác văn phòng', 'Vận hành sản xuất', 'Họp và thuyết trình khách hàng', 'Kiểm tra chất lượng sản phẩm']),
      status: pick(['completed', 'completed', 'completed', 'pending', 'cancelled']),
      signatureReceiver: toUser.fullName,
      signatureGiver: userByUsername['thukho'].fullName,
      signatureManager: dept && dept.managerId ? service.nameOf('users', dept.managerId, 'fullName') : '',
      note: '',
    });
  }

  /* -------- Điều chuyển -------- */
  for (let i = 0; i < 22; i++) {
    const a = pick(assets);
    const fromDept = store.find('departments', a.departmentId);
    const toDept = pick(store.all('departments').filter((d) => d.id !== a.departmentId));
    const date = daysAgo(int(1, 400));
    const status = pick(['completed', 'completed', 'pending', 'approved', 'rejected']);
    store.insert('transfers', {
      code: 'DC-' + date.slice(0, 4) + date.slice(5, 7) + '-' + util.pad(i + 1, 4),
      assetId: a.id,
      assetCode: a.code,
      assetName: a.name,
      fromDepartmentId: fromDept ? fromDept.id : null,
      fromDepartmentName: fromDept ? fromDept.name : '',
      toDepartmentId: toDept.id,
      toDepartmentName: toDept.name,
      fromUserId: a.assigneeId,
      fromUserName: service.nameOf('users', a.assigneeId, 'fullName'),
      toUserId: (usersByDept[toDept.code] && usersByDept[toDept.code].length ? pick(usersByDept[toDept.code]).id : null),
      toUserName: '',
      fromLocationId: a.locationId,
      toLocationId: pick(store.all('locations')).id,
      date,
      reason: pick([
        'Tái cơ cấu tổ chức, chuyển bộ phận sử dụng tài sản theo yêu cầu của Ban Giám đốc.',
        'Bổ sung thiết bị cho dự án mới của phòng ban tiếp nhận.',
        'Tài sản nhàn rỗi, điều chuyển để tối ưu hiệu quả sử dụng.',
        'Thay thế thiết bị hư hỏng cho bộ phận tiếp nhận.',
        'Điều chuyển theo kế hoạch sắp xếp lại khu vực sản xuất.',
      ]),
      transportCost: rnd() < 0.4 ? int(2, 40) * 100000 : 0,
      status,
      requestedBy: pick(users).id,
      approvedBy: ['approved', 'completed'].includes(status) ? userByUsername['giamdoc'].id : null,
      approvedAt: ['approved', 'completed'].includes(status) ? isoAgo(int(1, 300)) : null,
      completedAt: status === 'completed' ? isoAgo(int(0, 200)) : null,
      rejectReason: status === 'rejected' ? 'Chưa phù hợp kế hoạch sử dụng tài sản quý này' : '',
      note: '',
    });
  }

  /* -------- Bảo trì -------- */
  for (let i = 0; i < 64; i++) {
    const a = pick(assets);
    const type = pick(['preventive', 'preventive', 'corrective', 'inspection', 'calibration', 'upgrade']);
    const reported = daysAgo(int(5, 700));
    const planned = dateStr(new Date(new Date(reported).getTime() + 3 * 86400000));
    const done = rnd() < 0.75;
    const status = done ? pick(['completed', 'completed', 'completed', 'in_progress']) : pick(['pending', 'approved']);
    const cost = type === 'preventive' ? int(5, 60) * 100000 : int(15, 250) * 100000;
    const warrantyClaim = rnd() < 0.15;
    store.insert('maintenances', {
      code: 'BT-' + reported.slice(0, 4) + reported.slice(5, 7) + '-' + util.pad(i + 1, 4),
      assetId: a.id,
      assetCode: a.code,
      assetName: a.name,
      type,
      priority: pick(['low', 'normal', 'normal', 'high', 'urgent']),
      reportedDate: reported,
      plannedDate: planned,
      actualDate: done ? dateStr(new Date(new Date(planned).getTime() + int(0, 5) * 86400000)) : null,
      description: pick(MAINTENANCE_ISSUES),
      solution: pick([
        'Thay thế linh kiện hỏng, vệ sinh và căn chỉnh lại thiết bị.',
        'Bảo dưỡng định kỳ theo khuyến nghị của nhà sản xuất, thay dầu mỡ và lọc.',
        'Hiệu chỉnh thông số kỹ thuật, cập nhật firmware mới nhất.',
        'Thay thế bộ phận mài mòn, kiểm tra toàn bộ hệ thống an toàn.',
      ]),
      result: done ? pick(['Thiết bị hoạt động ổn định, đạt yêu cầu kỹ thuật.', 'Đã khắc phục hoàn toàn sự cố, thiết bị vận hành bình thường.', 'Thiết bị hoạt động tốt, đã kiểm tra và xác nhận an toàn.']) : '',
      vendorId: rnd() < 0.6 ? pick(store.all('suppliers')).id : null,
      technician: pick(['Đặng Quốc Bảo', 'Nguyễn Trung Kiên', 'Trần Văn Hùng', 'Đội kỹ thuật nội bộ']),
      cost: warrantyClaim ? 0 : cost,
      partsCost: warrantyClaim ? 0 : (rnd() < 0.5 ? int(3, 80) * 100000 : 0),
      downtimeHours: int(1, 72),
      status,
      conditionAfter: done ? pick(['good', 'good', 'fair']) : null,
      warrantyClaim,
      isRecurring: type === 'preventive',
      cycleDays: type === 'preventive' ? pick([90, 180, 365]) : 0,
      nextDueDate: type === 'preventive' ? daysAgo(-int(10, 200)) : null,
      note: '',
    });
  }

  /* -------- Bảo hành -------- */
  for (let i = 0; i < 34; i++) {
    const a = pick(assets);
    const start = a.purchaseDate;
    const end = dateStr(new Date(new Date(start).getTime() + (a.warrantyMonths || 12) * 30 * 86400000));
    const remaining = util.diffDays(end, now);
    const status = remaining < 0 ? 'expired' : remaining <= 30 ? 'expiring' : pick(['active', 'active', 'active', 'claimed', 'resolved']);
    store.insert('warranties', {
      code: 'BH-' + util.pad(i + 1, 4),
      assetId: a.id,
      assetCode: a.code,
      assetName: a.name,
      provider: a.brand ? 'Trung tâm bảo hành ' + a.brand : pick(store.all('suppliers')).name,
      supplierId: a.supplierId,
      startDate: start,
      endDate: end,
      coverage: pick(['Bảo hành 12 tháng theo tiêu chuẩn nhà sản xuất, không bao gồm hao mòn tự nhiên.', 'Bảo hành 24 tháng, hỗ trợ kỹ thuật tại chỗ trong 48 giờ.', 'Bảo hành 36 tháng cho linh kiện chính, 12 tháng cho phụ kiện.']),
      claimCount: status === 'claimed' || status === 'resolved' ? int(1, 4) : 0,
      issue: status === 'claimed' || status === 'resolved' ? pick(MAINTENANCE_ISSUES) : '',
      resolution: status === 'resolved' ? 'Nhà cung cấp đã thay thế linh kiện miễn phí trong thời gian bảo hành.' : '',
      claimDate: status === 'claimed' || status === 'resolved' ? daysAgo(int(10, 200)) : null,
      resolvedDate: status === 'resolved' ? daysAgo(int(1, 9)) : null,
      cost: status === 'claimed' ? int(0, 20) * 100000 : 0,
      status,
      note: '',
    });
  }

  /* -------- Kiểm kê -------- */
  const st1 = store.insert('stocktakes', {
    code: 'KK-2025-001',
    name: 'Kiểm kê tài sản định kỳ Quý 2/2025 - Toàn công ty',
    startDate: daysAgo(90),
    endDate: daysAgo(75),
    scope: 'all',
    leaderId: userByUsername['thukho'].id,
    members: ['Phạm Văn Hải', 'Lê Thị Ngọc', 'Hoàng Anh Tuấn', 'Bùi Thanh Vân'],
    status: 'closed',
    closedAt: isoAgo(74),
    note: 'Kiểm kê định kỳ theo kế hoạch năm, tập trung vào thiết bị CNTT và phương tiện.',
  });
  const stItems = (s, count, dateBase, closed) =>
    assets.slice(0, count).forEach((a, idx) => {
      const r = rnd();
      const result = r < 0.82 ? 'match' : r < 0.88 ? 'wrong_location' : r < 0.93 ? 'missing' : r < 0.97 ? 'damaged' : 'extra';
      const counted = closed ? true : rnd() < 0.55;
      store.insert('stocktake_items', {
        stocktakeId: s.id,
        assetId: a.id,
        assetCode: a.code,
        assetName: a.name,
        expectedLocationId: a.locationId,
        expectedLocationName: service.nameOf('locations', a.locationId),
        locationId: result === 'wrong_location' ? pick(store.all('locations')).id : a.locationId,
        locationName: result === 'wrong_location' ? pick(store.all('locations')).name : service.nameOf('locations', a.locationId),
        assigneeId: a.assigneeId,
        assigneeName: service.nameOf('users', a.assigneeId, 'fullName'),
        bookQty: Number(a.quantity) || 1,
        countedQty: counted ? (result === 'missing' ? 0 : Number(a.quantity) || 1) : null,
        counted,
        result,
        conditionFound: result === 'damaged' ? 'broken' : a.condition,
        countedBy: userByUsername['thukho'].id,
        countedAt: closed ? isoAgo(int(75, 90)) : rnd() < 0.55 ? isoAgo(int(1, 20)) : null,
        note: result === 'missing' ? 'Không tìm thấy tại vị trí ghi nhận, cần xác minh.' : '',
      });
    });
  stItems(st1, 96, 80, true);
  store.update('stocktakes', st1.id, {
    totalItems: 96,
    countedItems: 96,
    diffItems: 14,
  });

  const st2 = store.insert('stocktakes', {
    code: 'KK-2025-002',
    name: 'Kiểm kê đột xuất thiết bị CNTT - Phòng CNTT',
    startDate: daysAgo(12),
    endDate: daysAgo(-3),
    scope: 'department',
    departmentId: deptByCode['CNTT'],
    leaderId: userByUsername['cntt.01'].id,
    members: ['Hoàng Anh Tuấn', 'Vũ Thị Lan'],
    status: 'open',
    note: 'Kiểm kê theo yêu cầu của Ban Giám đốc sau khi sắp xếp lại văn phòng tầng 3.',
  });
  stItems(st2, 14, 10, false);
  const st2Items = store.filter('stocktake_items', (i) => i.stocktakeId === st2.id);
  store.update('stocktakes', st2.id, {
    totalItems: st2Items.length,
    countedItems: st2Items.filter((i) => i.counted).length,
    diffItems: st2Items.filter((i) => i.counted && i.result !== 'match').length,
  });

  /* -------- Thanh lý -------- */
  const disposalAssets = assets.slice(-14);
  disposalAssets.forEach((a, i) => {
    const date = daysAgo(int(5, 320));
    const status = pick(['completed', 'completed', 'pending', 'approved', 'rejected']);
    const dec = service.decorateAsset(a);
    const salePrice = Math.round((dec.bookValue || dec.originalCost * 0.05) * (0.5 + rnd())) ;
    store.insert('disposals', {
      code: 'TL-' + date.slice(0, 4) + '-' + util.pad(i + 1, 4),
      assetId: a.id,
      assetCode: a.code,
      assetName: a.name,
      type: pick(['sale', 'sale', 'scrap', 'donate', 'destroy', 'writeoff']),
      date,
      bookValue: dec.bookValue,
      originalCost: dec.originalCost,
      accumulated: dec.accumulatedDepreciation,
      salePrice,
      disposalCost: rnd() < 0.5 ? int(1, 30) * 100000 : 0,
      reason: pick([
        'Tài sản đã khấu hao hết, hư hỏng không còn khả năng sửa chữa.',
        'Thiết bị lạc hậu về công nghệ, không đáp ứng yêu cầu sản xuất.',
        'Theo chủ trương thanh lý tài sản cố định đã hết thời gian sử dụng.',
        'Hư hỏng nặng sau sự cố, chi phí sửa chữa vượt giá trị còn lại.',
      ]),
      buyerName: pick(['Công ty TNHH Thu mua Phế liệu Đại Phát', 'Công ty CP Thiết bị cũ Sài Gòn', 'Ông Nguyễn Văn Lộc', 'Công ty TNHH TM Đức Anh']),
      buyerTaxCode: '0312345' + int(100, 999),
      invoiceNo: 'HDB' + int(10000, 99999),
      council: ['Nguyễn Văn Minh', 'Trần Thị Hồng', 'Phạm Văn Hải'],
      status,
      approvedBy: ['approved', 'completed'].includes(status) ? userByUsername['giamdoc'].id : null,
      approvedAt: ['approved', 'completed'].includes(status) ? isoAgo(int(1, 300)) : null,
      note: '',
    });
    if (status === 'completed') store.update('assets', a.id, { status: 'disposed', disposalDate: date, disposalValue: salePrice });
  });

  /* -------- Tài liệu đính kèm -------- */
  assets.slice(0, 24).forEach((a, i) => {
    store.insert('attachments', {
      name: pick(['Hoá đơn GTGT mua tài sản', 'Biên bản nghiệm thu bàn giao', 'Phiếu bảo hành nhà sản xuất', 'Tài liệu hướng dẫn sử dụng']) + ' - ' + a.code + '.pdf',
      entity: 'assets',
      entityId: String(a.id),
      url: '/files/' + util.slug(a.code) + '-invoice.pdf',
      mimeType: 'application/pdf',
      size: int(120, 4800) * 1024,
      type: pick(['invoice', 'handover', 'manual', 'contract']),
      uploadedBy: 'thukho',
      note: '',
    });
  });

  /* -------- Mẫu báo cáo hệ thống -------- */
  REPORT_TEMPLATES.forEach((spec, i) => {
    store.insert('report_templates', {
      code: spec.code,
      name: spec.name,
      description: spec.description,
      dataset: spec.dataset,
      design: buildDesign(spec),
      paperSize: 'A4',
      orientation: spec.columns.reduce((s, c) => s + c.w, 0) > 200 ? 'landscape' : 'portrait',
      createdBy: 'admin',
      isSystem: true,
      version: 1,
    });
  });

  // Mẫu "tem tài sản": mỗi dòng một tem có mã QR + mã vạch Code128 quét được
  const labelDesign = reports.blankDesign({ paperSize: 'A4', orientation: 'portrait', title: 'TEM TÀI SẢN' });
  labelDesign.bands.reportTitle = {
    height: 13,
    elements: [{ id: 'lt', type: 'text', x: 0, y: 1, w: 186, h: 9, text: 'DANH SÁCH TEM TÀI SẢN (CẮT THEO ĐƯỜNG KẺ)', fontSize: 13, bold: true, align: 'center', uppercase: true }],
  };
  labelDesign.bands.columnHeader = {
    height: 6,
    elements: [
      { id: 'lc1', type: 'text', x: 0, y: 0, w: 100, h: 6, text: '{company.shortName} — Mã QR quét bằng điện thoại để mở hồ sơ tài sản', fontSize: 8, italic: true, valign: 'middle' },
      { id: 'lc2', type: 'text', x: 100, y: 0, w: 86, h: 6, text: 'Tem số: {rowIndex} • Ngày in: {date}', fontSize: 8, italic: true, align: 'right', valign: 'middle' },
    ],
  };
  labelDesign.bands.detail = {
    height: 36,
    elements: [
      { id: 'lb0', type: 'text', x: 0, y: 0, w: 186, h: 34, text: '', border: true },
      { id: 'ld1', type: 'text', x: 3, y: 2, w: 78, h: 5, text: 'MÃ TÀI SẢN', fontSize: 7.5, color: '#475569' },
      { id: 'ld2', type: 'field', x: 3, y: 7, w: 78, h: 10, field: 'code', fontSize: 15, bold: true, align: 'left' },
      { id: 'ld3', type: 'field', x: 3, y: 17, w: 78, h: 9, field: 'name', fontSize: 9.5, bold: false, wrap: true },
      { id: 'ld4', type: 'text', x: 3, y: 26, w: 78, h: 4.5, text: 'Danh mục: {categoryName}', fontSize: 8, color: '#475569' },
      { id: 'ld5', type: 'text', x: 3, y: 30.5, w: 78, h: 4.5, text: 'Bộ phận: {departmentName} • Người SD: {assigneeName}', fontSize: 8, color: '#475569' },
      { id: 'lb1', type: 'barcode', x: 84, y: 3, w: 62, h: 13, field: 'code' },
      { id: 'lb2', type: 'text', x: 84, y: 16, w: 62, h: 4.5, text: '{code}', fontSize: 9, align: 'center', fontFamily: 'monospace' },
      { id: 'ld6', type: 'text', x: 84, y: 22, w: 62, h: 4.5, text: 'Số lượng: {quantity} {unit}', fontSize: 8, color: '#475569' },
      { id: 'ld7', type: 'text', x: 84, y: 26.5, w: 62, h: 4.5, text: 'SL kiểm kê: ............  Ngày: __/__/____', fontSize: 8, color: '#64748b' },
      { id: 'lq1', type: 'qrcode', x: 150, y: 2, w: 34, h: 30, text: 'ams://asset/{code}', ecc: 'Q', quiet: 4 },
      { id: 'lq2', type: 'text', x: 150, y: 32, w: 34, h: 4, text: 'Quét để kiểm kê', fontSize: 7, align: 'center', color: '#64748b' },
    ],
  };
  labelDesign.groups = [];
  labelDesign.parameters = [];
  labelDesign.bands.reportFooter = { height: 10, elements: [{ id: 'lf', type: 'text', x: 0, y: 2, w: 186, h: 6, text: 'Tổng số tem: {COUNT()} — Ngày in: {date}', fontSize: 9, align: 'right', italic: true }] };
  store.insert('report_templates', {
    code: 'MBC-009',
    name: 'Tem/Thẻ tài sản có mã QR (in hàng loạt)',
    description: 'Mẫu in tem dán tài sản khổ A4 — mỗi tem có mã QR (ams://asset/<mã>) và mã vạch Code128 quét được bằng điện thoại để kiểm kê nhanh.',
    dataset: 'assets',
    design: labelDesign,
    paperSize: 'A4',
    orientation: 'portrait',
    createdBy: 'admin',
    isSystem: true,
    version: 1,
  });

  /* -------- Thông báo & nhật ký -------- */
  service.refreshAlerts();
  [
    ['Hệ thống khởi tạo dữ liệu mẫu thành công', 'Cơ sở dữ liệu đã được khởi tạo với dữ liệu mẫu tiếng Việt đầy đủ nghiệp vụ.', 'system', 'success'],
    ['Có 3 phiếu điều chuyển chờ phê duyệt', 'Vào mục Điều chuyển tài sản để xem và phê duyệt các phiếu đang chờ.', 'transfer_request', 'warning'],
    ['Có phiếu thanh lý chờ duyệt', 'Phiếu thanh lý tài sản cần được Ban Giám đốc phê duyệt trước khi thực hiện.', 'disposal_request', 'warning'],
  ].forEach((n) => service.notifyUsers({ title: n[0], message: n[1], type: n[2], level: n[3] }));

  // Nhật ký hoạt động mẫu
  const actions = ['LOGIN', 'CREATE', 'UPDATE', 'APPROVE', 'EXPORT', 'RUN'];
  for (let i = 0; i < 120; i++) {
    const u = pick(users);
    const day = int(0, 25);
    const action = pick(actions);
    const entity = pick(['assets', 'transfers', 'maintenances', 'depreciations', 'assignments', 'stocktakes', 'disposals', 'report_templates']);
    service.audit(action, entity, {
      username: u.username,
      userId: u.id,
      entityLabel: entity + ' #' + int(1, 120),
      ip: '192.168.1.' + int(2, 250),
      path: '/api/entities/' + entity,
      method: action === 'CREATE' ? 'POST' : action === 'LOGIN' ? 'POST' : 'GET',
      status: 200,
      created: undefined,
    });
    const log = store.all('audit_logs').slice(-1)[0];
    store.update('audit_logs', log.id, { createdAt: new Date(Date.now() - day * 86400000 - int(0, 86000) * 1000).toISOString() });
  }

  store.flush();
  return {
    success: true,
    counts: Object.keys(store.collections).reduce((acc, k) => {
      acc[k] = store.all(k).length;
      return acc;
    }, {}),
  };
}

module.exports = { run, buildDesign, REPORT_TEMPLATES };
