import { Pool } from 'mysql2/promise';
import { INisRepository } from '../interface/nis.interface';

/**
 * Tanggal pelunasan dari batch pembayaran NIS, per AI (item invoice).
 * Item yang dilunasi manual (mis. pakai saldo PPh 23, bukan lewat alur pembayaran sistem) tidak punya trx_date,
 * tapi tercatat di NewCustomerInvoiceBatch. Tanggalnya diambil dari log kapan item terakhir
 * dimasukkan ke batch-nya yang sekarang. Untuk pembayaran lewat sistem, tanggal ini sama dengan trx_date.
 * Batch hanya dihitung lunas kalau berisi penerimaan uang (RA02) atau PPh 23; alokasi SSP PPN,
 * write-off piutang (note) dan diskon tidak dianggap pembayaran.
 */
const BATCH_PAID_DATE_JOIN = `
            LEFT JOIN (
                SELECT ncib.AI, DATE(MAX(l.action_at)) AS batch_date
                FROM NewCustomerInvoiceBatch ncib
                JOIN NewCustomerInvoiceBatchLogItem li
                    ON li.AI = ncib.AI AND li.batch_no = ncib.batchNo
                JOIN NewCustomerInvoiceBatchLog l
                    ON l.id = li.log_id AND l.action = 'add'
                WHERE EXISTS (
                    SELECT 1
                    FROM NewCustomerInvoiceBatch src_b
                    JOIN NewCustomerInvoice src ON src.AI = src_b.AI
                    WHERE src_b.batchNo = ncib.batchNo
                        AND src_b.total > 0
                        AND src.Type IN ('RA02', 'pph23')
                )
                GROUP BY ncib.AI
            ) AS batch_paid
                ON batch_paid.AI = nciit.AI`;

// Periode pakai trx_date; kalau kosong, pakai tanggal pelunasan dari batch
const PAID_DATE_IN_RANGE = `(nciit.trx_date BETWEEN ? AND ? OR (nciit.trx_date IS NULL AND batch_paid.batch_date BETWEEN ? AND ?))`;

export class NisRepository implements INisRepository {
    constructor(private readonly dbPool: Pool) {}

