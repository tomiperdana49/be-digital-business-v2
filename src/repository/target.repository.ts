import { Pool, RowDataPacket } from 'mysql2/promise';
import { BranchTarget, BranchTargetInput, ITargetRepository } from '../interface/target.interface';

export class TargetRepository implements ITargetRepository {
    constructor(private readonly dbPool: Pool) {}

    async getAll(): Promise<BranchTarget[]> {
        const query = `
            SELECT id, branch_id, organization_name, employee_id, year, month, end_year, end_month, target_new_mrc
            FROM branch_targets
            ORDER BY branch_id, organization_name, employee_id, year, month
        `;
        const [rows] = await this.dbPool.query<RowDataPacket[]>(query);
        return rows.map(row => ({
            id: row.id,
            branch_id: row.branch_id,
            organization_name: row.organization_name,
            employee_id: row.employee_id,
            year: row.year,
            month: row.month,
            end_year: row.end_year,
            end_month: row.end_month,
            target_new_mrc: Number(row.target_new_mrc)
        }));
    }

    async upsert(data: BranchTargetInput): Promise<any> {
        const query = `
            INSERT INTO branch_targets (branch_id, organization_name, employee_id, year, month, end_year, end_month, target_new_mrc)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                target_new_mrc = VALUES(target_new_mrc),
                end_year = VALUES(end_year),
                end_month = VALUES(end_month)
        `;
        const [result] = await this.dbPool.query(query, [
            data.branchId, data.organizationName, data.employeeId, data.year, data.month, data.endYear, data.endMonth, data.targetNewMrc
        ]);
        return result;
    }

    async delete(id: number): Promise<any> {
        const [result] = await this.dbPool.query(`DELETE FROM branch_targets WHERE id = ?`, [id]);
        return result;
    }
}
