# Hướng dẫn sử dụng — AI Knowledge Base

Ứng dụng dùng **một giao diện chung**; mỗi tài khoản chỉ **thấy/làm được phần theo quyền**. Badge role trên header cho biết bạn đang là `owner` / `admin` / `member` / `viewer`.

---

## 1. Đăng nhập

1. Mở http://127.0.0.1:3000  
2. Đăng nhập bằng tài khoản demo (mật khẩu chung `Demo1234!`):

| Role | Email |
|------|--------|
| Owner | `demo@akb.local` |
| Admin | `admin@akb.local` |
| Member | `member@akb.local` |
| Viewer | `viewer@akb.local` |

3. Chọn tổ chức **Acme Corp** ở góc trên (nếu có nhiều org).

Trong app, mở menu **Hướng dẫn** để xem lại nội dung này.

---

## 2. Luồng dùng nhanh (3 bước)

```
① Kho tri thức  →  tải / quản lý tài liệu
② Tìm kiếm      →  tìm đoạn văn trong tài liệu
③ Chat AI       →  hỏi đáp kèm nguồn trích dẫn
```

Hoặc từ **Tổng quan**: gõ câu hỏi vào ô lớn → **Hỏi AI**.

Câu hỏi mẫu: *How many remote days are allowed?* / *Được remote bao nhiêu ngày mỗi tuần?*

---

## 3. Menu bên trái nghĩa là gì?

| Menu | Dùng để |
|------|---------|
| **Tổng quan** | Hỏi nhanh AI + xem danh sách kho tri thức |
| **Kho tri thức** | Tạo kho, mở kho, tải PDF/DOCX/MD/TXT/ảnh (OCR) |
| **Chat AI** | Hội thoại với AI dựa trên 1 kho đã chọn |
| **Tìm kiếm** | Tìm đoạn văn (không sinh câu trả lời dài) |
| **Thành viên** | Xem / thêm người (admin+) |
| **Phân tích** | Thống kê dùng AI (admin+) |
| **Cài đặt** | Hồ sơ, mật khẩu, tùy chọn org |
| **Super Admin** | Chỉ tài khoản Super Admin — quản trị hệ thống |
| **Hướng dẫn** | Trang hướng dẫn trong app |

### Thông báo

Chuông trên header hiện badge số chưa đọc. Hệ thống gửi thông báo khi:

- Có **yêu cầu tạo tổ chức** → Super Admin
- Yêu cầu được **phê duyệt / từ chối** → người gửi
- Tài khoản bị **vô hiệu hóa / kích hoạt**, cấp/gỡ **Super Admin** → user đó

### Super Admin

Tài khoản trong `PLATFORM_ADMIN_EMAILS` (vd. `demo@akb.local`) là **Super Admin** (`isPlatformAdmin`). Menu **Super Admin** → `/app/super-admin`:

| Tab | Việc làm |
|-----|----------|
| **Tổng quan** | Số tài khoản, org, request AI & chi phí tháng |
| **Yêu cầu org** | Phê duyệt / từ chối tạo tổ chức |
| **Tài khoản** | Tìm user, vô hiệu hóa, cấp/gỡ Super Admin |
| **Tổ chức** | Sửa provider AI / quota / plan, vô hiệu hóa org |
| **AI & chi phí** | Usage toàn hệ thống, chi phí theo org/feature/provider |
| **Cấu hình** | Provider mặc định + rate USD/1k token |
| **Job lỗi** | Ingestion job failed |

### Tạo tổ chức

- Mọi user đăng nhập đều **gửi được yêu cầu** tạo tổ chức (Tổng quan / Cài đặt).
- Tổ chức **chỉ được tạo sau khi** Super Admin **phê duyệt** tại **Super Admin → Yêu cầu org**.
- Super Admin tự tạo thì được **auto-approve** (tiện seed/ops).

---

## 4. Phân quyền — ai làm được gì?

| Việc | Owner | Admin | Member | Viewer |
|------|:-----:|:-----:|:------:|:------:|
| Hỏi AI / Tìm kiếm | ✓ | ✓ | ✓ | ✓ |
| Tải tài liệu lên | ✓ | ✓ | ✓ | ✗ |
| Tạo kho tri thức | ✓ | ✓ | tùy* | ✗ |
| Thêm thành viên | ✓ | ✓ | ✗ | ✗ |
| Xem Phân tích | ✓ | ✓ | ✗ | ✗ |
| Xóa tổ chức | ✓ | ✗ | ✗ | ✗ |

