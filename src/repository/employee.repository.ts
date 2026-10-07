import { Pool, RowDataPacket } from 'mysql2/promise';
import { Employee } from '../interface/nusawork.interface';
import { IEmployeeRepository } from '../interface/employee.interface';

export class EmployeeRepository implements IEmployeeRepository {
    constructor(private readonly dbPool: Pool) {}

    async insertEmployee(data: Employee): Promise<any> {
        const query = `
            INSERT INTO employees (
                id,
                employee_id,
                name,
                email,
                photo_profile,
                job_position,
                organization_name,
                job_level,
                branch_id,
                branch,
                manager_id,
                has_dashboard,
                is_admin
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                employee_id = VALUES(employee_id),
                name = VALUES(name),
                email = VALUES(email),
                photo_profile = VALUES(photo_profile),
                job_position = VALUES(job_position),
                organization_name = VALUES(organization_name),
                job_level = VALUES(job_level),
                branch_id = VALUES(branch_id),
                branch = VALUES(branch),
                manager_id = VALUES(manager_id),
                has_dashboard = VALUES(has_dashboard),
                is_admin = VALUES(is_admin),
                deactivated_at = NULL
        `;

        const [rows] = await this.dbPool.query(query, [
            data.userId,
            data.employeeId,
            data.name,
            data.email,             
            data.photoProfile,
            data.jobPosition,
            data.organizationName,
            data.jobLevel,
            data.branchId,
            data.branch,
            data.managerId ?? null,
            data.hasDashboard ?? false,
            data.isAdmin ?? false
        ]);

        return rows;
    }

    /**
     * Tandai nonaktif karyawan yang tidak ada di daftar aktif hasil sync (resign / pindah unit).
     * Baris tidak dihapus supaya snapshot komisi lama tetap punya data karyawannya.
     */
    async deactivateEmployeesNotIn(activeIds: Array<number | string>): Promise<number> {
        if (activeIds.length === 0) return 0;

        const query = `
            UPDATE employees
            SET deactivated_at = NOW()
            WHERE deactivated_at IS NULL AND id NOT IN (?)
        `;
        const [result]: any = await this.dbPool.query(query, [activeIds]);
        return result.affectedRows ?? 0;
    }

    async setDeactivatedAt(id: number | string, date: string): Promise<number> {
        const query = `UPDATE employees SET deactivated_at = ? WHERE id = ?`;
        const [result]: any = await this.dbPool.query(query, [date, id]);
        return result.affectedRows ?? 0;
    }

    async getManagerById(employeeId: string): Promise<any[]> {
        const query = `
            SELECT *
            FROM employees
            WHERE employee_id = ?
        `;
        const [rows] = await this.dbPool.query<RowDataPacket[]>(query, [employeeId]);
        return rows;
    }

    async getStaff(managerId: string): Promise<any[]> {
        const query = `
            SELECT *
            FROM employees
            WHERE manager_id = ?
        `;
        const [rows] = await this.dbPool.query<RowDataPacket[]>(query, [managerId]);
        return rows;
    }

    async getStaffForPeriod(managerId: string, year: number, month: number): Promise<any[]> {
        // Tidak fallback ke employees.manager_id (live). Kalau periode ini belum
        // di-mapping untuk manager tsb, staff-nya dianggap kosong (0), bukan diam-diam
        // mengambil state manager saat ini yang bisa saja sudah berubah.
        const query = `
            SELECT e.*
            FROM employee_manager_snapshots ms
            INNER JOIN employees e ON e.id = ms.employee_id
            WHERE ms.manager_id = ? AND ms.year = ? AND ms.month = ?
        `;
        const [rows] = await this.dbPool.query<RowDataPacket[]>(query, [managerId, year, month]);
        return rows;
    }

    async upsertManagerMapping(employeeId: number, managerId: number, year: number, month: number): Promise<any> {
        const query = `
            INSERT INTO employee_manager_snapshots (employee_id, manager_id, year, month)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE manager_id = VALUES(manager_id)
        `;
        const [result] = await this.dbPool.query(query, [employeeId, managerId, year, month]);
        return result;
    }

    async getEmployeeByEmployeeId(employeeId: string): Promise<any | null> {
        const query = `
            SELECT 
                e1.*, 
                e2.name AS managerName, 
                e2.employee_id AS managerEmployeeId, 
                e2.photo_profile AS managerPhotoProfile 
            FROM employees e1 
            LEFT JOIN employees e2 ON e1.manager_id = e2.id 
            WHERE e1.employee_id = ? 
            LIMIT 1
        `;
        const [rows] = await this.dbPool.query<RowDataPacket[]>(query, [employeeId]);
        return rows.length > 0 ? rows[0] : null;
    }

    async getEmployeeById(id: string): Promise<any | null> {
        const query = `SELECT * FROM employees WHERE id = ? LIMIT 1`;
        const [rows] = await this.dbPool.query<RowDataPacket[]>(query, [id]);
        return rows.length > 0 ? rows[0] : null;
    }

    async getEmployeeByEmail(email: string): Promise<any | null> {
        const query = `SELECT * FROM employees WHERE email = ? LIMIT 1`;
        const [rows] = await this.dbPool.query<RowDataPacket[]>(query, [email]);
        return rows.length > 0 ? rows[0] : null;
    }

    /**
     * activeFrom (YYYY-MM-DD): kalau diisi, karyawan yang nonaktif sebelum tanggal ini tidak ikut.
     */
    async getAllDashboardEmployees(activeFrom?: string): Promise<any[]> {
        const query = `
            SELECT * FROM employees
            WHERE has_dashboard = true
              AND (? IS NULL OR deactivated_at IS NULL OR deactivated_at >= ?)
            ORDER BY deactivated_at IS NOT NULL, name
        `;
        const [rows]: any[] = await this.dbPool.query(query, [activeFrom ?? null, activeFrom ?? null]);
        return Array.isArray(rows) ? rows : [];
    }

    async getAllEmployees(): Promise<any[]> {
        const query = `SELECT * FROM employees`;
        const [rows]: any[] = await this.dbPool.query(query);
        return Array.isArray(rows) ? rows : [];
    }

    async getActiveEmployees(): Promise<any[]> {
        const query = `SELECT * FROM employees WHERE deactivated_at IS NULL`;
        const [rows]: any[] = await this.dbPool.query(query);
        return Array.isArray(rows) ? rows : [];
    }

    async getHierarchy(employeeId: string, activeFrom?: string): Promise<any[]> {
        const query = `
            WITH RECURSIVE employee_hierarchy AS (
                SELECT *, 0 AS depth
                FROM employees
                WHERE employee_id = ?
                
                UNION ALL
                
                SELECT e.*, eh.depth + 1
                FROM employees e
                INNER JOIN employee_hierarchy eh ON e.manager_id = eh.id
            )
            SELECT * 
            FROM employee_hierarchy 
            WHERE has_dashboard = true 
              AND (? IS NULL OR deactivated_at IS NULL OR deactivated_at >= ?)
            ORDER BY deactivated_at IS NOT NULL, depth ASC;
        `;
        const [rows]: any[] = await this.dbPool.query(query, [employeeId, activeFrom ?? null, activeFrom ?? null]);
        return Array.isArray(rows) ? rows : [];
    }
}
