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
    is_admin BOOLEAN NOT NULL DEFAULT false
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