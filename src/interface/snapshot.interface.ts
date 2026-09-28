export interface SnapshotData {
    ai: number;
    invoice_number: number | null;
    sequence_number: number | null;
    paid_date: Date | string | null;
    subscription: number | null;
    status: 'new' | 'upgrade' | 'termin' | 'recurring' | 'prorate' | 'add' | 'setup';
    month_period: number | null;
    total_account: number | null;
    customer_id: string | null;
    customer_service_id: number | null;
    customer_company: string | null;
    contract_until_date: Date | string | null;
    service_group_id: string | null;
    service_id: string | null;
    service_name: string | null;
    service_type: 'internal' | 'resell';
    cross_sell_count: number;
    sales_id: string | null;
    manager_sales_id: string | null;
    implementator_id: string | null;
    modal: number | null;
    // Diisi manual lewat edit /invoice saja (job sync tidak pernah mengisi/mengubah ini).
    // Kalau terisi, dipakai sebagai basis nominal komisi menggantikan subscription.
    base_commission?: number | null;
    // Diisi manual lewat edit /invoice saja. Kalau terisi, dipakai sebagai MRC menggantikan hasil hitung.
    mrc_override?: number | null;
}

export type SnapshotUpdateData = Partial<Omit<SnapshotData, 'ai'>>;

export interface SnapshotListFilters {
    search?: string;
    status?: string;
    serviceType?: 'internal' | 'resell';
    salesId?: string;
    startDate?: string;
    endDate?: string;
    page: number;
    limit: number;
}

export interface ISnapshotRepository {
    getInternalInvoice(salesId: string, startDate: string, endDate: string): Promise<any[]>;
    getResellInvoice(salesId: string, startDate: string, endDate: string): Promise<any[]>;
    getSnapshotByImplementator(implementatorId: string, startDate: string, endDate: string): Promise<any[]>;
    getSnapshots(filters: SnapshotListFilters): Promise<any[]>;
    countSnapshots(filters: SnapshotListFilters): Promise<number>;
    getResellNewServiceIdsInRange(startDate: string, endDate: string): Promise<any[]>;
    getAccountManagers(): Promise<any[]>;
    deleteSnapshotByDateRangeAndType(startDate: string, endDate: string, serviceType: 'internal' | 'resell'): Promise<any>;
    insertSnapshot(data: SnapshotData): Promise<any>;
    updateSnapshot(ai: number, data: SnapshotUpdateData): Promise<any>;
}

export interface ISnapshotService {
    getSnapshotList(filters: SnapshotListFilters): Promise<any>;
    getAccountManagers(): Promise<any>;
    getInternalInvoiceDetail(employeeId: string, startDate: string, endDate: string): Promise<any>;
    getResellInvoiceDetail(employeeId: string, startDate: string, endDate: string): Promise<any>;
    getImplementatorInvoiceDetail(implementatorId: string, startDate: string, endDate: string): Promise<any>;
    getImplementatorChurnList(implementatorId: string, startDate: string, endDate: string): Promise<any>;
    getImplementatorCommissionSummary(implementatorId: string, startDate: string, endDate: string): Promise<any>;
    getImplementatorCommissionYearlySummary(implementatorId: string, year: number): Promise<any[]>;
    getSalesCommissionSummary(employeeId: string, startDate: string, endDate: string): Promise<any>;
    getSalesCommissionYearlySummary(employeeId: string, year: number): Promise<any[]>;
    deleteSnapshotByDateRangeAndType(startDate: string, endDate: string, serviceType: 'internal' | 'resell'): Promise<any>;
    insertSnapshot(data: SnapshotData): Promise<any>;
    updateSnapshot(ai: number, data: SnapshotUpdateData): Promise<any>;
    getManagerTeamSummary(employees: { employeeId: string; name: string; photoProfile: string }[], startDate: string, endDate: string): Promise<any>;
    getManagerTeamYearlySummary(employeesByMonth: { employeeId: string; name: string; photoProfile: string }[][], year: number): Promise<any>;
    getManagerCommissionSummary(employeeIds: string[], startDate: string, endDate: string, managerId?: string): Promise<any>;
    getManagerCommissionYearlySummary(employeeIdsByMonth: string[][], year: number): Promise<any[]>;
}
