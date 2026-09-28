import { Pool } from 'mysql2/promise';
import { SnapshotData, ISnapshotRepository, SnapshotListFilters, SnapshotUpdateData } from '../interface/snapshot.interface';

export class SnapshotRepository implements ISnapshotRepository {
    constructor(private readonly dbPool: Pool) {}

    private buildSnapshotFilter(filters: SnapshotListFilters): { where: string; params: any[] } {
        const conditions: string[] = [];
        const params: any[] = [];

        if (filters.status) {
            conditions.push('s.status = ?');
            params.push(filters.status);
        }
        if (filters.serviceType) {
            conditions.push('s.service_type = ?');
            params.push(filters.serviceType);
        }
        if (filters.salesId) {
            conditions.push('s.sales_id = ?');
            params.push(filters.salesId);
        }
        if (filters.search) {
            conditions.push('(s.customer_company LIKE ? OR s.customer_id LIKE ? OR s.invoice_number LIKE ? OR s.service_name LIKE ?)');
            const like = `%${filters.search}%`;
            params.push(like, like, like, like);
        }
        if (filters.startDate && filters.endDate) {
            conditions.push('s.paid_date BETWEEN ? AND ?');
            params.push(filters.startDate, filters.endDate);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        return { where, params };
    }

    async getSnapshots(filters: SnapshotListFilters): Promise<any[]> {
        const { where, params } = this.buildSnapshotFilter(filters);
        const offset = (filters.page - 1) * filters.limit;

        const query = `
            SELECT
                s.*,
                se.name AS sales_name,
                se.photo_profile AS sales_photo,
                ie.name AS implementator_name,
                ie.photo_profile AS implementator_photo
            FROM snapshots s
            LEFT JOIN employees se ON s.sales_id = se.employee_id
            LEFT JOIN employees ie ON s.implementator_id = ie.employee_id
            ${where}
            ORDER BY s.paid_date DESC, s.ai DESC
            LIMIT ? OFFSET ?
        `;

        const [rows] = await this.dbPool.query(query, [...params, filters.limit, offset]);
        return rows as any[];
    }

    async getResellNewServiceIdsInRange(startDate: string, endDate: string): Promise<any[]> {
        const query = `
            SELECT DISTINCT customer_service_id
            FROM snapshots
            WHERE service_type = 'resell'
              AND status = 'new'
              AND customer_service_id IS NOT NULL
              AND paid_date BETWEEN ? AND ?
        `;
        const [rows] = await this.dbPool.query(query, [startDate, endDate]);
        return rows as any[];
    }

    async getAccountManagers(): Promise<any[]> {
        const query = `
            SELECT DISTINCT
                s.sales_id       AS employee_id,
                e.name           AS name,
                e.photo_profile  AS photo_profile
            FROM snapshots s
            INNER JOIN employees e ON s.sales_id = e.employee_id
            WHERE s.sales_id IS NOT NULL
            ORDER BY e.name ASC
        `;
        const [rows] = await this.dbPool.query(query);
        return rows as any[];
    }

    async countSnapshots(filters: SnapshotListFilters): Promise<number> {
        const { where, params } = this.buildSnapshotFilter(filters);
        const query = `SELECT COUNT(*) AS total FROM snapshots s ${where}`;
        const [rows] = await this.dbPool.query(query, params);
        const data = rows as any[];
        return data.length > 0 ? Number(data[0].total) : 0;
    }

    async getInternalInvoice(salesId: string, startDate: string, endDate: string): Promise<any[]> {
        const query = `
            SELECT 
                s.*,
                e.name AS implementator_name,
                e.photo_profile AS implementator_photo_profile
            FROM snapshots s
            LEFT JOIN employees e ON s.implementator_id = e.employee_id
            WHERE s.sales_id = ?
              AND s.paid_date BETWEEN ? AND ?
              AND s.service_type = 'internal'
              AND s.status != 'setup'
        `;
        const [rows] = await this.dbPool.query(query, [salesId, startDate, endDate]);
        return rows as any[];
    }

    async getSnapshotByImplementator(implementatorId: string, startDate: string, endDate: string): Promise<any[]> {
        const query = `
            SELECT 
                s.*,
                e.name                  AS sales_name,
                e.employee_id           AS sales_id,
                e.photo_profile         AS sales_photo
            FROM snapshots s
            LEFT JOIN employees e
                ON s.sales_id = e.employee_id
            WHERE s.implementator_id = ?
              AND s.paid_date BETWEEN ? AND ?
              AND s.service_group_id = 'NW'
            GROUP BY s.ai
        `;
        const [rows] = await this.dbPool.query(query, [implementatorId, startDate, endDate]);
        return rows as any[];
    }

    async getResellInvoice(salesId: string, startDate: string, endDate: string): Promise<any[]> {
        const query = `
            SELECT s.*
            FROM snapshots s
            WHERE s.sales_id = ?
              AND s.paid_date BETWEEN ? AND ?
              AND s.service_type = 'resell'
              AND s.status != 'setup'
        `;
        const [rows] = await this.dbPool.query(query, [salesId, startDate, endDate]);
        return rows as any[];
    }

    async deleteSnapshotByDateRangeAndType(startDate: string, endDate: string, serviceType: 'internal' | 'resell'): Promise<any> {
        const query = `
            DELETE FROM snapshots
            WHERE service_type = ? AND paid_date BETWEEN ? AND ?
              AND is_adjust = false
        `;
        const [result] = await this.dbPool.query(query, [serviceType, startDate, endDate]);
        return result;
    }

    async insertSnapshot(data: SnapshotData): Promise<any> {
        const query = `
            INSERT INTO snapshots (
                ai, invoice_number, sequence_number, paid_date, subscription,
                status, month_period, total_account, customer_id, customer_service_id,
                customer_company, contract_until_date, service_group_id, service_id,
                service_name, service_type, cross_sell_count, sales_id, manager_sales_id, implementator_id, modal
            ) VALUES (
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?
            ) ON DUPLICATE KEY UPDATE
                invoice_number = IF(is_adjust, invoice_number, VALUES(invoice_number)),
                sequence_number = IF(is_adjust, sequence_number, VALUES(sequence_number)),
                paid_date = IF(is_adjust, paid_date, VALUES(paid_date)),
                subscription = IF(is_adjust, subscription, VALUES(subscription)),
                status = IF(is_adjust, status, VALUES(status)),
                month_period = IF(is_adjust, month_period, VALUES(month_period)),
                total_account = IF(is_adjust, total_account, VALUES(total_account)),
                customer_id = IF(is_adjust, customer_id, VALUES(customer_id)),
                customer_service_id = IF(is_adjust, customer_service_id, VALUES(customer_service_id)),
                customer_company = IF(is_adjust, customer_company, VALUES(customer_company)),
                contract_until_date = IF(is_adjust, contract_until_date, VALUES(contract_until_date)),
                service_group_id = IF(is_adjust, service_group_id, VALUES(service_group_id)),
                service_id = IF(is_adjust, service_id, VALUES(service_id)),
                service_name = IF(is_adjust, service_name, VALUES(service_name)),
                service_type = IF(is_adjust, service_type, VALUES(service_type)),
                cross_sell_count = IF(is_adjust, cross_sell_count, VALUES(cross_sell_count)),
                sales_id = IF(is_adjust, sales_id, VALUES(sales_id)),
                manager_sales_id = IF(is_adjust, manager_sales_id, VALUES(manager_sales_id)),
                implementator_id = IF(is_adjust, implementator_id, VALUES(implementator_id)),
                modal = IF(is_adjust, modal, VALUES(modal))
        `;

        const values = [
            data.ai,
            data.invoice_number,
            data.sequence_number,
            data.paid_date,
            data.subscription,
            data.status,
            data.month_period,
            data.total_account,
            data.customer_id,
            data.customer_service_id,
            data.customer_company,
            data.contract_until_date,
            data.service_group_id,
            data.service_id,
            data.service_name,
            data.service_type,
            data.cross_sell_count,
            data.sales_id,
            data.manager_sales_id,
            data.implementator_id,
            data.modal
        ];

        const [result] = await this.dbPool.query(query, values);
        return result;
    }

    async updateSnapshot(ai: number, data: SnapshotUpdateData): Promise<any> {
        const editableFields: (keyof SnapshotUpdateData)[] = [
            'subscription', 'status', 'month_period', 'total_account',
            'customer_id', 'customer_service_id', 'customer_company', 'contract_until_date',
            'service_group_id', 'service_id', 'service_name', 'service_type',
            'cross_sell_count', 'sales_id', 'manager_sales_id', 'implementator_id', 'modal',
            'base_commission', 'mrc_override'
        ];

        const setClauses: string[] = [];
        const values: any[] = [];

        for (const field of editableFields) {
            if (field in data) {
                setClauses.push(`${field} = ?`);
                values.push(data[field]);
            }
        }

        if (setClauses.length === 0) {
            return null;
        }

        setClauses.push('is_adjust = true');

        const query = `UPDATE snapshots SET ${setClauses.join(', ')} WHERE ai = ?`;
        values.push(ai);

        const [result] = await this.dbPool.query(query, values);
        return result;
    }

    async getSnapshotByManager(managerId: string, startDate: string, endDate: string): Promise<any[]> {
        const query = `
            SELECT
                s.*,
                e.name AS sales_name,
                e.photo_profile AS sales_photo
            FROM snapshots s
            LEFT JOIN employees e ON s.sales_id = e.employee_id
            WHERE s.manager_sales_id = ?
              AND s.paid_date BETWEEN ? AND ?
        `;
        const [rows] = await this.dbPool.query(query, [managerId, startDate, endDate]);
        return rows as any[];
    }
}