    async getInternalByDateRange(startDate: string, endDate: string): Promise<any[]> {
        const query = `
            SELECT 
                nciit.AI AS ai,
                nciit.counter AS counter,
                cit.InvoiceNum AS invoice_number,
                cit.Urut AS sequence_number,
                COALESCE(nciit.trx_date, batch_paid.batch_date) AS paid_date,
                nci.Description AS description,
                nciit.new_subscription AS new_subscription,
                nciit.dpp AS subscription,
                nciit.is_prorata AS is_prorate,
                nciit.is_upgrade AS is_upgrade,
                itm.Month AS month,
                cit.AwalPeriode AS period_start,
                cit.AkhirPeriode AS period_end,
                cit.total_account AS total_account,
                cit.InvAddAccount AS is_add_account,
                c.CustId AS customer_id,
                cs.CustServId AS customer_service_id,
                c.CustCompany AS customer_company,
                cs.CustActivationDate AS activation_date,
                COALESCE(csh.ContractUntil, cs.ContractUntil) AS contract_until,
                s.ServiceGroup AS service_group_id,
                s.ServiceId AS service_id,
                s.ServiceType AS service_name,
                s.BusinessOperation AS service_type,
                COUNT(DISTINCT cross_tbl.ServiceId) AS cross_sell_count,
                cs.SalesId AS sales_id,
                cs.ManagerSalesId AS sales_manager_id,
                cs.InvoiceType AS invoice_type,
                c.Surveyor AS implementator_id
            FROM NewCustomerInvoiceInternetCounter nciit
            LEFT JOIN NewCustomerInvoice nci 
                ON nciit.AI = nci.AI
            LEFT JOIN CustomerInvoiceTemp cit 
                ON nci.Id = cit.InvoiceNum AND nci.No = cit.Urut
            LEFT JOIN InvoiceTypeMonth itm 
                ON cit.InvoiceType = itm.InvoiceType
            LEFT JOIN CustomerInvoiceTemp_Custom citc 
                ON cit.InvoiceNum = citc.InvoiceNum AND cit.Urut = citc.Urut
            LEFT JOIN CustomerServices cs 
                ON cs.CustServId = cit.CustServId
            LEFT JOIN (
                SELECT CustServId, MIN(ContractUntil) AS ContractUntil
                FROM CustomerServicesHistory
                WHERE ContractUntil IS NOT NULL
                GROUP BY CustServId
            ) AS csh 
                ON csh.CustServId = cs.CustServId
            LEFT JOIN Customer c 
                ON c.CustId = nci.CustId
            LEFT JOIN Services s 
                ON cs.ServiceId = s.ServiceId
            ${BATCH_PAID_DATE_JOIN}
            LEFT JOIN (
                SELECT 
                    cs2.CustId, 
                    cs2.ServiceId
                FROM CustomerServices cs2
                JOIN Services s2 
                    ON cs2.ServiceId = s2.ServiceId
                WHERE (cs2.CustStatus IS NULL OR cs2.CustStatus <> 'NA')
                AND (s2.ServiceCategory = 'digital_business')
                -- Domain tidak dihitung cross-sell
                AND (s2.ServiceGroup IS NULL OR s2.ServiceGroup <> 'DO')
            ) AS cross_tbl 
                ON cross_tbl.CustId = nci.CustId AND cross_tbl.ServiceId <> cs.ServiceId
            WHERE s.BusinessOperation = 'internal'
                AND s.ServiceCategory = 'digital_business'
                AND LOWER(s.ServiceType) NOT LIKE '%lisensi%'
                AND LOWER(s.ServiceType) NOT LIKE '%license%'
                AND ${PAID_DATE_IN_RANGE}
                AND NOT (s.ServiceGroup = 'SV' AND nciit.dpp < 500000)
            GROUP BY nciit.AI;
        `;

        const [rows] = await this.dbPool.query({
            sql: query,
        }, [startDate, endDate, startDate, endDate]);

        return rows as any[];
    }

