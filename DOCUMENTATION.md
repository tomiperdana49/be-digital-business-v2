# Digital Bisnis Backend v2 — Dokumentasi Lengkap

Dokumentasi teknis menyeluruh untuk backend **Digital Bisnis Dashboard** (`be-v2`) — service yang menghitung dan menyajikan **komisi sales, implementator, dan manager** berdasarkan data invoice dari sistem NIS (billing legacy) dan data karyawan dari Nusawork.

---

## Daftar Isi

1. [Tech Stack](#1-tech-stack)
2. [Arsitektur](#2-arsitektur)
3. [Struktur Folder](#3-struktur-folder)
4. [Environment Variables](#4-environment-variables)
5. [Database](#5-database)
6. [Alur Data (Data Flow)](#6-alur-data-data-flow)
7. [Sinkronisasi Job](#7-sinkronisasi-job)
8. [Logika Bisnis: Perhitungan Komisi](#8-logika-bisnis-perhitungan-komisi)
9. [Periode Fiskal (Cut-off 26–25)](#9-periode-fiskal-cut-off-2625)
10. [Autentikasi & Otorisasi](#10-autentikasi--otorisasi)
11. [API Reference](#11-api-reference)
12. [Error Handling](#12-error-handling)
13. [Menjalankan Proyek](#13-menjalankan-proyek)
14. [Known Issues / Technical Debt](#14-known-issues--technical-debt)

---

## 1. Tech Stack

| Komponen | Teknologi |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Framework HTTP | [Hono](https://hono.dev) v4 |
| Bahasa | TypeScript (strict mode) |
| Database | MySQL (`mysql2/promise`, connection pool) |
| Auth | JWT (HS256, via `hono/jwt`), Google OAuth2 (`google-auth-library`) |
| HTTP Client | `axios` (integrasi Nusawork API & auth API eksternal) |
| Date utility | `date-fns` |

Tidak ada framework testing / test suite pada saat dokumentasi ini dibuat. Tidak ada ORM — semua akses data lewat raw SQL di layer Repository.

---

## 2. Arsitektur

Proyek ini mengikuti **Clean Architecture** dengan 4 layer dan **Manual Dependency Injection** (tanpa DI container/library):

```
Request → Route → Controller → Service → Repository → Database
                      ↓            ↓
                  ApiResponse   Calculate / PeriodHelper (helper murni)
```

- **Controller** — sangat tipis. Hanya extract param/query/body, validasi minimal, panggil service, bungkus hasil dengan `ApiResponse`. Tidak ada raw SQL atau business logic.
- **Service** — seluruh business logic & perhitungan komisi. Tidak ada raw SQL langsung (memanggil Repository).
- **Repository** — hanya akses database (SQL query). Tidak ada business logic.
- **Interface** (`src/interface/`) — kontrak wajib untuk setiap Service & Repository (`IEmployeeService`, `IEmployeeRepository`, dst). Constructor selalu menerima dependency lewat parameter (`constructor(private readonly xRepo: IXRepository)`), **bukan** `static` method.
- **Wiring/DI** — seluruhnya terpusat di [`src/route/api.ts`](src/route/api.ts) (untuk HTTP server) dan masing-masing file di `src/job/*.ts` (untuk cron/script standalone). Tidak ada DI container — instansiasi manual berjenjang.

### Prinsip yang dipegang (dari `gemini.md`)
1. Full Clean Architecture + DI murni via constructor.
2. TypeScript first, hindari `any` di kontrak publik (meski di internal repository masih banyak `any` untuk hasil query mentah).
3. ES Modules, named import untuk `mysql2`.
4. Konfigurasi env **wajib** lewat `src/config/app.ts` — jangan `process.env` langsung di tempat lain.
5. Alias kolom SQL pakai `snake_case`.
6. **Tidak** ada `try/catch` di Controller hanya untuk return JSON statis — pakai `throw new XException(...)`, ditangkap oleh Global Error Handler di `src/index.ts`.
7. Semua response wajib lewat `ApiResponse.success()` / `ApiResponse.error()`.

---

## 3. Struktur Folder

```
src/
├── index.ts                      # Entry point: Hono app, CORS, global error handler
├── config/
│   ├── app.ts                    # Konfigurasi tersentralisasi dari .env
│   └── database.ts               # 2 connection pool MySQL: nisPool & dashboardPool
├── interface/                    # Kontrak TypeScript (Service & Repository)
│   ├── auth.interface.ts
│   ├── employee.interface.ts
│   ├── nis.interface.ts
│   ├── nusawork.interface.ts
│   └── snapshot.interface.ts
├── repository/                   # Akses data murni (SQL query)
│   ├── employee.repository.ts    # CRUD employees + hierarchy (recursive CTE)
│   ├── nis.repository.ts         # Query kompleks ke DB NIS (legacy billing)
│   └── snapshot.repository.ts    # CRUD tabel snapshots (dashboard DB)
├── service/                      # Business logic
│   ├── auth.service.ts           # Login, Google OAuth, JWT
│   ├── employee.service.ts       # Employee & hierarchy logic
│   ├── nis.service.ts            # Passthrough tipis ke NisRepository
│   ├── nusawork.service.ts       # Integrasi Nusawork API (fetch employee)
│   └── snapshot.service.ts       # Kalkulasi komisi & agregasi (inti bisnis)
├── controller/                   # HTTP handler tipis
│   ├── auth.controller.ts
│   ├── employee.controller.ts
│   ├── invoice.controller.ts
│   ├── commission.controller.ts
│   └── additional.controller.ts
├── middleware/
│   ├── auth.middleware.ts        # Verifikasi JWT dari header Authorization
│   └── hierarchy.middleware.ts   # ⚠️ Didefinisikan tapi TIDAK dipakai (lihat §14)
├── helper/
│   ├── calculate.ts              # Semua rumus komisi (Calculate class, static methods)
│   ├── period.ts                 # PeriodHelper: hitung periode fiskal 26–25
│   ├── response.ts                # ApiResponse.success/error (format response standar)
│   └── exception.ts              # Exception class + subclass (400/401/403/404/409/429)
├── job/                           # Script standalone (dijalankan via `bun run`, bukan cron internal)
│   ├── employee.job.ts           # Sync karyawan dari Nusawork → tabel employees
│   ├── internal-invoice.job.ts   # Sync invoice internal dari NIS → tabel snapshots
│   └── resell-invoice.job.ts     # Sync invoice resell dari NIS → tabel snapshots
└── route/
    └── api.ts                    # Definisi semua route Hono + DI wiring

table.sql        # Skema tabel dashboard DB (employees, snapshots)
gemini.md        # Panduan konteks proyek untuk AI assistant
.env.example      # Template environment variable
```

---

## 4. Environment Variables

| Variabel | Deskripsi | Default |
|---|---|---|
| `PORT` | Port HTTP server | `3000` |
| `NODE_ENV` | `development` / `production` (memengaruhi detail error di response) | `development` |
| `DB_NIS_HOST` / `PORT` / `USER` / `PASSWORD` / `NAME` | Koneksi ke DB NIS (billing legacy) | `127.0.0.1` / `3306` / `root` / `` / `nis_db` |
| `DB_DASHBOARD_HOST` / `PORT` / `USER` / `PASSWORD` / `NAME` | Koneksi ke DB dashboard (aplikasi ini) | `127.0.0.1` / `3306` / `root` / `` / `digital_bisnis` |
| `NUSAWORK_API_URL` | Base URL API Nusawork (HRIS) | `''` |
| `NUSAWORK_CLIENT_ID` / `NUSAWORK_CLIENT_SECRET` | Kredensial OAuth client_credentials ke Nusawork | `''` |
| `AUTH_API_URL` | Endpoint API auth eksternal untuk verifikasi username/password | `''` |
| `JWT_SECRET` | Secret untuk sign/verify JWT (HS256) | `'secret'` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Kredensial OAuth2 Google login | `''` |

Semua nilai ini diekspor terstruktur lewat [`src/config/app.ts`](src/config/app.ts) sebagai object `config`. **Jangan** memanggil `process.env` di file lain.

---

## 5. Database

Aplikasi ini terhubung ke **2 database MySQL berbeda** secara bersamaan lewat 2 connection pool terpisah ([`src/config/database.ts`](src/config/database.ts)), masing-masing `waitForConnections: true`, `connectionLimit: 10`.

### 5.1 Dashboard DB (`dashboardPool`) — dimiliki aplikasi ini

Skema lengkap ada di [`table.sql`](table.sql).

**`employees`**

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | INT PK | ID internal (dari `user_id` Nusawork) |
| `employee_id` | VARCHAR(20) | NIK/kode pegawai (dipakai sebagai identifier publik di semua endpoint `:id`) |
| `name`, `email`, `photo_profile` | VARCHAR | Profil |
| `job_position`, `organization_name`, `job_level`, `branch` | VARCHAR | Data organisasi dari Nusawork |
| `manager_id` | INT NULL | FK ke `employees.id` (self-referencing, dipakai recursive CTE hierarchy) |
| `has_dashboard` | BOOLEAN | Apakah karyawan ini berhak akses dashboard (sales, implementator, admin tertentu) |

**`snapshots`** — tabel hasil sinkronisasi dari NIS, sumber utama semua perhitungan komisi.

| Kolom | Tipe | Keterangan |
|---|---|---|
| `ai` | INT PK | ID unik baris invoice dari NIS (`NewCustomerInvoiceInternetCounter.AI`) |
| `invoice_number`, `sequence_number` | BIGINT/INT | Nomor invoice |
| `paid_date` | DATE | Tanggal transaksi/pembayaran — dasar filter periode |
| `subscription` | DECIMAL(15,2) | Nilai DPP (dasar pengenaan komisi) |
| `status` | ENUM | `new`, `upgrade`, `termin`, `recurring`, `prorate` — hasil klasifikasi job sync |
| `month_period` | DECIMAL(15,6) | Jumlah bulan periode invoice (bisa desimal untuk prorata harian) |
| `total_account` | INT | Jumlah akun/user dalam invoice ini |
| `customer_id`, `customer_service_id`, `customer_company` | - | Identitas pelanggan |
| `contract_until_date` | DATE | Tanggal akhir kontrak (dipakai job untuk deteksi status `termin`) |
| `service_group_id` | VARCHAR(20) | mis. `NW` (Nusawork) — memengaruhi aturan status & MRC |
| `service_id`, `service_name` | - | Layanan yang dibeli |
| `service_type` | ENUM | `internal` atau `resell` — menentukan rumus komisi mana yang dipakai |
| `cross_sell_count` | INT | Jumlah layanan digital_business lain yang dimiliki customer yang sama (hanya dihitung untuk internal) |
| `sales_id`, `manager_sales_id`, `implementator_id` | VARCHAR(20) | FK ke `employees.employee_id` |
| `modal` | DECIMAL(15,6) | Harga modal (hanya untuk resell — dasar hitung margin) |
| `is_adjust` | BOOLEAN | Menandai baris yang di-adjust manual. Jika `true`, baris **kebal terhadap crawl ulang** (tidak dihapus & tidak di-overwrite oleh job sync) |

Insert/update ke tabel ini pakai `INSERT ... ON DUPLICATE KEY UPDATE` (upsert berbasis PK `ai`), sehingga job sync bisa dijalankan berulang tanpa duplikasi.

**Perlindungan `is_adjust` saat crawl ulang** — job sync melakukan delete-then-insert. Agar baris yang sudah di-adjust manual tidak tertimpa:
- `deleteSnapshotByDateRangeAndType` menambahkan `AND is_adjust = false` — baris adjusted tidak ikut terhapus.
- `insertSnapshot` membungkus setiap kolom pada `ON DUPLICATE KEY UPDATE` dengan `IF(is_adjust, <nilai lama>, VALUES(<nilai baru>))` — baris adjusted mempertahankan nilainya walau `ai`-nya muncul lagi di hasil crawl.
- Kolom `is_adjust` sengaja **tidak** diikutkan di daftar kolom `INSERT`, jadi baris baru selalu mulai dari `false` (default) dan baris duplikat tetap mempertahankan nilai `is_adjust`-nya. Field ini di-set manual (bukan oleh job) dan diekspos sebagai `isAdjust` di response detail invoice.

### 5.2 NIS DB (`nisPool`) — sistem billing legacy eksternal, read-only

Tabel-tabel ini **bukan** milik aplikasi ini — hanya dibaca (skema PascalCase, tidak ada file DDL-nya di repo ini). Referensi dari [`nis.repository.ts`](src/repository/nis.repository.ts):

| Tabel | Peran |
|---|---|
| `NewCustomerInvoiceInternetCounter` | Baris transaksi invoice (AI = primary key, dpp, trx_date, dst) |
| `NewCustomerInvoice` | Header invoice |
| `CustomerInvoiceTemp` / `CustomerInvoiceTemp_Custom` | Detail invoice (nomor, periode, total_account) |
| `InvoiceTypeMonth` | Lookup jumlah bulan per tipe invoice |
| `CustomerServices` / `CustomerServicesHistory` | Layanan aktif pelanggan (SalesId, ManagerSalesId, ContractUntil, CustStatus) |
| `Customer` | Data pelanggan (`Surveyor` = implementator_id) |
| `Services` | Master layanan (`ServiceGroup`, `BusinessOperation` = internal/resell, `ServiceCategory`) |
| `CustomerServiceCost` | `modal_cost_per_user` — dasar hitung margin resell |

---

## 6. Alur Data (Data Flow)

```
┌─────────────┐      ┌──────────────┐      ┌───────────────┐      ┌─────────────┐
│  Nusawork    │ ──►  │ employee.job │ ──►  │  employees     │      │             │
│  (HRIS API)  │      │              │      │  (dashboard DB)│      │             │
└─────────────┘      └──────────────┘      └───────────────┘      │   REST API   │
                                                                     │  (Hono app) │
┌─────────────┐      ┌──────────────────┐   ┌───────────────┐      │             │
│   NIS DB     │ ──►  │ internal/resell  │──►│  snapshots    │ ──►  │             │
│  (billing)   │      │ -invoice.job     │   │  (dashboard DB)│      └─────────────┘
└─────────────┘      └──────────────────┘   └───────────────┘
```

1. **Job sync** (dijalankan manual/cron eksternal, **bukan** cron internal aplikasi) menarik data mentah dari sumber eksternal (Nusawork / NIS), melakukan transformasi & klasifikasi, lalu upsert ke dashboard DB.
2. **REST API** hanya membaca dari dashboard DB (`employees`, `snapshots`). Perhitungan komisi (persentase, nominal, margin, trend) dilakukan **on-the-fly saat request** oleh `Calculate` helper — tidak disimpan hasil akhirnya di DB, hanya data mentahnya.
3. Pengecualian: endpoint implementator (`getChurnCountByImplementator`, `getImplementatorInvoiceDetail`) tetap query langsung ke `nisPool` saat request (untuk churn count), jadi request tersebut menyentuh 2 database sekaligus.

---

## 7. Sinkronisasi Job

Job dijalankan via CLI (`bun run sync:*`), bukan scheduler bawaan — asumsi ada cron eksternal (mis. `crontab`, CI scheduler) yang memanggil script ini secara berkala (kemungkinan tiap 25/26 tanggal periode, atau harian).

### 7.1 `employee.job.ts` — `bun run sync:employee`
- Fetch 3 kategori dari Nusawork: **Sales Digital** (`Sales Nusawork` / `Sales GWS` org), **Implementator** (`Nusawork Product Manager` / `Implementator Nusawork`), **Admin** (NIK spesifik hardcode + org `Finance`/`BIS` + level `VP`/`Direksi`).
- Gabungkan & dedup berdasarkan `employeeId` (Map, entry terakhir menang jika duplikat lintas kategori — urutan: sales → admin → implementator).
- Upsert satu per satu ke `employees` (bukan bulk insert) — error per-row tidak menghentikan proses, hanya di-log. Upsert juga mengosongkan `deactivated_at` (karyawan yang aktif lagi otomatis pulih).
- Setelah upsert, karyawan resign diambil dari Nusawork (`active_status: inactive`) dan `deactivated_at` diisi dengan `resign_date`-nya. Karyawan lain yang **tidak ada** di hasil sync (mis. pindah unit) diberi `deactivated_at = NOW()`. Baris tidak dihapus supaya snapshot komisi lama tetap ter-JOIN.
- Karyawan nonaktif tidak bisa login/refresh token, tidak muncul di pilihan target, dan tidak di-mapping oleh `manager-mapping.job.ts` untuk periode baru. Di "My Team" (`GET /employee/:id/hierarchy?month=&year=`) karyawan hanya tampil kalau `deactivated_at` >= awal periode yang dipilih (cut-off 26–25), dengan badge **Nonaktif**. Otorisasi halaman komisi (`hierarchy.middleware.ts`) tidak memakai filter periode, jadi komisi lama karyawan resign tetap bisa dibuka.
- **Catatan hardcoded**: NIK admin `0202589`, `0201325`, `0202314` ditulis literal di [`nusawork.service.ts`](src/service/nusawork.service.ts) — perlu diubah manual di kode jika ada pergantian personel.

### 7.2 `internal-invoice.job.ts` — `bun run sync:internal-invoice [startDate] [endDate]`
- Default periode: bulan berjalan (cut-off 26–25), atau override via argumen CLI.
- Hapus dulu (`DELETE`) snapshot lama untuk range tanggal + `service_type = 'internal'`, lalu insert ulang — jadi job ini **idempotent per date range** meski bukan pure upsert (delete-then-insert, bukan hanya upsert).
- **Klasifikasi status** (logika prioritas berurutan — lihat kode untuk detail lengkap):
  1. Jika `service_group_id = 'NW'` dan deskripsi invoice mengandung kata "termin" (regex word-boundary) → `termin`.
  2. `new_subscription > 0` & bukan upgrade & bukan prorate → `new`.
  3. `is_upgrade = 1` & bukan prorate → `upgrade`.
  4. `is_prorate = 1` & bukan upgrade → `prorate`.
  5. `invoice_type > 0` → `termin` jika (di luar kontrak aktif **dan** `service_group_id = 'NW'`), selain itu `recurring`.
  6. Kondisi lain fallback ke `recurring`.
- `month_period` di-cap maksimal 12 untuk `service_group_id = 'NW'` (mis. kontrak 24 bulan dicatat sebagai 12).
- `modal` selalu `null` (hanya relevan untuk resell).

### 7.3 `resell-invoice.job.ts` — `bun run sync:resell-invoice [startDate] [endDate]`
- Klasifikasi status lebih sederhana (tanpa deteksi `termin` dari deskripsi — resell tidak mengenal status ini dari sumber data).
- **Prorata modal & month_period berbasis kalender riil**, bukan asumsi 30 hari:
  - Jika periode invoice (`period_start_date`–`period_end_date`) tepat kelipatan bulan penuh (mis. 19 Apr–18 Mei), `month_period` = jumlah bulan bulat, `modal` = modal penuh.
  - Jika tidak tepat kelipatan bulan (periode "ganjil"), hitung **prorata per hari** menggunakan jumlah hari aktual di tiap bulan kalender yang dilewati (`getDaysInMonth`), lalu jumlahkan pecahan per-chunk bulan. Ini memastikan modal & month_period akurat walau invoice dimulai di tengah bulan.

---

## 8. Logika Bisnis: Perhitungan Komisi

Semua rumus ada di [`src/helper/calculate.ts`](src/helper/calculate.ts) (class `Calculate`, semua method `static`, pure function — tidak ada I/O). **Aturan ini adalah keputusan bisnis yang sudah disepakati — jangan diubah tanpa approval eksplisit.**

### 8.1 Komisi Sales — Internal (`Calculate.internalSalesCommission`)

| Status | Persentase |
|---|---|
| `upgrade` / `prorate` | **20%** |
| `new` / `termin`, dengan `cross_sell_count > 0` | **15%** |
| `new` / `termin`, tanpa cross-sell | **12%** |
| `recurring` (atau status lain) | **1%** |

**Aturan khusus pembayaran dimuka >12 bulan** (hanya untuk `status = 'new'` dan `months > 12`):
```
first12MonthsAmount = dpp × (12 / months)
remainingAmount     = dpp − first12MonthsAmount
commissionAmount    = first12MonthsAmount × (rate/100) + remainingAmount × 1%
```
Jadi 12 bulan pertama dapat komisi full rate (15%/12%), sisa bulan hanya 1% (setara recurring).

### 8.2 Komisi Sales — Resell (`Calculate.resellSalesCommission`)

Untuk status `new`/`prorate`/`upgrade` (juga dasar untuk `termin`), dihitung dulu **margin**:
```
price  = subscription / totalAccount        (totalAccount fallback 1 jika 0)
markup = price − modal                       (jika modal = 0 → markup = 0, margin = 2.5%)
margin = (markup / modal) × 100              (catatan: pembagi MODAL, bukan price — lihat §14)
```

| Kondisi | Komisi |
|---|---|
| `status = 'recurring'` | **0.5%** dari `subscription` |
| margin ≥ 15% | **5%** |
| margin ≥ 10% (dan < 15%) | **4%** |
| margin < 10% | **2.5%** |
| status lain (fallback) | **2.5%** |

`commissionAmount = subscription × (rate/100)`. Field `price`, `markup`, `margin` ikut dikembalikan untuk ditampilkan di detail invoice.

### 8.3 Komisi Implementator (`Calculate.implementatorCommission`)

Prorata dulu jika status termasuk siklus baru:
```
proratedDpp = (status ∈ {new, upgrade, prorate, termin}) ? dpp / monthPeriod : dpp
```

| Kondisi | Persentase | `type` |
|---|---|---|
| `status = 'recurring'` | **1%** | `recurring` |
| `churnCount > 0` (dalam periode) | **17.5%** | `base` |
| Tidak ada churn | **20%** | `retention` |

`churnCount` dihitung per implementator per periode lewat query terpisah ke NIS ([`getChurnCountByImplementator`](src/repository/nis.repository.ts)) — customer dengan `ServiceId IN ('NWBUS','NWADV')`, `CustStatus = 'NA'`, `CustUnregDate` dalam rentang periode, `Surveyor = implementatorId`. **Catatan**: `churnCount` global untuk seluruh periode dipakai untuk semua baris snapshot implementator itu (bukan dihitung per-invoice), jadi satu customer churn membuat semua invoice di periode itu memakai rate 17.5%.

### 8.4 Komisi Manager
Tidak ada rumus khusus di `Calculate` — dihitung langsung di `SnapshotService`:
```
managerCommission = totalCommission(seluruh staff di bawahnya) × 25%
```
di mana `totalCommission` = jumlah komisi sales internal + resell (new + recurring) seluruh staff yang berada langsung di bawah manager tersebut (`employees.manager_id`).

### 8.5 MRC (Monthly Recurring Cost)
```
mrc = subscription / monthPeriod
```
Namun **`mrc = 0` untuk status `recurring` dan `termin`** (baik di invoice detail maupun agregasi commission summary) — MRC hanya relevan untuk siklus baru/upgrade.

### 8.6 Trend (`Calculate.trend`)
Dipakai di semua endpoint commission summary (non-yearly) untuk membandingkan periode berjalan vs periode sebelumnya:
```
growth     = current − previous
percentage = previous ≠ 0 ? (growth/previous)×100 : (current > 0 ? 100 : 0)
trend      = growth ≥ 0 ? 'up' : 'down'
```
Periode sebelumnya dihitung dengan menggeser mundur `startDate`/`endDate` sepanjang durasi periode berjalan (bukan selalu bulan kalender sebelumnya — lihat kode di `SnapshotService`).

---

## 9. Periode Fiskal (Cut-off 26–25)

Diimplementasikan di [`PeriodHelper`](src/helper/period.ts) dan dipakai konsisten di seluruh endpoint invoice/commission (kecuali endpoint `*Yearly` yang otomatis loop 12 bulan).

**Aturan**: satu "bulan" bisnis = tanggal **26 bulan (N-1)** sampai **25 bulan N**. Jika hari ini tanggal >25, maka otomatis dianggap masuk periode bulan berikutnya.

Contoh:
| Tanggal hari ini | Periode berjalan |
|---|---|
| 2026-06-04 (≤25) | `2026-05-26` s/d `2026-06-25` |
| 2026-06-26 (>25) | `2026-06-26` s/d `2026-07-25` |

Method yang tersedia:
- `getStartAndEndDateForCurrentMonth()` — periode saat ini.
- `getStartAndEndDateForPreviousMonth()` — ⚠️ saat ini identik dengan `getStartAndEndDateForCurrentMonth()` (lihat §14, kemungkinan bug/belum selesai; namun tidak dipanggil dari manapun saat ini).
- `getStartAndEndDateForMonth(year, month)` — periode untuk bulan tertentu (1=Januari).
- `getPeriodByDate(date)` — deteksi tahun+bulan+range dari sebuah tanggal.
- `getPeriodFromQuery(monthQuery?, yearQuery?)` — dipakai semua controller: kalau query kosong → default hari ini; kalau salah satu ada → pakai default lawannya dari `today`.

---

## 10. Autentikasi & Otorisasi

### 10.1 Metode Login (`AuthService`, [`auth.service.ts`](src/service/auth.service.ts))

| Endpoint | Mekanisme |
|---|---|
| `POST /api/auth/login` | Verifikasi username/password ke `AUTH_API_URL` eksternal (harus response `201`), lalu cari employee di dashboard DB by `employeeId` |
| `POST /api/auth/dev` | **Tanpa password** — langsung generate token berdasarkan `employeeId` saja. ⚠️ Harus dipastikan tidak aktif/dibatasi di production |
| `POST /api/auth/google` | OAuth2 code exchange via `google-auth-library`, cari employee by email dari payload Google |
| `POST /api/auth/refresh` | Verifikasi refresh token, re-issue access+refresh token baru |

### 10.2 Struktur JWT
- **Access token** — payload `{ sub: employee_id, svp: manager_id, email, role: job_position, exp: +15 menit }`.
- **Refresh token** — payload `{ sub: employee_id, email, exp: +7 hari }`.
- Algoritma **HS256**, secret dari `config.auth.jwtSecret`.

### 10.3 Middleware
- **`authMiddleware`** ([`auth.middleware.ts`](src/middleware/auth.middleware.ts)) — verifikasi `Authorization: Bearer <token>`, set `c.set('user', payload)`. Dipakai di: `/auth/me`, `/auth/logout`, `/employee/:id`, `/employee/:id/hierarchy`.
- **`hierarchyMiddleware`** — ⚠️ dead code, lihat §14.

### 10.4 Cakupan Proteksi Route
Endpoint **komisi, invoice, dan team saat ini TIDAK memakai `authMiddleware`** (lihat [`api.ts`](src/route/api.ts) — komentar "Protected" ada tapi middleware tidak dipasang). Siapa pun yang tahu `employee_id` target bisa mengakses data komisi orang tersebut tanpa token. Perlu dikonfirmasi apakah ini disengaja (mis. dilindungi di layer gateway/FE lain) — lihat §14.

---

## 11. API Reference

Base path: `/api`. Semua response mengikuti format standar (lihat §12).

### Auth

| Method | Path | Auth | Body | Deskripsi |
|---|---|---|---|---|
| POST | `/auth/login` | Publik | `{ employeeId, password }` | Login via auth API eksternal |
| POST | `/auth/dev` | Publik | `{ employeeId }` | Login tanpa password (dev only) |
| POST | `/auth/google` | Publik | `{ code }` | Login via Google OAuth2 code |
| POST | `/auth/refresh` | Publik | `{ refreshToken }` | Refresh access token |
| GET | `/auth/me` | JWT | - | Ambil profil user dari token |
| POST | `/auth/logout` | JWT | - | Stateless (tidak invalidate token di server) |

### Employee

| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| GET | `/employee/:id` | JWT | Detail employee by `employee_id`, termasuk info manager (join) |
| GET | `/employee/:id/hierarchy` | JWT | Daftar subordinate (recursive CTE); jika `manager_id` null → return **semua** employee `has_dashboard=true` |

### Invoice (detail baris, bukan agregat)

Query param opsional untuk semua: `?month=&year=` (default: periode berjalan, cut-off 26–25).

| Method | Path | Deskripsi |
|---|---|---|
| GET | `/invoice/:id/internal` | Detail invoice internal milik sales `:id`, termasuk info implementator |
| GET | `/invoice/:id/implementator` | Detail invoice yang ditangani implementator `:id`, termasuk info sales |
| GET | `/invoice/:id/resell` | Detail invoice resell milik sales `:id`, termasuk `price`/`markup`/`margin` |

**Contoh response** `GET /invoice/E001/internal`:
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Internal invoice retrieved successfully",
  "data": [
    {
      "ai": 12345,
      "invoiceNumber": 987,
      "sequenceNumber": 1,
      "paidDate": "2026-06-10",
      "status": "new",
      "monthPeriod": 12,
      "monthPeriodSummary": "1 Year",
      "totalAccount": 5,
      "customerId": "C001",
      "customerServiceId": 555,
      "customerCompany": "PT Contoh",
      "contractUntilDate": "2027-06-10",
      "serviceGroupId": "NW",
      "serviceId": "NWBUS",
      "serviceName": "Nusawork Business",
      "serviceType": "internal",
      "crossSellCount": 1,
      "implementator": { "name": "Budi", "employeeId": "E010", "photoProfile": "..." },
      "subscription": 12000000,
      "mrc": 1000000,
      "commissionPercentage": 15,
      "commission": 1800000
    }
  ]
}
```

### Commission (agregat + trend vs periode sebelumnya)

| Method | Path | Query | Deskripsi |
|---|---|---|---|
| GET | `/commission/:id/implementator` | `?month=&year=` | Ringkasan komisi implementator + trend |
| GET | `/commission/:id/implementator/yearly` | `?year=` | 12 bulan (Jan–Des) komisi implementator, tanpa trend |
| GET | `/commission/:id/sales` | `?month=&year=` | Ringkasan komisi sales (internal+resell gabungan) + trend |
| GET | `/commission/:id/sales/yearly` | `?year=` | 12 bulan komisi sales |
| GET | `/commission/:id/manager` | `?month=&year=` | Total komisi manager (25% dari total komisi seluruh staff) + trend |
| GET | `/commission/:id/manager/yearly` | `?year=` | 12 bulan komisi manager |

**Contoh response** `GET /commission/E001/sales`:
```json
{
  "success": true,
  "statusCode": 200,
  "message": "sales commission retrieved successfully",
  "data": {
    "commission": {
      "new":       { "trend": "up", "value": 5000000, "percentage": 12.5, "growth": 555000 },
      "recurring": { "trend": "up", "value": 1200000, "percentage": 4.3,  "growth": 50000 },
      "total":     { "trend": "up", "value": 6200000, "percentage": 10.8, "growth": 605000 }
    },
    "mrc":         { "trend": "down", "value": 3000000, "percentage": -2.1, "growth": -64000 },
    "subscription":{ "trend": "up",  "value": 24000000, "percentage": 8.0, "growth": 1780000 },
    "newCustomer": { "trend": "up",  "value": 3, "percentage": 50, "growth": 1 },
    "newAccount":  { "trend": "up",  "value": 12, "percentage": 20, "growth": 2 }
  }
}
```

`/commission/:id/manager*` dan `/team/:id/manager*` mengembalikan `404 "manager not found"` jika `:id` tidak ditemukan di tabel `employees` sebagai manager (dicari via `getManagerById` → butuh `manager[0].id` untuk query staff).

### Team (breakdown per staff — khusus manager)

| Method | Path | Query | Deskripsi |
|---|---|---|---|
| GET | `/team/:id/manager` | `?month=&year=` | Komisi tiap staff di bawah manager `:id` (bukan agregat) |
| GET | `/team/:id/manager/yearly` | `?year=` | Sama, tapi breakdown 12 bulan per staff |

### Additional

| Method | Path | Query | Deskripsi |
|---|---|---|---|
| GET | `/additional/period` | `?month=&year=` | Utility murni — return `{ year, month, startDate, endDate }` hasil `PeriodHelper` |

---

## 12. Error Handling

Global error handler di [`src/index.ts`](src/index.ts):
- Jika error adalah instance `Exception` (dan subclass-nya) → response `ApiResponse.error(message, status, context)`.
- Jika error lain (tak terduga) → `500 Internal Server Error`; di `NODE_ENV !== 'production'`, response menyertakan `message` asli + `stack` untuk debugging (disembunyikan di production).

**Exception subclass tersedia** ([`exception.ts`](src/helper/exception.ts)):

| Class | Status |
|---|---|
| `BadRequestException` | 400 |
| `UnauthorizedException` | 401 |
| `ForbiddenException` | 403 |
| `NotFoundException` | 404 |
| `ConflictException` | 409 |
| `TooManyRequestsException` | 429 |

**Format response error standar**:
```json
{
  "success": false,
  "statusCode": 401,
  "message": "Invalid or expired token",
  "errors": null
}
```

**Catatan inkonsistensi**: sebagian controller (`InvoiceController`, `CommissionController`) memakai `return ApiResponse.error(c, "...", 400)` langsung untuk validasi param `:id` kosong, bukan `throw new BadRequestException(...)`. Ini menyimpang dari guideline §2 poin 6 di `gemini.md` (meski secara fungsional hasilnya sama).

---

## 13. Menjalankan Proyek

```sh
# Install dependencies
bun install

# Copy & isi environment variable
cp .env.example .env

# Jalankan dev server (hot reload)
bun run dev
# → http://localhost:3000

# Build production bundle
bun run build
# → dist/index.js (minified, target: bun)

# Jalankan job sinkronisasi manual
bun run sync:employee
bun run sync:internal-invoice [startDate] [endDate]   # default: periode berjalan
bun run sync:resell-invoice [startDate] [endDate]      # default: periode berjalan
```

Tidak ada script `test`, `lint`, atau `typecheck` terdefinisi di `package.json` — validasi tipe saat ini hanya implisit lewat `tsc` bawaan editor / build step Bun.

---

## 14. Known Issues / Technical Debt

Daftar temuan dari review kode (belum diperbaiki, murni observasi untuk referensi):

1. **`hierarchyMiddleware` adalah dead code** ([`hierarchy.middleware.ts`](src/middleware/hierarchy.middleware.ts)) — tidak pernah di-import/dipasang di `api.ts` manapun. Selain itu isinya memanggil `new EmployeeService()` tanpa argumen, padahal constructor `EmployeeService` mewajibkan `employeeRepository: IEmployeeRepository` — jika suatu saat dipasang tanpa diperbaiki, akan **error runtime langsung** (`undefined.getEmployeeByEmployeeId is not a function`), sekaligus melanggar aturan DI murni di `gemini.md`.
2. **Endpoint komisi/invoice/team tidak dilindungi `authMiddleware`** — siapa pun yang tahu `employee_id` bisa mengakses data komisi personal orang lain tanpa token. Perlu dikonfirmasi apakah ini disengaja (proteksi di layer lain) atau harus ditambahkan `hierarchyMiddleware` yang saat ini masih broken (poin 1).
3. **`PeriodHelper.getStartAndEndDateForPreviousMonth()` secara literal identik** dengan `getStartAndEndDateForCurrentMonth()` — namanya menyiratkan seharusnya mundur satu periode, tapi implementasinya sama persis. Saat ini tidak dipanggil dari manapun (services menghitung "periode sebelumnya" secara manual sendiri), jadi tidak berdampak fungsional — tapi berpotensi jadi jebakan (trap) kalau dipakai di masa depan.
4. **Formula margin resell membagi dengan `modal`, bukan `price`** ([`calculate.ts:96`](src/helper/calculate.ts)) — `margin = (markup / modal) * 100`. Definisi margin secara umum biasanya `markup / price` (margin atas harga jual) vs `markup / modal` (markup rate atas cost). Ini kemungkinan disengaja sesuai keputusan bisnis (lihat commit `21caf5c fix: change calculate (harga jual - harga modal / harga modal X 100%)`), tapi penamaan variabel `margin` bisa membingungkan karena secara istilah akuntansi umum itu lebih tepat disebut "markup percentage".
5. **`POST /auth/dev`** login tanpa password sama sekali (hanya butuh `employeeId` valid) — pastikan endpoint ini dinonaktifkan/dibatasi IP di lingkungan production.
6. **NIK admin hardcoded** (`0202589`, `0201325`, `0202314`) di [`nusawork.service.ts`](src/service/nusawork.service.ts) — perubahan personel admin harus mengubah kode + deploy ulang, tidak configurable.
7. **Job sync bukan cron internal** — mengandalkan penjadwal eksternal (cron OS/CI) yang tidak terdokumentasi di repo ini; jadwal riil (jam berapa, sistem apa yang memicu) tidak diketahui hanya dari membaca kode.
8. **Tidak ada test suite** — semua perubahan pada `Calculate` (rumus komisi) berisiko regresi silent karena tidak ada unit test yang memverifikasi angka.