\* Member tạo được kho khi Owner/Admin bật *“Cho phép thành viên tạo kho tri thức”* trong **Cài đặt**.

Cùng một màn hình: nút không có quyền sẽ **không hiện** hoặc báo không đủ quyền.

---

## 5. Chi tiết từng chức năng

### Kho tri thức
1. Vào **Kho tri thức** → tạo kho (nếu có quyền) hoặc mở kho có sẵn (vd. *HR Policies*).  
2. Trong kho: **Upload** file `.md` / `.txt` / `.pdf` / `.docx` / ảnh (`.png` `.jpg` `.webp` `.tiff` — OCR).  
3. Đợi trạng thái tài liệu = **ready** rồi mới chat/search hiệu quả.

### AI providers (Admin / Owner)
Trong **Cài đặt** chọn:
- **Text → Vector**: `Mock` / `OpenAI` / `Gemini` (embedding)
- **Text → Answer**: `Mock` / `OpenAI` / `Gemini` (chat)
- **Image → Text (OCR)**: tự chạy khi upload ảnh / PDF scan (cần Tesseract trên máy AI)
- **Access control**: `org_wide` (mặc định) hoặc `restricted` (ACL theo KB/document)

Cần set `OPENAI_API_KEY` / `GEMINI_API_KEY` trong `apps/ai/.env`. Đổi Vector provider → **Xử lý lại** tài liệu cũ.

### RAG nâng cao (enterprise)
- Hybrid search (vector + FTS) + **rerank** local
- Chat có **query rewrite**; bật **Research** để multi-hop retrieve
- **ACL**: Cài đặt → Restricted, rồi Kho tri thức → Quyền
- **Verify tài liệu** (Guru-like): nút Xác minh trên danh sách tài liệu; Search có lọc *Chỉ nguồn đã xác minh*
- **Connectors** (admin): local, Google Drive, Notion/Confluence/Slack export → menu **Kết nối**
- **People**: đồ thị người/chủ đề nhẹ → menu **Con người**
- **Analytics**: chạy RAG eval + xem audit trail
- **Cài đặt**: DLP, retention (ngày), hạn mức AI/tháng
- Slack/Teams: webhook `POST /api/v1/integrations/slack/commands/:orgId` (header `x-akb-integration-secret`)
- MCP: token trong API admin; `POST /api/v1/mcp/:orgId/call`
- Eval CLI: `node scripts/eval-rag.mjs`

### Chat AI
1. Chọn **kho** ở thanh trên.  
2. Gõ câu hỏi → **Gửi**.  
3. Xem panel **Nguồn** bên phải (citations).  
4. Có thể bật *Rewrite* / *Research* (nâng cao).

### Tìm kiếm
1. Chọn kho → gõ từ khóa → **Tìm**.  
2. Kết quả là đoạn văn + điểm liên quan.  
3. Bấm **Hỏi AI** để chuyển câu đó sang Chat.

### Thành viên (Admin / Owner)
- Thêm user đã đăng ký bằng email + role.  
- Hoặc tạo **link mời** → gửi cho người khác mở `/invite/...`.

### Cài đặt
- Đổi tên / mật khẩu.  
- Admin+: đổi tên org, bật member tạo KB, chọn AI providers.  
- Owner: có thể xóa org.

---

## 6. Mẹo khi “không hiểu UI”

1. Nhìn **badge role** trên header trước.  
2. Viewer: chỉ cần **Tổng quan / Chat / Tìm kiếm**.  
3. Muốn thêm tài liệu: đăng nhập **member+** → mở kho → Upload.  
4. Mất kho / org: kiểm tra dropdown tổ chức góc trên.  
5. Chat trống: chọn đúng kho và đảm bảo đã có document **ready**.

---

## 7. Chạy hệ thống local

```bash
cd "/Users/nhuphuc/Projects/AI KNOWLEDGE BASE"
./scripts/dev-up-local.sh
```

- Web: http://127.0.0.1:3000  
- API health: http://127.0.0.1:3001/api/v1/health  

Seed lại data demo (nếu cần):

```bash
node scripts/seed-demo.mjs
```