    async getResellByDateRange(startDate: string, endDate: string): Promise<any[]> {
        const query = `
            SELECT 
                nciit.AI AS ai,
                nciit.counter AS counter,
                cit.InvoiceNum AS invoice_number,
                cit.Urut AS sequence_number,
                COALESCE(nciit.trx_date, batch_paid.batch_date) AS paid_date,
                nciit.new_subscription AS new_subscription,
                nciit.dpp AS subscription,
                csc.modal_cost_per_user AS modal,
                nciit.is_prorata AS is_prorate,
                nciit.is_upgrade AS is_upgrade,
                itm.Month AS month,
                cit.AwalPeriode AS period_start,
                cit.AkhirPeriode AS period_end,
                cit.InvoicePeriodStart AS period_start_date,
                cit.InvoicePeriodEnd AS period_end_date,
                cit.total_account AS total_account,
                cit.InvAddAccount AS is_add_account,
                c.CustId AS customer_id,
                cs.CustServId AS customer_service_id,
                c.CustCompany AS customer_company,
                cs.CustActivationDate AS activation_date,
                s.ServiceGroup AS service_group_id,
                s.ServiceId AS service_id,
                s.ServiceType AS service_name,
                s.BusinessOperation AS service_type,
                cs.SalesId AS sales_id,
                cs.ManagerSalesId AS sales_manager_id,
                cs.InvoiceType AS invoice_type,
                -- Invoice bulan penuh pertama setelah prorate awal: NIS membuat 2 invoice terpisah saat aktivasi
                -- di tengah bulan (prorate + bulan penuh), dan invoice bulan penuhnya tidak ditandai new_subscription.
                (nciit.is_prorata = 0 AND nciit.new_subscription = 0
                    AND EXISTS (
                        SELECT 1
                        FROM CustomerInvoiceTemp cit2
                        JOIN NewCustomerInvoice nci2 ON nci2.Id = cit2.InvoiceNum AND nci2.No = cit2.Urut
                        JOIN NewCustomerInvoiceInternetCounter n2 ON n2.AI = nci2.AI
                        WHERE cit2.CustServId = cs.CustServId
                            AND n2.AI < nciit.AI
                            AND n2.is_prorata = 1
                            AND n2.new_subscription > 0
                    )
                    AND NOT EXISTS (
                        SELECT 1
                        FROM CustomerInvoiceTemp cit2
                        JOIN NewCustomerInvoice nci2 ON nci2.Id = cit2.InvoiceNum AND nci2.No = cit2.Urut
                        JOIN NewCustomerInvoiceInternetCounter n2 ON n2.AI = nci2.AI
                        WHERE cit2.CustServId = cs.CustServId
                            AND n2.AI < nciit.AI
                            AND n2.is_prorata = 0
                    )
                ) AS is_first_full_invoice
            FROM NewCustomerInvoiceInternetCounter nciit
            LEFT JOIN NewCustomerInvoice nci 
                ON nciit.AI = nci.AI
            LEFT JOIN CustomerInvoiceTemp cit 
                ON nci.Id = cit.InvoiceNum AND nci.No = cit.Urut
            LEFT JOIN InvoiceTypeMonth itm 
                ON cit.InvoiceType = itm.InvoiceType
            LEFT JOIN CustomerInvoiceTemp_Custom citc 
                ON cit.InvoiceNum = citc.InvoiceNum AND cit.Urut = citc.Urut
            LEFT JOIN CustomerServices cs 
                ON cs.CustServId = cit.CustServId
            LEFT JOIN CustomerServiceCost csc 
                ON csc.customer_service_id = cs.CustServId
            LEFT JOIN (
                SELECT CustServId, MIN(ContractUntil) AS ContractUntil
                FROM CustomerServicesHistory
                WHERE ContractUntil IS NOT NULL
                GROUP BY CustServId
            ) AS csh 
                ON csh.CustServId = cs.CustServId
            LEFT JOIN Customer c 
                ON c.CustId = nci.CustId
            LEFT JOIN Services s 
                ON cs.ServiceId = s.ServiceId
            ${BATCH_PAID_DATE_JOIN}
            WHERE s.BusinessOperation = 'resell'
            AND (s.ServiceGroup IS NULL OR s.ServiceGroup <> 'DO')
            AND s.ServiceCategory = 'digital_business'
            AND LOWER(s.ServiceType) NOT LIKE '%lisensi%'   
            AND LOWER(s.ServiceType) NOT LIKE '%license%'  
            AND ${PAID_DATE_IN_RANGE}
            AND NOT (s.ServiceGroup = 'SV' AND nciit.dpp < 500000)      
            GROUP BY nciit.AI;
        `;

        const [rows] = await this.dbPool.query({
            sql: query,
        }, [startDate, endDate, startDate, endDate]);

        return rows as any[];
    }

    async getChurnCountByImplementator(implementatorId: string, startDate: string, endDate: string): Promise<number> {
        const query = `
            SELECT COUNT(*) AS total
            FROM CustomerServices cs
            LEFT JOIN Customer c ON c.CustId = cs.CustId
            WHERE cs.ServiceId IN ('NWBUS', 'NWADV')
            AND c.Surveyor = ?
            AND cs.CustStatus = 'NA'
            AND cs.CustUnregDate BETWEEN ? AND ?;
        `;
        const [rows] = await this.dbPool.query(query, [implementatorId, startDate, endDate]);
        const data = rows as any[];
        return data.length > 0 ? Number(data[0].total) : 0;
    }

