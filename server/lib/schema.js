'use strict';
/**
 * schema.js — Từ điển dữ liệu (metadata) của toàn hệ thống.
 * Metadata này điều khiển: API CRUD, biểu mẫu nhập liệu, bảng danh sách,
 * phân quyền, đánh mã tự động VÀ nguồn dữ liệu cho Report Designer.
 */

const T = {
  STRING: 'string',
  TEXT: 'text',
  NUMBER: 'number',
  MONEY: 'money',
  PERCENT: 'percent',
  DATE: 'date',
  DATETIME: 'datetime',
  BOOL: 'bool',
  SELECT: 'select',
  REF: 'ref',
  TAGS: 'tags',
  IMAGE: 'image',
  PASSWORD: 'password',
  JSON: 'json',
};

/* ------------------------------------------------------------------ */
/* Danh mục trạng thái dùng chung                                      */
/* ------------------------------------------------------------------ */

const ASSET_STATUS = [
  { value: 'in_stock', label: 'Trong kho', color: '#64748b' },
  { value: 'in_use', label: 'Đang sử dụng', color: '#16a34a' },
  { value: 'allocated', label: 'Đã cấp phát', color: '#0ea5e9' },
  { value: 'reserved', label: 'Đã đặt trước', color: '#a855f7' },
  { value: 'maintenance', label: 'Đang bảo trì', color: '#f59e0b' },
  { value: 'warranty', label: 'Đang bảo hành', color: '#eab308' },
  { value: 'transferred', label: 'Đang điều chuyển', color: '#6366f1' },
  { value: 'damaged', label: 'Hư hỏng', color: '#ef4444' },
  { value: 'lost', label: 'Thất lạc / Mất', color: '#991b1b' },
  { value: 'pending_disposal', label: 'Chờ thanh lý', color: '#f97316' },
  { value: 'disposed', label: 'Đã thanh lý', color: '#475569' },
];

const ASSET_CONDITION = [
  { value: 'new', label: 'Mới (100%)', color: '#16a34a' },
  { value: 'good', label: 'Tốt (>80%)', color: '#22c55e' },
  { value: 'fair', label: 'Khá (50-80%)', color: '#eab308' },
  { value: 'poor', label: 'Kém (<50%)', color: '#f97316' },
  { value: 'broken', label: 'Hỏng / Không dùng được', color: '#ef4444' },
];

const DEPRECIATION_METHODS = [
  { value: 'straight_line', label: 'Đường thẳng (Straight-line)' },
  { value: 'declining_balance', label: 'Số dư giảm dần (Declining balance)' },
  { value: 'double_declining', label: 'Số dư giảm dần kép (Double declining)' },
  { value: 'sum_of_years', label: 'Tổng số năm (Sum-of-years digits)' },
  { value: 'productive', label: 'Theo khối lượng sản xuất' },
  { value: 'none', label: 'Không tính khấu hao' },
];

const WORKFLOW_STATUS = [
  { value: 'draft', label: 'Nháp', color: '#64748b' },
  { value: 'pending', label: 'Chờ duyệt', color: '#f59e0b' },
  { value: 'approved', label: 'Đã duyệt', color: '#0ea5e9' },
  { value: 'in_progress', label: 'Đang thực hiện', color: '#6366f1' },
  { value: 'completed', label: 'Hoàn thành', color: '#16a34a' },
  { value: 'rejected', label: 'Từ chối', color: '#ef4444' },
  { value: 'cancelled', label: 'Đã huỷ', color: '#94a3b8' },
];

const PRIORITY = [
  { value: 'low', label: 'Thấp', color: '#64748b' },
  { value: 'normal', label: 'Bình thường', color: '#0ea5e9' },
  { value: 'high', label: 'Cao', color: '#f59e0b' },
  { value: 'urgent', label: 'Khẩn cấp', color: '#ef4444' },
];

const MAINTENANCE_TYPES = [
  { value: 'preventive', label: 'Bảo trì định kỳ' },
  { value: 'corrective', label: 'Sửa chữa khắc phục' },
  { value: 'inspection', label: 'Kiểm tra / Hiệu chuẩn' },
  { value: 'upgrade', label: 'Nâng cấp' },
  { value: 'calibration', label: 'Hiệu chỉnh thiết bị' },
];

const DISPOSAL_TYPES = [
  { value: 'sale', label: 'Bán thanh lý' },
  { value: 'scrap', label: 'Bán phế liệu' },
  { value: 'donate', label: 'Tặng / Cho' },
  { value: 'destroy', label: 'Tiêu huỷ' },
  { value: 'writeoff', label: 'Ghi giảm / Xoá sổ' },
];

const UNITS = ['Cái', 'Chiếc', 'Bộ', 'Máy', 'Thiết bị', 'Bàn', 'Ghế', 'Tủ', 'Kệ', 'Xe', 'Điện thoại', 'Laptop', 'Màn hình', 'Máy in', 'm2', 'm', 'Kg', 'Lít', 'Hộp', 'Kiện'];

/* ------------------------------------------------------------------ */
/* Định nghĩa thực thể                                                 */
/* ------------------------------------------------------------------ */

