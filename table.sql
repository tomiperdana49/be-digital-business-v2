CREATE TABLE employees (
    id INT PRIMARY KEY,
    employee_id VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    photo_profile VARCHAR(255) NOT NULL,
    job_position VARCHAR(255) NOT NULL,
    organization_name VARCHAR(255) NOT NULL,
    job_level VARCHAR(50) NOT NULL,
    branch_id VARCHAR(20) NULL,
    branch VARCHAR(255) NOT NULL,
    manager_id INT NULL,
    has_dashboard BOOLEAN NOT NULL DEFAULT false,
    is_admin BOOLEAN NOT NULL DEFAULT false,
    -- Diisi saat karyawan tidak lagi muncul di daftar aktif Nusawork (resign / pindah unit).
    -- NULL = aktif. Baris tidak pernah dihapus supaya riwayat komisi tetap bisa di-JOIN.
    deactivated_at DATETIME NULL
);

CREATE TABLE snapshots (
    ai INT PRIMARY KEY,
    invoice_number BIGINT NULL,
    sequence_number INT NULL,
    paid_date DATE NULL,
    subscription DECIMAL(15, 2) NULL,
    status ENUM('new', 'upgrade', 'termin', 'recurring', 'prorate', 'add', 'setup') NOT NULL DEFAULT 'recurring',
    month_period DECIMAL(15, 6) NULL,
    total_account INT NULL,
    customer_id VARCHAR(20) NULL,
    customer_service_id INT NULL,
    customer_company VARCHAR(255) NULL,
    contract_until_date DATE NULL,
    service_group_id VARCHAR(20) NULL,
    service_id VARCHAR(20) NULL,
    service_name VARCHAR(255) NULL,
    service_type ENUM('internal', 'resell') NOT NULL,
    cross_sell_count INT NOT NULL DEFAULT 0,
    sales_id VARCHAR(20) NULL,
    manager_sales_id VARCHAR(20) NULL,
    implementator_id VARCHAR(20) NULL,
    modal DECIMAL(15, 6) NULL,
    is_adjust BOOLEAN NOT NULL DEFAULT false,
    base_commission DECIMAL(15, 2) NULL,
    mrc_override DECIMAL(15, 2) NULL
);

-- Migration untuk database yang sudah ada:
-- ALTER TABLE employees ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
-- ALTER TABLE employees ADD COLUMN branch_id VARCHAR(20) NULL AFTER job_level;
-- ALTER TABLE snapshots ADD COLUMN is_adjust BOOLEAN NOT NULL DEFAULT false;
-- ALTER TABLE snapshots MODIFY COLUMN status ENUM('new', 'upgrade', 'termin', 'recurring', 'prorate', 'add', 'setup') NOT NULL DEFAULT 'recurring';
-- ALTER TABLE snapshots ADD COLUMN base_commission DECIMAL(15, 2) NULL;
-- ALTER TABLE snapshots ADD COLUMN mrc_override DECIMAL(15, 2) NULL;
-- ALTER TABLE employees ADD COLUMN deactivated_at DATETIME NULL;

-- Mapping manager -> staff per periode (year, month).
-- employee_id & manager_id merujuk ke employees.id (internal numeric id).
-- Query staff-per-manager per periode akan fallback ke employees.manager_id (live)
-- untuk periode yang belum punya baris di tabel ini sama sekali.
CREATE TABLE employee_manager_snapshots (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employee_id INT NOT NULL,
    manager_id INT NOT NULL,
    year INT NOT NULL,
    month INT NOT NULL,
    UNIQUE KEY uq_employee_manager_period (employee_id, year, month)
);
-- Target New MRC per AM per bulan untuk reward kuartal, per branch (employees.branch_id),
-- organisasi (employees.organization_name), atau per karyawan (employees.employee_id).
-- Satu baris berlaku mulai (year, month) sampai (end_year, end_month) kalau diisi; tanpa akhir, berlaku
-- sampai ada baris lebih baru untuk kombinasi yang sama.
-- branch_id '*' = semua branch, organization_name '*' = semua organisasi, employee_id '*' = semua karyawan.
-- Baris per karyawan hanya dicocokkan lewat employee_id (branch/organisasi di baris itu sekadar keterangan).
-- Urutan pencarian: karyawan, branch + organisasi, branch saja, organisasi saja, lalu default ('*', '*').
CREATE TABLE branch_targets (
    id INT PRIMARY KEY AUTO_INCREMENT,
    branch_id VARCHAR(20) NOT NULL,
    organization_name VARCHAR(255) NOT NULL DEFAULT '*',
    employee_id VARCHAR(20) NOT NULL DEFAULT '*',
    year INT NOT NULL,
    month INT NOT NULL,
    end_year INT NULL,
    end_month INT NULL,
    target_new_mrc DECIMAL(15, 2) NOT NULL,
    UNIQUE KEY uq_branch_target_period (branch_id, organization_name, employee_id, year, month)
);

-- Migrasi untuk tabel branch_targets yang sudah ada (sebelum ada kolom organization_name):
-- ALTER TABLE branch_targets
--     ADD COLUMN organization_name VARCHAR(255) NOT NULL DEFAULT '*' AFTER branch_id,
--     DROP INDEX uq_branch_target_period,
--     ADD UNIQUE KEY uq_branch_target_period (branch_id, organization_name, year, month);

-- Migrasi untuk target per karyawan & periode akhir (setelah kolom organization_name ada):
-- ALTER TABLE branch_targets
--     ADD COLUMN employee_id VARCHAR(20) NOT NULL DEFAULT '*' AFTER organization_name,
--     ADD COLUMN end_year INT NULL AFTER month,
--     ADD COLUMN end_month INT NULL AFTER end_year,
--     DROP INDEX uq_branch_target_period,
--     ADD UNIQUE KEY uq_branch_target_period (branch_id, organization_name, employee_id, year, month);

-- Target awal (reward mulai Q3 2026): Jakarta (003) Rp 3.000.000, branch lain Rp 2.424.000 per AM per bulan.
INSERT INTO branch_targets (branch_id, year, month, target_new_mrc) VALUES
    ('003', 2026, 7, 3000000),
    ('*', 2026, 7, 2424000);