    async getChurnListByImplementator(implementatorId: string, startDate: string, endDate: string): Promise<any[]> {
        const query = `
            SELECT
                cs.CustServId AS customer_service_id,
                c.CustId AS customer_id,
                c.CustCompany AS customer_company,
                cs.ServiceId AS service_id,
                s.ServiceType AS service_name,
                cs.CustActivationDate AS activation_date,
                cs.CustUnregDate AS unreg_date
            FROM CustomerServices cs
            LEFT JOIN Customer c ON c.CustId = cs.CustId
            LEFT JOIN Services s ON s.ServiceId = cs.ServiceId
            WHERE cs.ServiceId IN ('NWBUS', 'NWADV')
            AND c.Surveyor = ?
            AND cs.CustStatus = 'NA'
            AND cs.CustUnregDate BETWEEN ? AND ?
            ORDER BY cs.CustUnregDate DESC;
        `;
        const [rows] = await this.dbPool.query(query, [implementatorId, startDate, endDate]);
        return rows as any[];
    }

    async getChurnMrcBySales(salesIds: string[], startDate: string, endDate: string): Promise<number> {
        if (salesIds.length === 0) return 0;
        // MRC churn = nilai langganan per periode tagihan / jumlah bulan, untuk layanan yang unreg di periode ini.
        // Pengecualian produk sama dengan sync invoice (domain, lisensi).
        const query = `
            SELECT COALESCE(SUM(cs.Subscription / COALESCE(NULLIF(itm.Month, 0), 1)), 0) AS total
            FROM CustomerServices cs
            LEFT JOIN Services s ON s.ServiceId = cs.ServiceId
            LEFT JOIN InvoiceTypeMonth itm ON itm.InvoiceType = cs.InvoiceType
            WHERE cs.SalesId IN (?)
            AND cs.CustStatus = 'NA'
            AND cs.CustUnregDate BETWEEN ? AND ?
            AND s.ServiceCategory = 'digital_business'
            AND (s.ServiceGroup IS NULL OR s.ServiceGroup <> 'DO')
            AND LOWER(s.ServiceType) NOT LIKE '%lisensi%'
            AND LOWER(s.ServiceType) NOT LIKE '%license%';
        `;
        const [rows] = await this.dbPool.query(query, [salesIds, startDate, endDate]);
        const data = rows as any[];
        return data.length > 0 ? Number(data[0].total) : 0;
    }

    /**
     * Daftar layanan yang unreg di periode ini per sales, kriteria sama dengan getChurnMrcBySales
     * (jumlah `mrc` per sales = MRC churn di dashboard).
     */
    async getChurnListBySales(salesIds: string[], startDate: string, endDate: string): Promise<any[]> {
        if (salesIds.length === 0) return [];
        const query = `
            SELECT
                cs.SalesId AS sales_id,
                cs.CustServId AS customer_service_id,
                c.CustId AS customer_id,
                c.CustCompany AS customer_company,
                s.ServiceType AS service_name,
                cs.CustUnregDate AS unreg_date,
                NULLIF(TRIM(cs.CustCloseReason), '') AS close_reason,
                cs.Subscription / COALESCE(NULLIF(itm.Month, 0), 1) AS mrc
            FROM CustomerServices cs
            LEFT JOIN Customer c ON c.CustId = cs.CustId
            LEFT JOIN Services s ON s.ServiceId = cs.ServiceId
            LEFT JOIN InvoiceTypeMonth itm ON itm.InvoiceType = cs.InvoiceType
            WHERE cs.SalesId IN (?)
            AND cs.CustStatus = 'NA'
            AND cs.CustUnregDate BETWEEN ? AND ?
            AND s.ServiceCategory = 'digital_business'
            AND (s.ServiceGroup IS NULL OR s.ServiceGroup <> 'DO')
            AND LOWER(s.ServiceType) NOT LIKE '%lisensi%'
            AND LOWER(s.ServiceType) NOT LIKE '%license%'
            ORDER BY cs.CustUnregDate, cs.CustServId;
        `;
        const [rows] = await this.dbPool.query(query, [salesIds, startDate, endDate]);
        return rows as any[];
    }