const ENTITIES = {
  /* ================= TÀI SẢN ================= */
  assets: {
    label: 'Tài sản',
    singular: 'Tài sản',
    icon: 'box',
    perm: 'assets',
    prefix: 'TS',
    codeField: 'code',
    softDelete: true,
    searchFields: ['code', 'name', 'serial', 'model', 'brand', 'tags', 'note', 'assigneeName', 'departmentName', 'locationName', 'categoryName'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    listFields: ['code', 'name', 'categoryName', 'status', 'condition', 'departmentName', 'assigneeName', 'locationName', 'purchasePrice', 'bookValue'],
    fields: {
      code: { type: T.STRING, label: 'Mã tài sản', required: true, unique: true, auto: true, readonly: true, width: 130 },
      name: { type: T.STRING, label: 'Tên tài sản', required: true, width: 240 },
      categoryId: { type: T.REF, label: 'Danh mục', ref: 'categories', refLabel: 'name', required: true, group: 'Phân loại' },
      categoryName: { type: T.STRING, label: 'Tên danh mục', hidden: true, computed: true },
      type: { type: T.SELECT, label: 'Loại tài sản', group: 'Phân loại', options: [
        { value: 'fixed', label: 'Tài sản cố định (TSCĐ)' },
        { value: 'tool', label: 'Công cụ dụng cụ (CCDC)' },
        { value: 'consumable', label: 'Vật tư tiêu hao' },
        { value: 'intangible', label: 'Tài sản vô hình' },
        { value: 'leased', label: 'Tài sản thuê ngoài' },
      ], default: 'fixed' },
      status: { type: T.SELECT, label: 'Trạng thái', options: ASSET_STATUS, default: 'in_stock', badge: true, group: 'Phân loại' },
      condition: { type: T.SELECT, label: 'Tình trạng', options: ASSET_CONDITION, default: 'new', group: 'Phân loại' },
      quantity: { type: T.NUMBER, label: 'Số lượng', default: 1 },
      unit: { type: T.SELECT, label: 'Đơn vị tính', options: UNITS.map((u) => ({ value: u, label: u })), default: 'Cái' },
      model: { type: T.STRING, label: 'Model / Kiểu', group: 'Thông số kỹ thuật' },
      serial: { type: T.STRING, label: 'Số serial', group: 'Thông số kỹ thuật' },
      brand: { type: T.STRING, label: 'Hãng sản xuất', group: 'Thông số kỹ thuật' },
      origin: { type: T.STRING, label: 'Xuất xứ', group: 'Thông số kỹ thuật' },
      specs: { type: T.TEXT, label: 'Thông số chi tiết', group: 'Thông số kỹ thuật' },
      purchaseDate: { type: T.DATE, label: 'Ngày mua', required: true, group: 'Mua sắm & Nguyên giá' },
      supplierId: { type: T.REF, label: 'Nhà cung cấp', ref: 'suppliers', refLabel: 'name', group: 'Mua sắm & Nguyên giá' },
      contractId: { type: T.REF, label: 'Hợp đồng', ref: 'contracts', refLabel: 'code', group: 'Mua sắm & Nguyên giá' },
      invoiceNo: { type: T.STRING, label: 'Số hoá đơn', group: 'Mua sắm & Nguyên giá' },
      invoiceDate: { type: T.DATE, label: 'Ngày hoá đơn', group: 'Mua sắm & Nguyên giá' },
      purchasePrice: { type: T.MONEY, label: 'Đơn giá mua (chưa VAT)', group: 'Mua sắm & Nguyên giá', default: 0 },
      vatPercent: { type: T.PERCENT, label: 'Thuế VAT (%)', group: 'Mua sắm & Nguyên giá', default: 0 },
      transportCost: { type: T.MONEY, label: 'Chi phí vận chuyển', group: 'Mua sắm & Nguyên giá', default: 0 },
      installCost: { type: T.MONEY, label: 'Chi phí lắp đặt', group: 'Mua sắm & Nguyên giá', default: 0 },
      otherCost: { type: T.MONEY, label: 'Chi phí khác', group: 'Mua sắm & Nguyên giá', default: 0 },
      originalCost: { type: T.MONEY, label: 'Nguyên giá', computed: true, readonly: true, group: 'Mua sắm & Nguyên giá' },
      depreciationMethod: { type: T.SELECT, label: 'Phương pháp khấu hao', options: DEPRECIATION_METHODS, default: 'straight_line', group: 'Khấu hao' },
      usefulLife: { type: T.NUMBER, label: 'Thời gian sử dụng (tháng)', default: 60, group: 'Khấu hao' },
      depreciationRate: { type: T.PERCENT, label: 'Tỷ lệ KH (%/năm)', default: 20, group: 'Khấu hao' },
      salvageValue: { type: T.MONEY, label: 'Giá trị thu hồi ước tính', default: 0, group: 'Khấu hao' },
      depreciationStart: { type: T.DATE, label: 'Bắt đầu tính KH', group: 'Khấu hao' },
      accumulatedDepreciation: { type: T.MONEY, label: 'Hao mòn luỹ kế', default: 0, readonly: true, group: 'Khấu hao' },
      bookValue: { type: T.MONEY, label: 'Giá trị còn lại', computed: true, readonly: true, group: 'Khấu hao' },
      monthlyDepreciation: { type: T.MONEY, label: 'Mức KH tháng', computed: true, readonly: true, group: 'Khấu hao' },
      depreciationPeriods: { type: T.NUMBER, label: 'Số kỳ đã KH', default: 0, readonly: true, group: 'Khấu hao' },
      warrantyMonths: { type: T.NUMBER, label: 'Bảo hành (tháng)', default: 12, group: 'Bảo hành & Bảo hiểm' },
      warrantyStart: { type: T.DATE, label: 'Bắt đầu bảo hành', group: 'Bảo hành & Bảo hiểm' },
      warrantyEnd: { type: T.DATE, label: 'Hết hạn bảo hành', computed: true, group: 'Bảo hành & Bảo hiểm' },
      insured: { type: T.BOOL, label: 'Có mua bảo hiểm', group: 'Bảo hành & Bảo hiểm', default: false },
      insuranceCompany: { type: T.STRING, label: 'Đơn vị bảo hiểm', group: 'Bảo hành & Bảo hiểm', showIf: 'insured' },
      insuranceValue: { type: T.MONEY, label: 'Giá trị bảo hiểm', group: 'Bảo hành & Bảo hiểm', showIf: 'insured' },
      insuranceExpiry: { type: T.DATE, label: 'Hết hạn bảo hiểm', group: 'Bảo hành & Bảo hiểm', showIf: 'insured' },
      locationId: { type: T.REF, label: 'Vị trí / Kho', ref: 'locations', refLabel: 'name', group: 'Vị trí & Sử dụng' },
      locationName: { type: T.STRING, label: 'Tên vị trí', hidden: true, computed: true },
      departmentId: { type: T.REF, label: 'Phòng ban quản lý', ref: 'departments', refLabel: 'name', group: 'Vị trí & Sử dụng', filterable: true },
      departmentName: { type: T.STRING, label: 'Tên phòng ban', hidden: true, computed: true },
      assigneeId: { type: T.REF, label: 'Người sử dụng', ref: 'users', refLabel: 'fullName', group: 'Vị trí & Sử dụng' },
      assigneeName: { type: T.STRING, label: 'Tên người sử dụng', hidden: true, computed: true },
      assignedDate: { type: T.DATE, label: 'Ngày bàn giao', group: 'Vị trí & Sử dụng' },
      responsibleId: { type: T.REF, label: 'Người chịu trách nhiệm', ref: 'users', refLabel: 'fullName', group: 'Vị trí & Sử dụng' },
      lastMaintenanceAt: { type: T.DATE, label: 'Bảo trì gần nhất', readonly: true, group: 'Vòng đời' },
      nextMaintenanceAt: { type: T.DATE, label: 'Bảo trì kế tiếp', group: 'Vòng đời' },
      lastStocktakeAt: { type: T.DATE, label: 'Kiểm kê gần nhất', readonly: true, group: 'Vòng đời' },
      disposalDate: { type: T.DATE, label: 'Ngày thanh lý', readonly: true, group: 'Vòng đời' },
      disposalValue: { type: T.MONEY, label: 'Giá trị thanh lý', readonly: true, group: 'Vòng đời' },
      imageUrl: { type: T.IMAGE, label: 'Ảnh tài sản', group: 'Khác' },
      tags: { type: T.TAGS, label: 'Thẻ (tags)', group: 'Khác' },
      note: { type: T.TEXT, label: 'Ghi chú', group: 'Khác' },
      isDeleted: { type: T.BOOL, label: 'Đã xoá', hidden: true, default: false },
    },
    virtual: {
      ageMonths: { label: 'Số tháng sử dụng', type: T.NUMBER },
      deprecationProgress: { label: 'Tiến độ khấu hao (%)', type: T.NUMBER },
      warrantyRemainingDays: { label: 'Số ngày còn bảo hành', type: T.NUMBER },
    },
  },

  /* ================= DANH MỤC ================= */
  categories: {
    label: 'Danh mục tài sản',
    singular: 'Danh mục',
    icon: 'folder',
    perm: 'categories',
    prefix: 'DM',
    softDelete: true,
    searchFields: ['code', 'name', 'note'],
    defaultSort: { field: 'code', order: 'asc' },
    listFields: ['code', 'name', 'parentId', 'assetCount', 'defaultUsefulLife', 'note'],
    fields: {
      code: { type: T.STRING, label: 'Mã danh mục', required: true, unique: true, auto: true, readonly: true },
      name: { type: T.STRING, label: 'Tên danh mục', required: true },
      parentId: { type: T.REF, label: 'Danh mục cha', ref: 'categories', refLabel: 'name', tree: true },
      description: { type: T.TEXT, label: 'Mô tả' },
      defaultUsefulLife: { type: T.NUMBER, label: 'Thời gian KH mặc định (tháng)', default: 60 },
      defaultDepreciationRate: { type: T.PERCENT, label: 'Tỷ lệ KH mặc định (%/năm)', default: 20 },
      defaultType: { type: T.SELECT, label: 'Loại tài sản mặc định', options: [
        { value: 'fixed', label: 'Tài sản cố định' },
        { value: 'tool', label: 'Công cụ dụng cụ' },
        { value: 'consumable', label: 'Vật tư tiêu hao' },
        { value: 'intangible', label: 'Tài sản vô hình' },
      ], default: 'fixed' },
      maintenanceCycleDays: { type: T.NUMBER, label: 'Chu kỳ bảo trì (ngày)', default: 180 },
      assetCount: { type: T.NUMBER, label: 'Số tài sản', computed: true, readonly: true },
      note: { type: T.TEXT, label: 'Ghi chú' },
    },
  },

  /* ================= NHÀ CUNG CẤP ================= */
  suppliers: {
    label: 'Nhà cung cấp',
    singular: 'Nhà cung cấp',
    icon: 'truck',
    perm: 'suppliers',
    prefix: 'NCC',
    softDelete: true,
    searchFields: ['code', 'name', 'taxCode', 'contactName', 'phone', 'email', 'address'],
    defaultSort: { field: 'name', order: 'asc' },
    listFields: ['code', 'name', 'taxCode', 'contactName', 'phone', 'email', 'rating', 'assetCount'],
    fields: {
      code: { type: T.STRING, label: 'Mã NCC', required: true, unique: true, auto: true, readonly: true },
      name: { type: T.STRING, label: 'Tên nhà cung cấp', required: true },
      taxCode: { type: T.STRING, label: 'Mã số thuế' },
      contactName: { type: T.STRING, label: 'Người liên hệ' },
      phone: { type: T.STRING, label: 'Điện thoại' },
      email: { type: T.STRING, label: 'Email' },
      address: { type: T.TEXT, label: 'Địa chỉ' },
      bankAccount: { type: T.STRING, label: 'Số tài khoản' },
      bankName: { type: T.STRING, label: 'Ngân hàng' },
      rating: { type: T.SELECT, label: 'Đánh giá', options: [
        { value: 'A', label: 'A - Rất tốt', color: '#16a34a' },
        { value: 'B', label: 'B - Tốt', color: '#0ea5e9' },
        { value: 'C', label: 'C - Trung bình', color: '#f59e0b' },
        { value: 'D', label: 'D - Kém', color: '#ef4444' },
      ], badge: true, default: 'B' },
      assetCount: { type: T.NUMBER, label: 'Số tài sản đã cung cấp', computed: true, readonly: true },
      note: { type: T.TEXT, label: 'Ghi chú' },
    },
  },

  /* ================= PHÒNG BAN ================= */
  departments: {
    label: 'Phòng ban',
    singular: 'Phòng ban',
    icon: 'sitemap',
    perm: 'departments',
    prefix: 'PB',
    softDelete: true,
    searchFields: ['code', 'name', 'managerName'],
    defaultSort: { field: 'code', order: 'asc' },
    listFields: ['code', 'name', 'parentId', 'managerId', 'phone', 'assetCount', 'totalValue'],
    fields: {
      code: { type: T.STRING, label: 'Mã phòng ban', required: true, unique: true, auto: true, readonly: true },
      name: { type: T.STRING, label: 'Tên phòng ban', required: true },
      parentId: { type: T.REF, label: 'Đơn vị cấp trên', ref: 'departments', refLabel: 'name', tree: true },
      managerId: { type: T.REF, label: 'Trưởng bộ phận', ref: 'users', refLabel: 'fullName' },
      phone: { type: T.STRING, label: 'Điện thoại' },
      email: { type: T.STRING, label: 'Email' },
      costCenter: { type: T.STRING, label: 'Mã trung tâm chi phí' },
      budgetYear: { type: T.MONEY, label: 'Ngân sách năm' },
      assetCount: { type: T.NUMBER, label: 'Số tài sản quản lý', computed: true, readonly: true },
      totalValue: { type: T.MONEY, label: 'Tổng giá trị còn lại', computed: true, readonly: true },
      note: { type: T.TEXT, label: 'Ghi chú' },
    },
  },

  /* ================= VỊ TRÍ / KHO ================= */
  locations: {
    label: 'Vị trí / Kho',
    singular: 'Vị trí',
    icon: 'map',
    perm: 'locations',
    prefix: 'VT',
    softDelete: true,
    searchFields: ['code', 'name', 'address'],
    defaultSort: { field: 'code', order: 'asc' },
    listFields: ['code', 'name', 'type', 'parentId', 'address', 'assetCount', 'capacity'],
    fields: {
      code: { type: T.STRING, label: 'Mã vị trí', required: true, unique: true, auto: true, readonly: true },
      name: { type: T.STRING, label: 'Tên vị trí / kho', required: true },
      type: { type: T.SELECT, label: 'Loại', options: [
        { value: 'warehouse', label: 'Kho' },
        { value: 'building', label: 'Toà nhà' },
        { value: 'floor', label: 'Tầng' },
        { value: 'room', label: 'Phòng' },
        { value: 'site', label: 'Công trường / Chi nhánh' },
        { value: 'vehicle', label: 'Phương tiện' },
      ], default: 'room' },
      parentId: { type: T.REF, label: 'Vị trí cha', ref: 'locations', refLabel: 'name', tree: true },
      address: { type: T.TEXT, label: 'Địa chỉ' },
      managerId: { type: T.REF, label: 'Thủ kho / Người phụ trách', ref: 'users', refLabel: 'fullName' },
      capacity: { type: T.NUMBER, label: 'Sức chứa (tài sản)', default: 0 },
      assetCount: { type: T.NUMBER, label: 'Số tài sản hiện có', computed: true, readonly: true },
      note: { type: T.TEXT, label: 'Ghi chú' },
    },
  },

  /* ================= CẤP PHÁT / THU HỒI ================= */
  assignments: {
    label: 'Cấp phát / Thu hồi',
    singular: 'Phiếu cấp phát',
    icon: 'handshake',
    perm: 'assignments',
    prefix: 'CP',
    softDelete: true,
    searchFields: ['code', 'assetCode', 'assetName', 'toUserName', 'note'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    listFields: ['code', 'type', 'assetCode', 'assetName', 'toUserName', 'fromUserName', 'departmentName', 'date', 'status'],
    fields: {
      code: { type: T.STRING, label: 'Số phiếu', required: true, unique: true, auto: true, readonly: true },
      type: { type: T.SELECT, label: 'Loại phiếu', options: [
        { value: 'assign', label: 'Cấp phát' },
        { value: 'recover', label: 'Thu hồi' },
        { value: 'lend', label: 'Cho mượn' },
        { value: 'return', label: 'Trả lại' },
      ], required: true, default: 'assign', badge: true },
      assetId: { type: T.REF, label: 'Tài sản', ref: 'assets', refLabel: 'name', required: true },
      assetCode: { type: T.STRING, label: 'Mã tài sản', computed: true, readonly: true },
      assetName: { type: T.STRING, label: 'Tên tài sản', computed: true, readonly: true },
      toUserId: { type: T.REF, label: 'Giao cho', ref: 'users', refLabel: 'fullName' },
      toUserName: { type: T.STRING, label: 'Người nhận', computed: true, readonly: true },
      fromUserId: { type: T.REF, label: 'Người giao', ref: 'users', refLabel: 'fullName' },
      fromUserName: { type: T.STRING, label: 'Người giao (tên)', computed: true, readonly: true },
      departmentId: { type: T.REF, label: 'Phòng ban nhận', ref: 'departments', refLabel: 'name' },
      departmentName: { type: T.STRING, label: 'Phòng ban', computed: true, readonly: true },
      locationId: { type: T.REF, label: 'Vị trí đặt', ref: 'locations', refLabel: 'name' },
      date: { type: T.DATE, label: 'Ngày lập phiếu', required: true },
      expectedReturnDate: { type: T.DATE, label: 'Ngày dự kiến trả' },
      conditionAtHandover: { type: T.SELECT, label: 'Tình trạng khi bàn giao', options: ASSET_CONDITION, default: 'good' },
      accessories: { type: T.TEXT, label: 'Phụ kiện kèm theo' },
      purpose: { type: T.STRING, label: 'Mục đích sử dụng' },
      status: { type: T.SELECT, label: 'Trạng thái', options: WORKFLOW_STATUS, default: 'completed', badge: true },
      note: { type: T.TEXT, label: 'Ghi chú' },
      signatureReceiver: { type: T.STRING, label: 'Người nhận ký', group: 'Ký nhận' },
      signatureGiver: { type: T.STRING, label: 'Người giao ký', group: 'Ký nhận' },
      signatureManager: { type: T.STRING, label: 'Trưởng phòng ký', group: 'Ký nhận' },
    },
  },

  /* ================= ĐIỀU CHUYỂN ================= */
  transfers: {
    label: 'Điều chuyển tài sản',
    singular: 'Phiếu điều chuyển',
    icon: 'swap',
    perm: 'transfers',
    prefix: 'DC',
    softDelete: true,
    searchFields: ['code', 'assetCode', 'assetName', 'reason', 'fromDepartmentName', 'toDepartmentName'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    listFields: ['code', 'assetCode', 'assetName', 'fromDepartmentName', 'toDepartmentName', 'fromUserName', 'toUserName', 'date', 'status'],
    fields: {
      code: { type: T.STRING, label: 'Số phiếu', required: true, unique: true, auto: true, readonly: true },
      assetId: { type: T.REF, label: 'Tài sản', ref: 'assets', refLabel: 'name', required: true },
      assetCode: { type: T.STRING, label: 'Mã tài sản', computed: true, readonly: true },
      assetName: { type: T.STRING, label: 'Tên tài sản', computed: true, readonly: true },
      fromDepartmentId: { type: T.REF, label: 'Từ phòng ban', ref: 'departments', refLabel: 'name' },
      fromDepartmentName: { type: T.STRING, label: 'Từ phòng ban (tên)', computed: true, readonly: true },
      toDepartmentId: { type: T.REF, label: 'Đến phòng ban', ref: 'departments', refLabel: 'name', required: true },
      toDepartmentName: { type: T.STRING, label: 'Đến phòng ban (tên)', computed: true, readonly: true },
      fromUserId: { type: T.REF, label: 'Từ người dùng', ref: 'users', refLabel: 'fullName' },
      fromUserName: { type: T.STRING, label: 'Từ người dùng (tên)', computed: true, readonly: true },
      toUserId: { type: T.REF, label: 'Đến người dùng', ref: 'users', refLabel: 'fullName' },
      toUserName: { type: T.STRING, label: 'Đến người dùng (tên)', computed: true, readonly: true },
      fromLocationId: { type: T.REF, label: 'Từ vị trí', ref: 'locations', refLabel: 'name' },
      toLocationId: { type: T.REF, label: 'Đến vị trí', ref: 'locations', refLabel: 'name' },
      date: { type: T.DATE, label: 'Ngày điều chuyển', required: true },
      reason: { type: T.TEXT, label: 'Lý do điều chuyển' },
      transportCost: { type: T.MONEY, label: 'Chi phí vận chuyển', default: 0 },
      status: { type: T.SELECT, label: 'Trạng thái', options: WORKFLOW_STATUS, default: 'pending', badge: true },
      requestedBy: { type: T.REF, label: 'Người đề nghị', ref: 'users', refLabel: 'fullName' },
      approvedBy: { type: T.REF, label: 'Người duyệt', ref: 'users', refLabel: 'fullName', readonly: true },
      approvedAt: { type: T.DATETIME, label: 'Thời điểm duyệt', readonly: true },
      completedAt: { type: T.DATETIME, label: 'Thời điểm hoàn thành', readonly: true },
      rejectReason: { type: T.TEXT, label: 'Lý do từ chối' },
      note: { type: T.TEXT, label: 'Ghi chú' },
    },
  },

  /* ================= BẢO TRÌ / SỬA CHỮA ================= */
  maintenances: {
    label: 'Bảo trì - Sửa chữa',
    singular: 'Phiếu bảo trì',
    icon: 'wrench',
    perm: 'maintenances',
    prefix: 'BT',
    softDelete: true,
    searchFields: ['code', 'assetCode', 'assetName', 'description', 'vendorName'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    listFields: ['code', 'assetCode', 'assetName', 'type', 'plannedDate', 'actualDate', 'cost', 'status', 'priority'],
    fields: {
      code: { type: T.STRING, label: 'Số phiếu', required: true, unique: true, auto: true, readonly: true },
      assetId: { type: T.REF, label: 'Tài sản', ref: 'assets', refLabel: 'name', required: true },
      assetCode: { type: T.STRING, label: 'Mã tài sản', computed: true, readonly: true },
      assetName: { type: T.STRING, label: 'Tên tài sản', computed: true, readonly: true },
      type: { type: T.SELECT, label: 'Loại bảo trì', options: MAINTENANCE_TYPES, default: 'preventive' },
      priority: { type: T.SELECT, label: 'Mức độ ưu tiên', options: PRIORITY, default: 'normal', badge: true },
      reportedDate: { type: T.DATE, label: 'Ngày báo hỏng' },
      plannedDate: { type: T.DATE, label: 'Ngày dự kiến' },
      actualDate: { type: T.DATE, label: 'Ngày thực hiện' },
      description: { type: T.TEXT, label: 'Nội dung / Hiện tượng' },
      solution: { type: T.TEXT, label: 'Phương án xử lý' },
      result: { type: T.TEXT, label: 'Kết quả sau bảo trì' },
      vendorId: { type: T.REF, label: 'Nhà cung cấp dịch vụ', ref: 'suppliers', refLabel: 'name' },
      vendorName: { type: T.STRING, label: 'Tên đơn vị thực hiện', computed: true, readonly: true },
      technician: { type: T.STRING, label: 'Kỹ thuật viên' },
      cost: { type: T.MONEY, label: 'Chi phí (VNĐ)', default: 0 },
      partsCost: { type: T.MONEY, label: 'Chi phí vật tư', default: 0 },
      downtimeHours: { type: T.NUMBER, label: 'Thời gian dừng máy (giờ)', default: 0 },
      status: { type: T.SELECT, label: 'Trạng thái', options: WORKFLOW_STATUS, default: 'pending', badge: true },
      conditionAfter: { type: T.SELECT, label: 'Tình trạng sau bảo trì', options: ASSET_CONDITION },
      warrantyClaim: { type: T.BOOL, label: 'Bảo hành (không mất phí)', default: false },
      isRecurring: { type: T.BOOL, label: 'Bảo trì định kỳ', default: false },
      cycleDays: { type: T.NUMBER, label: 'Chu kỳ (ngày)', default: 0 },
      nextDueDate: { type: T.DATE, label: 'Hạn bảo trì kế tiếp' },
      attachments: { type: T.TAGS, label: 'Tệp đính kèm (link)' },
      note: { type: T.TEXT, label: 'Ghi chú' },
    },
  },

  /* ================= KHẤU HAO ================= */
  depreciations: {
    label: 'Khấu hao tài sản',
    singular: 'Bút toán khấu hao',
    icon: 'trending-down',
    perm: 'depreciations',
    prefix: 'KH',
    softDelete: true,
    searchFields: ['code', 'assetCode', 'assetName', 'period'],
    defaultSort: { field: 'period', order: 'desc' },
    listFields: ['code', 'period', 'assetCode', 'assetName', 'method', 'openingValue', 'depreciationAmount', 'accumulated', 'closingValue', 'departmentName', 'status'],
    fields: {
      code: { type: T.STRING, label: 'Mã bút toán', required: true, unique: true, auto: true, readonly: true },
      period: { type: T.STRING, label: 'Kỳ (YYYY-MM)', required: true },
      assetId: { type: T.REF, label: 'Tài sản', ref: 'assets', refLabel: 'name', required: true },
      assetCode: { type: T.STRING, label: 'Mã tài sản', computed: true, readonly: true },
      assetName: { type: T.STRING, label: 'Tên tài sản', computed: true, readonly: true },
      departmentName: { type: T.STRING, label: 'Phòng ban', computed: true, readonly: true },
      method: { type: T.SELECT, label: 'Phương pháp', options: DEPRECIATION_METHODS },
      openingValue: { type: T.MONEY, label: 'Giá trị đầu kỳ', readonly: true },
      depreciationAmount: { type: T.MONEY, label: 'Mức KH trong kỳ', readonly: true },
      accumulated: { type: T.MONEY, label: 'Hao mòn luỹ kế', readonly: true },
      closingValue: { type: T.MONEY, label: 'Giá trị còn lại cuối kỳ', readonly: true },
      expenseAccount: { type: T.STRING, label: 'TK chi phí', default: '642' },
      assetAccount: { type: T.STRING, label: 'TK tài sản', default: '214' },
      runBy: { type: T.STRING, label: 'Người chạy', readonly: true },
      runAt: { type: T.DATETIME, label: 'Thời điểm chạy', readonly: true },
      status: { type: T.SELECT, label: 'Trạng thái', options: [
        { value: 'posted', label: 'Đã ghi sổ', color: '#16a34a' },
        { value: 'draft', label: 'Nháp', color: '#64748b' },
      ], default: 'posted', badge: true },
      note: { type: T.TEXT, label: 'Ghi chú' },
    },
  },

  /* ================= KIỂM KÊ ================= */
  stocktakes: {
    label: 'Kiểm kê tài sản',
    singular: 'Đợt kiểm kê',
    icon: 'clipboard-check',
    perm: 'stocktakes',
    prefix: 'KK',
    softDelete: true,
    searchFields: ['code', 'name', 'note'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    listFields: ['code', 'name', 'startDate', 'endDate', 'scope', 'totalItems', 'countedItems', 'diffItems', 'status'],
    fields: {
      code: { type: T.STRING, label: 'Số đợt kiểm kê', required: true, unique: true, auto: true, readonly: true },
      name: { type: T.STRING, label: 'Tên đợt kiểm kê', required: true },
      startDate: { type: T.DATE, label: 'Ngày bắt đầu' },
      endDate: { type: T.DATE, label: 'Ngày kết thúc' },
      scope: { type: T.SELECT, label: 'Phạm vi', options: [
        { value: 'all', label: 'Toàn công ty' },
        { value: 'department', label: 'Theo phòng ban' },
        { value: 'location', label: 'Theo vị trí / kho' },
        { value: 'category', label: 'Theo danh mục' },
      ], default: 'all' },
      departmentId: { type: T.REF, label: 'Phòng ban', ref: 'departments', refLabel: 'name' },
      locationId: { type: T.REF, label: 'Vị trí', ref: 'locations', refLabel: 'name' },
      categoryId: { type: T.REF, label: 'Danh mục', ref: 'categories', refLabel: 'name' },
      leaderId: { type: T.REF, label: 'Trưởng ban kiểm kê', ref: 'users', refLabel: 'fullName' },
      members: { type: T.TAGS, label: 'Thành viên' },
      totalItems: { type: T.NUMBER, label: 'Tổng số tài sản', readonly: true },
      countedItems: { type: T.NUMBER, label: 'Đã kiểm kê', readonly: true },
      diffItems: { type: T.NUMBER, label: 'Số chênh lệch', readonly: true },
      status: { type: T.SELECT, label: 'Trạng thái', options: [
        { value: 'open', label: 'Đang kiểm kê', color: '#0ea5e9' },
        { value: 'closed', label: 'Đã chốt', color: '#16a34a' },
        { value: 'cancelled', label: 'Đã huỷ', color: '#94a3b8' },
      ], default: 'open', badge: true },
      closedAt: { type: T.DATETIME, label: 'Thời điểm chốt', readonly: true },
      note: { type: T.TEXT, label: 'Ghi chú' },
    },
  },

  stocktake_items: {
    label: 'Chi tiết kiểm kê',
    singular: 'Dòng kiểm kê',
    icon: 'list',
    perm: 'stocktakes',
    prefix: 'KKCT',
    softDelete: false,
    searchFields: ['assetCode', 'assetName', 'note'],
    defaultSort: { field: 'id', order: 'asc' },
    listFields: ['stocktakeId', 'assetCode', 'assetName', 'locationName', 'expectedLocationName', 'assigneeName', 'counted', 'result', 'conditionFound', 'note'],
    fields: {
      stocktakeId: { type: T.REF, label: 'Đợt kiểm kê', ref: 'stocktakes', refLabel: 'code', required: true },
      assetId: { type: T.REF, label: 'Tài sản', ref: 'assets', refLabel: 'code', required: true },
      assetCode: { type: T.STRING, label: 'Mã tài sản' },
      assetName: { type: T.STRING, label: 'Tên tài sản' },
      expectedLocationId: { type: T.REF, label: 'Vị trí sổ sách', ref: 'locations', refLabel: 'name' },
      expectedLocationName: { type: T.STRING, label: 'Vị trí sổ sách (tên)' },
      locationId: { type: T.REF, label: 'Vị trí thực tế', ref: 'locations', refLabel: 'name' },
      locationName: { type: T.STRING, label: 'Vị trí thực tế (tên)' },
      assigneeId: { type: T.REF, label: 'Người sử dụng (sổ sách)', ref: 'users', refLabel: 'fullName' },
      assigneeName: { type: T.STRING, label: 'Người sử dụng' },
      counted: { type: T.BOOL, label: 'Đã kiểm kê', default: false },
      result: { type: T.SELECT, label: 'Kết quả', options: [
        { value: 'match', label: 'Khớp', color: '#16a34a' },
        { value: 'missing', label: 'Không tìm thấy', color: '#ef4444' },
        { value: 'extra', label: 'Phát hiện thêm', color: '#0ea5e9' },
        { value: 'wrong_location', label: 'Sai vị trí', color: '#f59e0b' },
        { value: 'damaged', label: 'Hư hỏng', color: '#f97316' },
      ], default: 'match', badge: true },
      conditionFound: { type: T.SELECT, label: 'Tình trạng thực tế', options: ASSET_CONDITION },
      countedBy: { type: T.REF, label: 'Người kiểm kê', ref: 'users', refLabel: 'fullName' },
      countedAt: { type: T.DATETIME, label: 'Thời điểm kiểm kê', readonly: true },
      note: { type: T.TEXT, label: 'Ghi chú' },
    },
  },

  /* ================= THANH LÝ ================= */
  disposals: {
    label: 'Thanh lý / Xử lý',
    singular: 'Phiếu thanh lý',
    icon: 'trash',
    perm: 'disposals',
    prefix: 'TL',
    softDelete: true,
    searchFields: ['code', 'assetCode', 'assetName', 'buyerName', 'reason'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    listFields: ['code', 'assetCode', 'assetName', 'type', 'date', 'bookValue', 'salePrice', 'profitLoss', 'status'],
    fields: {
      code: { type: T.STRING, label: 'Số phiếu', required: true, unique: true, auto: true, readonly: true },
      assetId: { type: T.REF, label: 'Tài sản', ref: 'assets', refLabel: 'name', required: true },
      assetCode: { type: T.STRING, label: 'Mã tài sản', computed: true, readonly: true },
      assetName: { type: T.STRING, label: 'Tên tài sản', computed: true, readonly: true },
      type: { type: T.SELECT, label: 'Hình thức', options: DISPOSAL_TYPES, default: 'sale' },
      date: { type: T.DATE, label: 'Ngày thanh lý', required: true },
      bookValue: { type: T.MONEY, label: 'Giá trị còn lại trên sổ', readonly: true },
      originalCost: { type: T.MONEY, label: 'Nguyên giá', readonly: true },
      accumulated: { type: T.MONEY, label: 'Hao mòn luỹ kế', readonly: true },
      salePrice: { type: T.MONEY, label: 'Giá bán / thu hồi', default: 0 },
      disposalCost: { type: T.MONEY, label: 'Chi phí thanh lý', default: 0 },
      profitLoss: { type: T.MONEY, label: 'Lãi / (Lỗ)', computed: true, readonly: true },
      reason: { type: T.TEXT, label: 'Lý do thanh lý' },
      buyerName: { type: T.STRING, label: 'Người/Đơn vị mua' },
      buyerTaxCode: { type: T.STRING, label: 'MST người mua' },
      invoiceNo: { type: T.STRING, label: 'Số hoá đơn bán' },
      council: { type: T.TAGS, label: 'Hội đồng thanh lý' },
      status: { type: T.SELECT, label: 'Trạng thái', options: WORKFLOW_STATUS, default: 'pending', badge: true },
      approvedBy: { type: T.REF, label: 'Người duyệt', ref: 'users', refLabel: 'fullName', readonly: true },
      approvedAt: { type: T.DATETIME, label: 'Thời điểm duyệt', readonly: true },
      note: { type: T.TEXT, label: 'Ghi chú' },
    },
  },

  /* ================= BẢO HÀNH ================= */
  warranties: {
    label: 'Bảo hành',
    singular: 'Phiếu bảo hành',
    icon: 'shield',
    perm: 'warranties',
    prefix: 'BH',
    softDelete: true,
    searchFields: ['code', 'assetCode', 'assetName', 'provider', 'issue'],
    defaultSort: { field: 'endDate', order: 'asc' },
    listFields: ['code', 'assetCode', 'assetName', 'provider', 'startDate', 'endDate', 'claimCount', 'status'],
    fields: {
      code: { type: T.STRING, label: 'Số phiếu', required: true, unique: true, auto: true, readonly: true },
      assetId: { type: T.REF, label: 'Tài sản', ref: 'assets', refLabel: 'name', required: true },
      assetCode: { type: T.STRING, label: 'Mã tài sản', computed: true, readonly: true },
      assetName: { type: T.STRING, label: 'Tên tài sản', computed: true, readonly: true },
      provider: { type: T.STRING, label: 'Đơn vị bảo hành' },
      supplierId: { type: T.REF, label: 'Nhà cung cấp', ref: 'suppliers', refLabel: 'name' },
      startDate: { type: T.DATE, label: 'Từ ngày', required: true },
      endDate: { type: T.DATE, label: 'Đến ngày', required: true },
      coverage: { type: T.TEXT, label: 'Phạm vi bảo hành' },
      claimCount: { type: T.NUMBER, label: 'Số lần yêu cầu BH', default: 0 },
      issue: { type: T.TEXT, label: 'Sự cố / Yêu cầu' },
      resolution: { type: T.TEXT, label: 'Kết quả xử lý' },
      claimDate: { type: T.DATE, label: 'Ngày yêu cầu' },
      resolvedDate: { type: T.DATE, label: 'Ngày hoàn tất' },
      cost: { type: T.MONEY, label: 'Chi phí phát sinh', default: 0 },
      status: { type: T.SELECT, label: 'Trạng thái', options: [
        { value: 'active', label: 'Đang hiệu lực', color: '#16a34a' },
        { value: 'expiring', label: 'Sắp hết hạn', color: '#f59e0b' },
        { value: 'expired', label: 'Hết hạn', color: '#94a3b8' },
        { value: 'claimed', label: 'Đã yêu cầu', color: '#0ea5e9' },
        { value: 'resolved', label: 'Đã xử lý', color: '#059669' },
        { value: 'rejected', label: 'Từ chối BH', color: '#ef4444' },
      ], default: 'active', badge: true },
      note: { type: T.TEXT, label: 'Ghi chú' },
    },
  },

  /* ================= HỢP ĐỒNG ================= */
  contracts: {
    label: 'Hợp đồng',
    singular: 'Hợp đồng',
    icon: 'file-text',
    perm: 'contracts',
    prefix: 'HD',
    softDelete: true,
    searchFields: ['code', 'name', 'supplierName', 'note'],
    defaultSort: { field: 'signDate', order: 'desc' },
    listFields: ['code', 'name', 'type', 'supplierName', 'signDate', 'endDate', 'value', 'assetCount', 'status'],
    fields: {
      code: { type: T.STRING, label: 'Số hợp đồng', required: true, unique: true, auto: true, readonly: true },
      name: { type: T.STRING, label: 'Tên hợp đồng', required: true },
      type: { type: T.SELECT, label: 'Loại hợp đồng', options: [
        { value: 'purchase', label: 'Mua sắm' },
        { value: 'lease_in', label: 'Thuê vào' },
        { value: 'lease_out', label: 'Cho thuê' },
        { value: 'service', label: 'Dịch vụ / Bảo trì' },
        { value: 'insurance', label: 'Bảo hiểm' },
        { value: 'construction', label: 'Thi công / Lắp đặt' },
      ], default: 'purchase' },
      supplierId: { type: T.REF, label: 'Đối tác', ref: 'suppliers', refLabel: 'name' },
      supplierName: { type: T.STRING, label: 'Tên đối tác', computed: true, readonly: true },
      signDate: { type: T.DATE, label: 'Ngày ký', required: true },
      startDate: { type: T.DATE, label: 'Ngày hiệu lực' },
      endDate: { type: T.DATE, label: 'Ngày hết hạn' },
      value: { type: T.MONEY, label: 'Giá trị hợp đồng', default: 0 },
      currency: { type: T.SELECT, label: 'Tiền tệ', options: [
        { value: 'VND', label: 'VNĐ' },
        { value: 'USD', label: 'USD' },
        { value: 'EUR', label: 'EUR' },
      ], default: 'VND' },
      paymentTerms: { type: T.TEXT, label: 'Điều khoản thanh toán' },
      assetCount: { type: T.NUMBER, label: 'Số tài sản', computed: true, readonly: true },
      status: { type: T.SELECT, label: 'Trạng thái', options: [
        { value: 'draft', label: 'Nháp', color: '#64748b' },
        { value: 'active', label: 'Đang hiệu lực', color: '#16a34a' },
        { value: 'expired', label: 'Hết hạn', color: '#94a3b8' },
        { value: 'terminated', label: 'Đã thanh lý HĐ', color: '#ef4444' },
      ], default: 'active', badge: true },
      note: { type: T.TEXT, label: 'Ghi chú' },
    },
  },

  /* ================= NGƯỜI DÙNG ================= */
  users: {
    label: 'Người dùng',
    singular: 'Người dùng',
    icon: 'users',
    perm: 'users',
    prefix: 'ND',
    softDelete: true,
    searchFields: ['username', 'fullName', 'email', 'phone', 'employeeCode'],
    defaultSort: { field: 'fullName', order: 'asc' },
    listFields: ['employeeCode', 'fullName', 'username', 'email', 'phone', 'departmentId', 'roleId', 'status', 'lastLoginAt'],
    fields: {
      employeeCode: { type: T.STRING, label: 'Mã nhân viên', auto: true, readonly: true, prefix: 'NV' },
      username: { type: T.STRING, label: 'Tên đăng nhập', required: true, unique: true },
      password: { type: T.PASSWORD, label: 'Mật khẩu', hidden: true, min: 6 },
      fullName: { type: T.STRING, label: 'Họ và tên', required: true },
      email: { type: T.STRING, label: 'Email' },
      phone: { type: T.STRING, label: 'Điện thoại' },
      departmentId: { type: T.REF, label: 'Phòng ban', ref: 'departments', refLabel: 'name' },
      position: { type: T.STRING, label: 'Chức vụ' },
      roleId: { type: T.REF, label: 'Vai trò', ref: 'roles', refLabel: 'name', required: true },
      managerId: { type: T.REF, label: 'Quản lý trực tiếp', ref: 'users', refLabel: 'fullName' },
      status: { type: T.SELECT, label: 'Trạng thái', options: [
        { value: 'active', label: 'Đang hoạt động', color: '#16a34a' },
        { value: 'locked', label: 'Đã khoá', color: '#ef4444' },
        { value: 'pending', label: 'Chờ kích hoạt', color: '#f59e0b' },
        { value: 'resigned', label: 'Đã nghỉ việc', color: '#94a3b8' },
      ], default: 'active', badge: true },
      avatar: { type: T.IMAGE, label: 'Ảnh đại diện' },
      joinDate: { type: T.DATE, label: 'Ngày vào làm' },
      lastLoginAt: { type: T.DATETIME, label: 'Đăng nhập gần nhất', readonly: true },
      mustChangePassword: { type: T.BOOL, label: 'Buộc đổi mật khẩu', default: false },
      assetCount: { type: T.NUMBER, label: 'Tài sản đang giữ', computed: true, readonly: true },
      note: { type: T.TEXT, label: 'Ghi chú' },
    },
  },

  /* ================= VAI TRÒ ================= */
  roles: {
    label: 'Vai trò & Phân quyền',
    singular: 'Vai trò',
    icon: 'user-shield',
    perm: 'roles',
    prefix: 'VT',
    softDelete: true,
    searchFields: ['code', 'name', 'description'],
    defaultSort: { field: 'code', order: 'asc' },
    listFields: ['code', 'name', 'description', 'userCount', 'isSystem'],
    fields: {
      code: { type: T.STRING, label: 'Mã vai trò', required: true, unique: true },
      name: { type: T.STRING, label: 'Tên vai trò', required: true },
      description: { type: T.TEXT, label: 'Mô tả' },
      permissions: { type: T.JSON, label: 'Ma trận phân quyền', hidden: true },
      dataScope: { type: T.SELECT, label: 'Phạm vi dữ liệu', options: [
        { value: 'all', label: 'Toàn hệ thống' },
        { value: 'department', label: 'Theo phòng ban' },
        { value: 'own', label: 'Chỉ dữ liệu của mình' },
      ], default: 'all' },
      isSystem: { type: T.BOOL, label: 'Vai trò hệ thống', readonly: true, default: false },
      userCount: { type: T.NUMBER, label: 'Số người dùng', computed: true, readonly: true },
      note: { type: T.TEXT, label: 'Ghi chú' },
    },
  },

  /* ================= NHẬT KÝ HỆ THỐNG ================= */
  audit_logs: {
    label: 'Nhật ký hệ thống',
    singular: 'Bản ghi nhật ký',
    icon: 'history',
    perm: 'audit_logs',
    prefix: 'LOG',
    softDelete: false,
    readonly: true,
    searchFields: ['username', 'action', 'entity', 'entityLabel', 'ip', 'path'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    listFields: ['createdAt', 'username', 'action', 'entity', 'entityLabel', 'ip', 'path', 'status'],
    fields: {
      username: { type: T.STRING, label: 'Người dùng' },
      userId: { type: T.REF, label: 'ID người dùng', ref: 'users' },
      action: { type: T.SELECT, label: 'Hành động', options: [
        { value: 'LOGIN', label: 'Đăng nhập', color: '#0ea5e9' },
        { value: 'LOGOUT', label: 'Đăng xuất', color: '#64748b' },
        { value: 'LOGIN_FAILED', label: 'Đăng nhập thất bại', color: '#ef4444' },
        { value: 'CREATE', label: 'Thêm mới', color: '#16a34a' },
        { value: 'UPDATE', label: 'Cập nhật', color: '#f59e0b' },
        { value: 'DELETE', label: 'Xoá', color: '#ef4444' },
        { value: 'RESTORE', label: 'Khôi phục', color: '#0ea5e9' },
        { value: 'APPROVE', label: 'Phê duyệt', color: '#059669' },
        { value: 'REJECT', label: 'Từ chối', color: '#dc2626' },
        { value: 'IMPORT', label: 'Nhập dữ liệu', color: '#a855f7' },
        { value: 'EXPORT', label: 'Xuất dữ liệu', color: '#8b5cf6' },
        { value: 'RUN', label: 'Chạy tiến trình', color: '#6366f1' },
        { value: 'CONFIG', label: 'Cấu hình', color: '#64748b' },
        { value: 'RESTORE_DB', label: 'Phục hồi CSDL', color: '#f97316' },
      ], badge: true },
      entity: { type: T.STRING, label: 'Đối tượng' },
      entityId: { type: T.STRING, label: 'ID đối tượng' },
      entityLabel: { type: T.STRING, label: 'Mô tả' },
      changes: { type: T.JSON, label: 'Thay đổi', hidden: true },
      ip: { type: T.STRING, label: 'IP' },
      userAgent: { type: T.STRING, label: 'Trình duyệt', hidden: true },
      path: { type: T.STRING, label: 'Đường dẫn API' },
      method: { type: T.STRING, label: 'Phương thức' },
      status: { type: T.NUMBER, label: 'Mã HTTP' },
      durationMs: { type: T.NUMBER, label: 'Thời gian (ms)' },
    },
  },

  /* ================= PHIÊN ĐĂNG NHẬP ================= */
  sessions: {
    label: 'Phiên đăng nhập',
    singular: 'Phiên',
    icon: 'key',
    perm: 'sessions',
    prefix: 'SE',
    softDelete: false,
    searchFields: ['username', 'ip', 'userAgent'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    listFields: ['username', 'ip', 'userAgent', 'createdAt', 'expiresAt', 'lastSeenAt', 'revokedAt'],
    fields: {
      username: { type: T.STRING, label: 'Người dùng' },
      userId: { type: T.REF, label: 'ID người dùng', ref: 'users' },
      tokenId: { type: T.STRING, label: 'Mã phiên', hidden: true },
      ip: { type: T.STRING, label: 'Địa chỉ IP' },
      userAgent: { type: T.STRING, label: 'Thiết bị / Trình duyệt' },
      expiresAt: { type: T.DATETIME, label: 'Hết hạn' },
      lastSeenAt: { type: T.DATETIME, label: 'Hoạt động cuối' },
      revokedAt: { type: T.DATETIME, label: 'Thu hồi lúc' },
      revokedBy: { type: T.STRING, label: 'Thu hồi bởi' },
    },
  },

  /* ================= THÔNG BÁO ================= */
  notifications: {
    label: 'Thông báo',
    singular: 'Thông báo',
    icon: 'bell',
    perm: 'notifications',
    prefix: 'TB',
    softDelete: false,
    searchFields: ['title', 'message'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    listFields: ['title', 'type', 'level', 'userId', 'readAt', 'createdAt', 'link'],
    fields: {
      title: { type: T.STRING, label: 'Tiêu đề' },
      message: { type: T.TEXT, label: 'Nội dung' },
      type: { type: T.SELECT, label: 'Loại', options: [
        { value: 'maintenance_due', label: 'Đến hạn bảo trì' },
        { value: 'warranty_expiring', label: 'Sắp hết bảo hành' },
        { value: 'transfer_request', label: 'Yêu cầu điều chuyển' },
        { value: 'disposal_request', label: 'Yêu cầu thanh lý' },
        { value: 'stocktake', label: 'Kiểm kê' },
        { value: 'system', label: 'Hệ thống' },
      ], default: 'system' },
      level: { type: T.SELECT, label: 'Mức độ', options: [
        { value: 'info', label: 'Thông tin', color: '#0ea5e9' },
        { value: 'success', label: 'Thành công', color: '#16a34a' },
        { value: 'warning', label: 'Cảnh báo', color: '#f59e0b' },
        { value: 'danger', label: 'Nguy hiểm', color: '#ef4444' },
      ], default: 'info', badge: true },
      userId: { type: T.REF, label: 'Người nhận', ref: 'users', refLabel: 'fullName' },
      link: { type: T.STRING, label: 'Liên kết' },
      readAt: { type: T.DATETIME, label: 'Đã đọc lúc' },
    },
  },

  /* ================= MẪU BÁO CÁO ================= */
  report_templates: {
    label: 'Mẫu báo cáo',
    singular: 'Mẫu báo cáo',
    icon: 'file-bar-chart',
    perm: 'reports',
    prefix: 'RPT',
    softDelete: true,
    searchFields: ['code', 'name', 'description', 'dataset'],
    defaultSort: { field: 'name', order: 'asc' },
    listFields: ['code', 'name', 'dataset', 'paperSize', 'orientation', 'updatedAt', 'createdBy', 'isSystem'],
    fields: {
      code: { type: T.STRING, label: 'Mã mẫu', required: true, readonly: true },
      name: { type: T.STRING, label: 'Tên mẫu báo cáo', required: true },
      description: { type: T.TEXT, label: 'Mô tả' },
      dataset: { type: T.STRING, label: 'Nguồn dữ liệu', required: true },
      design: { type: T.JSON, label: 'Thiết kế (JSON)', hidden: true },
      paperSize: { type: T.STRING, label: 'Khổ giấy', default: 'A4' },
      orientation: { type: T.SELECT, label: 'Hướng giấy', options: [
        { value: 'portrait', label: 'Dọc' },
        { value: 'landscape', label: 'Ngang' },
      ], default: 'portrait' },
      createdBy: { type: T.STRING, label: 'Người tạo', readonly: true },
      isSystem: { type: T.BOOL, label: 'Mẫu hệ thống', readonly: true, default: false },
      version: { type: T.NUMBER, label: 'Phiên bản', default: 1 },
    },
  },

  /* ================= TÀI LIỆU ĐÍNH KÈM ================= */
  attachments: {
    label: 'Tài liệu đính kèm',
    singular: 'Tài liệu',
    icon: 'paperclip',
    perm: 'attachments',
    prefix: 'TL',
    softDelete: true,
    searchFields: ['name', 'entity', 'note'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    listFields: ['name', 'entity', 'entityId', 'mimeType', 'size', 'uploadedBy', 'createdAt'],
    fields: {
      name: { type: T.STRING, label: 'Tên tài liệu', required: true },
      entity: { type: T.STRING, label: 'Thuộc đối tượng' },
      entityId: { type: T.STRING, label: 'ID đối tượng' },
      url: { type: T.STRING, label: 'Đường dẫn / Nội dung' },
      mimeType: { type: T.STRING, label: 'Loại' },
      size: { type: T.NUMBER, label: 'Kích thước (bytes)' },
      type: { type: T.SELECT, label: 'Phân loại', options: [
        { value: 'invoice', label: 'Hoá đơn' },
        { value: 'contract', label: 'Hợp đồng' },
        { value: 'handover', label: 'Biên bản bàn giao' },
        { value: 'photo', label: 'Hình ảnh' },
        { value: 'manual', label: 'Tài liệu kỹ thuật' },
        { value: 'other', label: 'Khác' },
      ], default: 'other' },
      uploadedBy: { type: T.STRING, label: 'Người tải lên' },
      note: { type: T.TEXT, label: 'Ghi chú' },
    },
  },
};

/* ------------------------------------------------------------------ */
/* Phân quyền: danh sách module × hành động                            */
/* ------------------------------------------------------------------ */

const PERMISSION_ACTIONS = [
  { key: 'view', label: 'Xem' },
  { key: 'create', label: 'Thêm' },
  { key: 'update', label: 'Sửa' },
  { key: 'delete', label: 'Xoá' },
  { key: 'approve', label: 'Duyệt' },
  { key: 'export', label: 'Xuất / In' },
];

const PERMISSION_MODULES = [
  { key: 'dashboard', label: 'Bảng điều khiển', group: 'Tổng quan' },
  { key: 'assets', label: 'Tài sản', group: 'Nghiệp vụ' },
  { key: 'categories', label: 'Danh mục tài sản', group: 'Danh mục' },
  { key: 'suppliers', label: 'Nhà cung cấp', group: 'Danh mục' },
  { key: 'departments', label: 'Phòng ban', group: 'Danh mục' },
  { key: 'locations', label: 'Vị trí / Kho', group: 'Danh mục' },
  { key: 'assignments', label: 'Cấp phát / Thu hồi', group: 'Nghiệp vụ' },
  { key: 'transfers', label: 'Điều chuyển', group: 'Nghiệp vụ' },
  { key: 'maintenances', label: 'Bảo trì - Sửa chữa', group: 'Nghiệp vụ' },
  { key: 'depreciations', label: 'Khấu hao', group: 'Nghiệp vụ' },
  { key: 'stocktakes', label: 'Kiểm kê', group: 'Nghiệp vụ' },
  { key: 'disposals', label: 'Thanh lý', group: 'Nghiệp vụ' },
  { key: 'warranties', label: 'Bảo hành', group: 'Nghiệp vụ' },
  { key: 'contracts', label: 'Hợp đồng', group: 'Nghiệp vụ' },
  { key: 'reports', label: 'Báo cáo & Thiết kế mẫu', group: 'Báo cáo' },
  { key: 'attachments', label: 'Tài liệu đính kèm', group: 'Báo cáo' },
  { key: 'users', label: 'Người dùng', group: 'Quản trị' },
  { key: 'roles', label: 'Vai trò & Phân quyền', group: 'Quản trị' },
  { key: 'audit_logs', label: 'Nhật ký hệ thống', group: 'Quản trị' },
  { key: 'sessions', label: 'Phiên đăng nhập', group: 'Quản trị' },
  { key: 'settings', label: 'Cấu hình hệ thống', group: 'Quản trị' },
  { key: 'backup', label: 'Sao lưu & Phục hồi', group: 'Quản trị' },
  { key: 'data_tools', label: 'Nhập/Xuất dữ liệu & CSDL', group: 'Quản trị' },
];

/** Tạo object phân quyền đầy đủ */
function fullPermissions(value) {
  const perms = {};
  PERMISSION_MODULES.forEach((m) => {
    perms[m.key] = PERMISSION_ACTIONS.map((a) => a.key);
  });
  return perms;
}

function emptyPermissions() {
  const perms = {};
  PERMISSION_MODULES.forEach((m) => (perms[m.key] = []));
  return perms;
}

function permissionsFor(modules, actions) {
  const perms = emptyPermissions();
  modules.forEach((m) => (perms[m] = actions.slice()));
  return perms;
}

/* ------------------------------------------------------------------ */
/* Cấu hình mặc định                                                   */
/* ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = {
  company: {
    name: 'CÔNG TY TNHH GIẢI PHÁP CÔNG NGHỆ AMS',
    shortName: 'AMS Việt Nam',
    taxCode: '0312345678',
    address: 'Số 12 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh',
    phone: '(028) 3822 1234',
    email: 'info@ams.vn',
    website: 'https://ams.vn',
    representative: 'Nguyễn Văn Minh',
    position: 'Tổng Giám đốc',
    accountant: 'Trần Thị Hồng',
    logo: '',
    bankAccount: '123456789 - Vietcombank CN HCM',
  },
  system: {
    appName: 'AMS Pro',
    appFullName: 'Hệ thống Quản lý Tài sản Doanh nghiệp',
    version: '1.0.0',
    dateFormat: 'DD/MM/YYYY',
    currency: 'VND',
    currencySymbol: '₫',
    digits: 0,
    defaultPaper: 'A4',
    rowsPerPage: 25,
    sessionHours: 12,
    passwordMinLength: 6,
    lockAfterFailed: 5,
    locale: 'vi-VN',
    footerText: 'Hệ thống Quản lý Tài sản AMS Pro — In từ hệ thống',
  },
  numbering: {
    assets: { prefix: 'TS', pattern: '{PREFIX}-{YYYY}-{SEQ:5}', resetYearly: true },
    categories: { prefix: 'DM', pattern: '{PREFIX}-{SEQ:3}', resetYearly: false },
    suppliers: { prefix: 'NCC', pattern: '{PREFIX}-{SEQ:4}', resetYearly: false },
    departments: { prefix: 'PB', pattern: '{PREFIX}-{SEQ:3}', resetYearly: false },
    locations: { prefix: 'VT', pattern: '{PREFIX}-{SEQ:4}', resetYearly: false },
    assignments: { prefix: 'CP', pattern: '{PREFIX}-{YYYY}{MM}-{SEQ:4}', resetYearly: true },
    transfers: { prefix: 'DC', pattern: '{PREFIX}-{YYYY}{MM}-{SEQ:4}', resetYearly: true },
    maintenances: { prefix: 'BT', pattern: '{PREFIX}-{YYYY}{MM}-{SEQ:4}', resetYearly: true },
    depreciations: { prefix: 'KH', pattern: '{PREFIX}-{YYYYMM}-{SEQ:5}', resetYearly: true },
    stocktakes: { prefix: 'KK', pattern: '{PREFIX}-{YYYY}-{SEQ:3}', resetYearly: true },
    disposals: { prefix: 'TL', pattern: '{PREFIX}-{YYYY}-{SEQ:4}', resetYearly: true },
    warranties: { prefix: 'BH', pattern: '{PREFIX}-{SEQ:4}', resetYearly: false },
    contracts: { prefix: 'HD', pattern: '{PREFIX}-{YYYY}-{SEQ:4}', resetYearly: true },
    users: { prefix: 'NV', pattern: '{PREFIX}{SEQ:4}', resetYearly: false },
    report_templates: { prefix: 'MBC', pattern: '{PREFIX}-{SEQ:3}', resetYearly: false },
    attachments: { prefix: 'TL', pattern: '{PREFIX}-{SEQ:5}', resetYearly: false },
  },
  depreciation: {
    defaultMethod: 'straight_line',
    defaultUsefulLifeMonths: 60,
    defaultRate: 20,
    minValue: 30000000,
    fullMonthRule: true,
    expenseAccount: '642',
    assetAccount: '214',
  },
  notifications: {
    maintenanceDaysBefore: 15,
    warrantyDaysBefore: 30,
    emailEnabled: false,
    emailTemplateMaintenance: `Kính gửi {fullName},\n\nTài sản "{assetName}" ({assetCode}) đã đến hạn bảo trì vào ngày {dueDate}.\nVui lòng phối hợp với bộ phận kỹ thuật để sắp xếp bảo trì.\n\nTrân trọng,\n{companyName}`,
    emailTemplateAssign: `Kính gửi {fullName},\n\nBạn đã được bàn giao tài sản "{assetName}" ({assetCode}) vào ngày {date}.\nVui lòng kiểm tra và ký xác nhận biên bản bàn giao.\n\nTrân trọng,\n{companyName}`,
  },
  report: {
    language: 'vi',
    showGrid: true,
    snapToGrid: true,
    gridSize: 8,
    defaultFont: 'Inter, Arial, sans-serif',
    defaultFontSize: 10,
    headerFontSize: 14,
  },
};

/* --------------------------------------------------------------------------
 * Chuẩn hoá metadata:
 * - Mọi thực thể có trường `code` đều dùng nó làm khoá nghiệp vụ (codeField)
 *   để tự sinh mã theo quy tắc đánh mã, kiểm tra trùng và hiển thị.
 * - Bổ sung nhãn/tìm kiếm mặc định nếu thiếu.
 * ------------------------------------------------------------------------ */
Object.keys(ENTITIES).forEach((name) => {
  const entity = ENTITIES[name];
  if (!entity.key) entity.key = name;
  if (entity.fields && entity.fields.code) {
    entity.codeField = entity.codeField || 'code';
    entity.codeLabel = entity.codeLabel || entity.fields.code.label || 'Mã';
  }
  if (!entity.searchFields && entity.fields) {
    entity.searchFields = Object.keys(entity.fields).filter((k) =>
      [T.STRING, T.TEXT].includes(entity.fields[k].type) && !entity.fields[k].computed
    );
  }
  if (!entity.defaultSort) entity.defaultSort = entity.fields && entity.fields.code ? { field: 'code', order: 'asc' } : { field: 'id', order: 'desc' };
});

module.exports = {
  T,
  ENTITIES,
  ASSET_STATUS,
  ASSET_CONDITION,
  DEPRECIATION_METHODS,
  WORKFLOW_STATUS,
  PRIORITY,
  MAINTENANCE_TYPES,
  DISPOSAL_TYPES,
  UNITS,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  DEFAULT_SETTINGS,
  fullPermissions,
  emptyPermissions,
  permissionsFor,
};
