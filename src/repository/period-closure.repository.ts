import { Pool, RowDataPacket } from 'mysql2/promise';

export interface PeriodClosure {
    year: number;
    month: number;
    closed_by: string;
    closed_at: Date;
}

export class PeriodClosureRepository {
    constructor(private readonly dbPool: Pool) {}

    async getAll(): Promise<PeriodClosure[]> {
        let rows: RowDataPacket[];
        try {
            [rows] = await this.dbPool.query<RowDataPacket[]>(
                `SELECT year, month, closed_by, closed_at FROM period_closures ORDER BY year DESC, month DESC`
            );
        } catch (error: any) {
            // Tabel belum dibuat (lihat table.sql) = belum ada periode yang di-close
            if (error?.code === 'ER_NO_SUCH_TABLE') return [];
            throw error;
        }
        return rows.map(row => ({ year: row.year, month: row.month, closed_by: row.closed_by, closed_at: row.closed_at }));
    }

    async close(year: number, month: number, closedBy: string): Promise<void> {
        await this.dbPool.query(
            `INSERT INTO period_closures (year, month, closed_by) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE closed_by = closed_by`,
            [year, month, closedBy]
        );
    }

    async reopen(year: number, month: number): Promise<void> {
        await this.dbPool.query(`DELETE FROM period_closures WHERE year = ? AND month = ?`, [year, month]);
    }
}