    /**
     * MRC aktif per sales pada `date` (awal periode): sudah aktivasi sebelum tanggal itu dan belum unreg,
     * produk sama dengan MRC churn. Status FR (gratis) tidak dihitung. Pakai SalesId & Subscription saat ini
     * (NIS tidak menyimpan histori), jadi untuk periode lampau angkanya perkiraan.
     */
    async getActiveMrcBySales(salesIds: string[], date: string): Promise<any[]> {
        if (salesIds.length === 0) return [];
        const query = `
            SELECT cs.SalesId AS sales_id, COALESCE(SUM(cs.Subscription / COALESCE(NULLIF(itm.Month, 0), 1)), 0) AS total
            FROM CustomerServices cs
            LEFT JOIN Services s ON s.ServiceId = cs.ServiceId
            LEFT JOIN InvoiceTypeMonth itm ON itm.InvoiceType = cs.InvoiceType
            WHERE cs.SalesId IN (?)
            AND cs.CustActivationDate < ?
            AND (cs.CustStatus IN ('AC', 'BL') OR (cs.CustStatus = 'NA' AND cs.CustUnregDate >= ?))
            AND s.ServiceCategory = 'digital_business'
            AND (s.ServiceGroup IS NULL OR s.ServiceGroup <> 'DO')
            AND LOWER(s.ServiceType) NOT LIKE '%lisensi%'
            AND LOWER(s.ServiceType) NOT LIKE '%license%'
            GROUP BY cs.SalesId;
        `;
        const [rows] = await this.dbPool.query(query, [salesIds, date, date]);
        return rows as any[];
    }

    async getInvoiceDatesByAi(ais: number[]): Promise<any[]> {
        if (ais.length === 0) return [];
        const query = `
            SELECT
                nci.AI AS ai,
                cit.InvoiceDate AS invoice_date,
                cit.InvoicePeriodStart AS period_start_date,
                cit.InvoicePeriodEnd AS period_end_date
            FROM NewCustomerInvoice nci
            LEFT JOIN CustomerInvoiceTemp cit
                ON nci.Id = cit.InvoiceNum AND nci.No = cit.Urut
            WHERE nci.AI IN (?)
        `;
        const [rows] = await this.dbPool.query(query, [ais]);
        return rows as any[];
    }

    /**
     * Pemilik (SalesId) layanan resell per customer, kriteria sama dengan cross_tbl di getInternalByDateRange
     * (digital_business, bukan NA, bukan domain). Untuk menandai AM Resell di deal cross-sell API client.
     */
    async getResellOwnersByCustomerIds(customerIds: string[]): Promise<any[]> {
        const query = `
            SELECT
                cs.CustId AS customer_id,
                cs.SalesId AS sales_id,
                MIN(cs.CustActivationDate) AS first_activation_date
            FROM CustomerServices cs
            JOIN Services s ON s.ServiceId = cs.ServiceId
            WHERE cs.CustId IN (?)
              AND s.BusinessOperation = 'resell'
              AND s.ServiceCategory = 'digital_business'
              AND (cs.CustStatus IS NULL OR cs.CustStatus <> 'NA')
              AND (s.ServiceGroup IS NULL OR s.ServiceGroup <> 'DO')
              AND cs.SalesId IS NOT NULL AND cs.SalesId <> ''
            GROUP BY cs.CustId, cs.SalesId
            ORDER BY first_activation_date
        `;
        const [rows] = await this.dbPool.query(query, [customerIds]);
        return rows as any[];
    }

    async getSurveyorByCustomerIds(customerIds: string[]): Promise<any[]> {
        const query = `
            SELECT c.CustId AS customer_id, c.Surveyor AS implementator_id
            FROM Customer c
            WHERE c.CustId IN (?)
        `;
        const [rows] = await this.dbPool.query(query, [customerIds]);
        return rows as any[];
    }
}
