import { CrossSellDealEntry, ISnapshotRepository, ISnapshotService, SalesChurnSummary, SalesCrossSell, SalesDeal, SalesNewMrcSummary, SnapshotData, SnapshotListFilters, SnapshotUpdateData } from '../interface/snapshot.interface';
import { Calculate } from '../helper/calculate';
import { INisService } from '../interface/nis.interface';
import { PeriodHelper } from '../helper/period';
import { format } from 'date-fns';

/** Tanggal dari DB ke 'yyyy-MM-dd'; tanggal kosong NIS (0000-00-00) jadi null. */
const toDateString = (value: any): string | null => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime()) || date.getFullYear() < 1901) return null;
    return format(date, 'yyyy-MM-dd');
};

/**
 * Manager yang boleh klaim komisi "Cust Lama" (recurring customer pribadinya) ke Manager Commission,
 * beserta endDate periode terakhir yang masih berlaku. Manager lain (mis. Desy) tidak klaim sama sekali.
 */
const CUST_LAMA_CLAIM_UNTIL: Record<string, string> = {
    '0202302': '2026-12-25' // Diva Wiera Buana, s/d periode Desember 2026
};

const claimsCustLama = (managerId: string, endDate: string): boolean =>
    !!CUST_LAMA_CLAIM_UNTIL[managerId] && endDate <= CUST_LAMA_CLAIM_UNTIL[managerId];

export class SnapshotService implements ISnapshotService {
    constructor(
        private readonly snapshotRepository: ISnapshotRepository,
        private readonly nisService: INisService
    ) {}

    /**
     * Basis nominal komisi: kalau base_commission diisi manual (lewat edit /invoice), pakai itu.
     * Kalau tidak (null/undefined), fallback ke subscription. Cuma memengaruhi nominal komisi
     * akhir -- MRC, subscription yang ditampilkan, margin/price, dst tetap dari subscription asli.
     */
    private commissionBase(row: any, subscription: number): number {
        return (row.base_commission !== null && row.base_commission !== undefined)
            ? Number(row.base_commission)
            : subscription;
    }

    /**
     * MRC manual: kalau mrc_override diisi (lewat edit /invoice), pakai itu menggantikan MRC hasil hitung.
     */
    private applyMrcOverride(row: any, mrc: number): number {
        return (row.mrc_override !== null && row.mrc_override !== undefined)
            ? Number(row.mrc_override)
            : mrc;
    }

    async getSnapshotList(filters: SnapshotListFilters): Promise<any> {
        const [rows, total, newResellServiceIdRows] = await Promise.all([
            this.snapshotRepository.getSnapshots(filters),
            this.snapshotRepository.countSnapshots(filters),
            // Diambil terpisah (bukan dari `rows` yang sudah di-paginate) supaya deteksi dedup
            // 'new' vs 'upgrade'/'prorate' tetap benar walau baris 'new'-nya ada di halaman lain.
            (filters.startDate && filters.endDate)
                ? this.snapshotRepository.getResellNewServiceIdsInRange(filters.startDate, filters.endDate)
                : Promise.resolve([])
        ]);

        const newResellServiceIds = new Set(newResellServiceIdRows.map((r: any) => r.customer_service_id));

        const items = rows.map(row => {
            const subscription = Number(row.subscription) || 0;
            const monthPeriod = Number(row.month_period) || 1;
            const status = row.status;

            let commissionAmount = 0;
            let commissionPercentage = 0;
            let mrc = 0;
            if (row.service_type === 'resell') {
                const res = Calculate.resellSalesCommission(status, subscription, Number(row.total_account) || 1, Number(row.modal) || 0, this.commissionBase(row, subscription));
                commissionAmount = res.commissionAmount;
                commissionPercentage = res.commissionPercentage;
                mrc = this.resellMrc(row, newResellServiceIds, filters.startDate || '');
            } else {
                const res = Calculate.internalSalesCommission(status, this.commissionBase(row, subscription), row.cross_sell_count, monthPeriod);
                commissionAmount = res.commissionAmount;
                commissionPercentage = res.commissionPercentage;
                mrc = this.applyMrcOverride(row, ['recurring', 'termin', 'setup'].includes(status) ? 0 : Calculate.mrc(subscription, monthPeriod, status));
            }

            return {
                ai: row.ai,
                invoiceNumber: row.invoice_number,
                sequenceNumber: row.sequence_number,
                paidDate: row.paid_date,
                status: row.status,
                monthPeriod: row.month_period,
                monthPeriodSummary: Calculate.monthPeriodSummary(monthPeriod),
                totalAccount: row.total_account,
                customerId: row.customer_id,
                customerServiceId: row.customer_service_id,
                customerCompany: row.customer_company,
                serviceGroupId: row.service_group_id,
                serviceId: row.service_id,
                serviceName: row.service_name,
                serviceType: row.service_type,
                sales: {
                    name: row.sales_name || '',
                    employeeId: row.sales_id || '',
                    photoProfile: row.sales_photo || ''
                },
                implementator: {
                    name: row.implementator_name || '',
                    employeeId: row.implementator_id || '',
                    photoProfile: row.implementator_photo || ''
                },
                subscription,
                modal: row.service_type === 'resell' ? Number(row.modal) || 0 : null,
                crossSellCount: row.service_type === 'internal' ? row.cross_sell_count : null,
                baseCommission: row.base_commission !== null && row.base_commission !== undefined ? Number(row.base_commission) : null,
                mrcOverride: row.mrc_override !== null && row.mrc_override !== undefined ? Number(row.mrc_override) : null,
                implementatorPeriodDate: row.implementator_period_date ?? null,
                mrc,
                commissionPercentage,
                commission: commissionAmount,
                isAdjust: Boolean(row.is_adjust)
            };
        });

        const totalPages = filters.limit > 0 ? Math.ceil(total / filters.limit) : 0;

        return {
            items,
            meta: {
                page: filters.page,
                limit: filters.limit,
                total,
                totalPages
            }
        };
    }

    async getAccountManagers(): Promise<any> {
        const rows = await this.snapshotRepository.getAccountManagers();
        return rows.map(row => ({
            employeeId: row.employee_id,
            name: row.name || '',
            photoProfile: row.photo_profile || ''
        }));
    }

    async getImplementatorInvoiceDetail(implementatorId: string, startDate: string, endDate: string): Promise<any> {
        const snapshots = await this.snapshotRepository.getSnapshotByImplementator(implementatorId, startDate, endDate);
        const churnCount = await this.nisService.getChurnCountByImplementator(implementatorId, startDate, endDate);

        return snapshots.map(row => {
            const subscription = Number(row.subscription) || 0;
            const monthPeriod = Number(row.month_period) || 1;

            const { implementatorCommission, implementatorCommissionPercentage } = Calculate.implementatorCommission(
                row.status, this.commissionBase(row, subscription), churnCount, monthPeriod
            );

            return {
                ai: row.ai,
                invoiceNumber: row.invoice_number,
                sequenceNumber: row.sequence_number,
                paidDate: row.paid_date,
                status: row.status,
                monthPeriod: row.month_period,
                monthPeriodSummary: Calculate.monthPeriodSummary(monthPeriod),
                totalAccount: row.total_account,
                customerId: row.customer_id,
                customerServiceId: row.customer_service_id,
                customerCompany: row.customer_company,
                contractUntilDate: row.contract_until_date,
                serviceGroupId: row.service_group_id,
                serviceId: row.service_id,
                serviceName: row.service_name,
                serviceType: row.service_type,
                crossSellCount: row.cross_sell_count,
                sales: {
                    name: row.sales_name || '',
                    employeeId: row.sales_id || '',
                    photoProfile: row.sales_photo || ''
                },
                subscription,
                baseCommission: row.base_commission !== null && row.base_commission !== undefined ? Number(row.base_commission) : null,
                mrcOverride: row.mrc_override !== null && row.mrc_override !== undefined ? Number(row.mrc_override) : null,
                mrc: this.applyMrcOverride(row, ['recurring', 'termin', 'setup'].includes(row.status) ? 0 : Calculate.mrc(subscription, monthPeriod, row.status)),
                implementatorPeriodDate: row.implementator_period_date ?? null,
                commissionPercentage: implementatorCommissionPercentage,
                commission: implementatorCommission,
                isAdjust: Boolean(row.is_adjust)
            };
        });
    }

    async getImplementatorChurnList(implementatorId: string, startDate: string, endDate: string): Promise<any> {
        const rows = await this.nisService.getChurnListByImplementator(implementatorId, startDate, endDate);

        return rows.map(row => ({
            customerServiceId: row.customer_service_id,
            customerId: row.customer_id,
            customerCompany: row.customer_company,
            serviceId: row.service_id,
            serviceName: row.service_name,
            activationDate: row.activation_date,
            unregDate: row.unreg_date
        }));
    }

    async getImplementatorCommissionSummary(implementatorId: string, startDate: string, endDate: string): Promise<any> {
        // Periode bulan lalu: tanggal 26 dua bulan lalu s/d 25 bulan lalu
        const { startDate: prevStartDate, endDate: prevEndDate } = this.previousPeriod(endDate);

        const [current, previous] = await Promise.all([
            this.aggregateImplementatorCommission(implementatorId, startDate, endDate),
            this.aggregateImplementatorCommission(implementatorId, prevStartDate, prevEndDate)
        ]);

        return {
            commission: {
                new: Calculate.trend(current.commissionNew, previous.commissionNew),
                recurring: Calculate.trend(current.commissionRecurring, previous.commissionRecurring),
                total: Calculate.trend(current.commissionNew + current.commissionRecurring, previous.commissionNew + previous.commissionRecurring)
            },
            mrc: Calculate.trend(current.totalMrc, previous.totalMrc),
            subscription: {
                new: Calculate.trend(current.totalSubscription, previous.totalSubscription),
                recurring: Calculate.trend(current.subscriptionRecurring, previous.subscriptionRecurring),
                total: Calculate.trend(current.totalSubscription + current.subscriptionRecurring, previous.totalSubscription + previous.subscriptionRecurring)
            },
            churnCount: Calculate.trend(current.churnCount, previous.churnCount),
            newAccount: Calculate.trend(current.newAccount, previous.newAccount)
        };
    }

    async getImplementatorCommissionYearlySummary(implementatorId: string, year: number): Promise<any[]> {
        const periodHelper = new PeriodHelper();
        const promises = [];
        for (let month = 1; month <= 12; month++) {
            const { startDate, endDate } = periodHelper.getStartAndEndDateForMonth(year, month);
            promises.push(this.aggregateImplementatorCommission(implementatorId, startDate, endDate));
        }

        const aggregatedData = await Promise.all(promises);

        return aggregatedData.map(data => ({
            commission: data.commissionNew + data.commissionRecurring,
            mrc: data.totalMrc,
            subscription: data.totalSubscription,
            churnCount: data.churnCount,
            newAccount: data.newAccount
        }));
    }

    private async aggregateImplementatorCommission(implementatorId: string, startDate: string, endDate: string) {
        const snapshots = await this.snapshotRepository.getSnapshotByImplementator(implementatorId, startDate, endDate);
        const churnCount = await this.nisService.getChurnCountByImplementator(implementatorId, startDate, endDate);

        let commissionNew = 0;
        let commissionRecurring = 0;
        let totalMrc = 0;
        let totalSubscription = 0;
        let subscriptionRecurring = 0;
        let newAccount = 0;

        for (const row of snapshots) {
            const subscription = Number(row.subscription) || 0;
            const monthPeriod = Number(row.month_period) || 1;
            const status = row.status;

            const { implementatorCommission } = Calculate.implementatorCommission(
                status, this.commissionBase(row, subscription), churnCount, monthPeriod
            );

            if (status === 'recurring') {
                commissionRecurring += implementatorCommission;
                subscriptionRecurring += subscription;
            } else if (['new', 'prorate', 'upgrade', 'termin', 'add'].includes(status)) {
                commissionNew += implementatorCommission;
                totalMrc += this.applyMrcOverride(row, status !== 'termin' ? Calculate.mrc(subscription, monthPeriod, status) : 0);
                totalSubscription += subscription;
            } else if (status === 'setup') {
                // Setup: fee satu kali, hanya masuk Total Commission (bukan MRC/Subscription/New Account)
                commissionNew += implementatorCommission;
            }

            if (['new', 'upgrade', 'prorate', 'termin', 'add'].includes(status)) newAccount += Number(row.total_account) || 0;
        }

        return { commissionNew, commissionRecurring, totalMrc, totalSubscription, subscriptionRecurring, churnCount, newAccount };
    }

    async getSalesCommissionSummary(employeeId: string, startDate: string, endDate: string): Promise<any> {
        // Periode bulan lalu: tanggal 26 dua bulan lalu s/d 25 bulan lalu
        const { startDate: prevStartDate, endDate: prevEndDate } = this.previousPeriod(endDate);

        const [current, previous] = await Promise.all([
            this.aggregateSalesCommission(employeeId, startDate, endDate),
            this.aggregateSalesCommission(employeeId, prevStartDate, prevEndDate)
        ]);
        const churn = await this.churnMrcTrend([employeeId], current.totalMrc, previous.totalMrc, startDate, endDate, prevStartDate, prevEndDate);

        return {
            commission: {
                new: Calculate.trend(current.commissionNew, previous.commissionNew),
                recurring: Calculate.trend(current.commissionRecurring, previous.commissionRecurring),
                total: Calculate.trend(current.commissionNew + current.commissionRecurring, previous.commissionNew + previous.commissionRecurring)
            },
            mrc: Calculate.trend(current.totalMrc, previous.totalMrc),
            ...churn,
            subscription: {
                new: Calculate.trend(current.totalSubscription, previous.totalSubscription),
                recurring: Calculate.trend(current.subscriptionRecurring, previous.subscriptionRecurring),
                total: Calculate.trend(current.totalSubscription + current.subscriptionRecurring, previous.totalSubscription + previous.subscriptionRecurring)
            },
            newCustomer: Calculate.trend(current.newCustomer, previous.newCustomer),
            newAccount: Calculate.trend(current.newAccount, previous.newAccount)
        };
    }

    async getSalesCommissionYearlySummary(employeeId: string, year: number): Promise<any[]> {
        const periodHelper = new PeriodHelper();
        const promises = [];
        for (let month = 1; month <= 12; month++) {
            const { startDate, endDate } = periodHelper.getStartAndEndDateForMonth(year, month);
            promises.push(this.aggregateSalesCommission(employeeId, startDate, endDate));
        }

        const aggregatedData = await Promise.all(promises);

        return aggregatedData.map(data => ({
            commission: data.commissionNew + data.commissionRecurring,
            mrc: data.totalMrc,
            subscription: data.totalSubscription,
            newCustomer: data.newCustomer,
            newAccount: data.newAccount
        }));
    }

    /**
     * Total MRC (new/upgrade/prorate/add, sama dengan kartu Total MRC) milik satu sales dalam satu periode.
     */
    async getSalesTotalMrc(employeeId: string, startDate: string, endDate: string): Promise<number> {
        const data = await this.aggregateSalesCommission(employeeId, startDate, endDate);
        return data.totalMrc;
    }

    /**
     * Ringkasan New MRC & DPP satu sales dalam satu periode, untuk API eksternal /commission/:email.
     * Angkanya sama dengan kartu Total MRC & Total Subscription (New / Recurring) di halaman Sales Commission.
     */
    async getSalesNewMrcSummary(employeeId: string, startDate: string, endDate: string): Promise<SalesNewMrcSummary> {
        const data = await this.aggregateSalesCommission(employeeId, startDate, endDate);
        // Dibulatkan ke rupiah; addon = sisa supaya newCustomer + addon selalu = value
        const value = Math.round(data.totalMrc);
        const newCustomer = Math.round(data.mrcNew);

        // Tanggal invoice & periode kontrak tidak disimpan di snapshot, diambil dari NIS (baca saja)
        const ais = [...data.dealRows.map(d => d.row.ai), ...data.renewalRows.map(r => r.ai)];
        const invoiceDates = new Map<number, any>(
            (await this.nisService.getInvoiceDatesByAi(Array.from(new Set(ais)))).map((r: any) => [Number(r.ai), r])
        );
        const deals = data.dealRows.map(({ row, mrc }) => this.toDeal(row, mrc, invoiceDates));

        const renewals = data.renewalRows.map(row => {
            const dpp = Number(row.subscription) || 0;
            const termMonths = Number(row.month_period);
            const dates = invoiceDates.get(Number(row.ai));
            return {
                ...this.invoiceFields(row, invoiceDates),
                contractStart: toDateString(dates?.period_start_date),
                contractEnd: toDateString(dates?.period_end_date),
                termMonths,
                dpp,
                mrc: Math.round(dpp / termMonths)
            };
        });

        return {
            newMrc: {
                value,
                dealCount: data.dealCount,
                byType: { newCustomer, addon: value - newCustomer },
                deals
            },
            renewals: {
                count: renewals.length,
                dppTotal: renewals.reduce((sum, r) => sum + r.dpp, 0),
                items: renewals
            },
            dpp: {
                total: data.totalSubscription + data.subscriptionRecurring,
                new: data.totalSubscription,
                custLama: data.subscriptionRecurring,
                includesPpn: false
            }
        };
    }

    private invoiceFields(row: any, invoiceDates: Map<number, any>) {
        return {
            ai: row.ai,
            invoiceNo: row.invoice_number != null ? String(row.invoice_number) : null,
            crmOpportunityId: null,
            invoiceDate: toDateString(invoiceDates.get(Number(row.ai))?.invoice_date),
            paidDate: toDateString(row.paid_date),
            customerId: row.customer_id ?? null,
            customerName: row.customer_company ?? null,
            productName: row.service_name ?? null,
            productLine: row.service_type
        };
    }

    private toDeal(row: any, mrc: number, invoiceDates: Map<number, any>): SalesDeal {
        return {
            ...this.invoiceFields(row, invoiceDates),
            type: row.status === 'new' ? 'newCustomer' : 'addon',
            status: row.status,
            mrc: Math.round(mrc),
            dpp: Number(row.subscription) || 0,
            termMonths: Number(row.month_period) || 1
        };
    }

    /**
     * Deal cross-sell semua sales di periode, untuk API eksternal /commission/:email: invoice internal
     * new/termin dengan cross_sell_count > 0 (baris komisi 15%) yang membawa MRC, dihitung sama dengan newMrc.deals.
     * Tiap deal diberi AM penjual dan AM Resell pemilik layanan resell aktif di customer ID yang sama
     * (dari NIS, SalesId saat ini; pemilik pertama = aktivasi resell paling awal). Dibagi per orang lewat crossSellFor().
     */
    async getCrossSellDeals(startDate: string, endDate: string): Promise<CrossSellDealEntry[]> {
        const rows = (await this.snapshotRepository.getInternalCrossSellInvoice(startDate, endDate))
            .map((row: any) => ({
                row,
                mrc: this.applyMrcOverride(row, row.status !== 'termin'
                    ? Calculate.mrc(Number(row.subscription) || 0, Number(row.month_period) || 1, row.status) : 0)
            }))
            .filter(({ mrc }) => mrc !== 0);
        if (rows.length === 0) return [];

        const customerIds = Array.from(new Set(rows.map(({ row }) => row.customer_id).filter(Boolean))) as string[];
        const [dateRows, ownerRows] = await Promise.all([
            this.nisService.getInvoiceDatesByAi(rows.map(({ row }) => Number(row.ai))),
            this.nisService.getResellOwnersByCustomerIds(customerIds)
        ]);
        const invoiceDates = new Map<number, any>(dateRows.map((r: any) => [Number(r.ai), r]));

        // Urut aktivasi paling awal dulu, jadi pemilik pertama = AM Resell utama
        const ownersByCustomer = new Map<string, string[]>();
        for (const r of ownerRows) {
            const list = ownersByCustomer.get(r.customer_id) ?? [];
            if (!list.includes(r.sales_id)) list.push(r.sales_id);
            ownersByCustomer.set(r.customer_id, list);
        }
        const emails = new Map<string, string>(
            (await this.snapshotRepository.getEmployeeEmails(Array.from(new Set(ownerRows.map((r: any) => r.sales_id)))))
                .map((r: any) => [r.employee_id, r.email])
        );

        return rows.map(({ row, mrc }) => {
            const ownerIds = ownersByCustomer.get(row.customer_id) ?? [];
            const ownerEmails = ownerIds.map(id => emails.get(id)).filter((e): e is string => !!e);
            return {
                sellerId: row.sales_id,
                resellOwnerIds: ownerIds,
                deal: {
                    ...this.toDeal(row, mrc, invoiceDates),
                    sellerEmail: row.sales_email ?? null,
                    resellOwnerEmployeeId: ownerIds[0] ?? null,
                    resellOwnerEmail: ownerIds.length ? (emails.get(ownerIds[0]) ?? null) : null,
                    resellOwnerEmails: ownerEmails
                }
            };
        });
    }

    /**
     * crossSell satu orang. Kredit cross-sell milik AM Resell utama di customer itu (bukan penjualnya);
     * New MRC tetap milik penjual di newMrc. Customer tanpa layanan resell aktif (resellOwnerEmail null)
     * tidak dikreditkan ke siapa pun. asSeller = deal yang dijual orang ini tapi kreditnya bukan ke dia
     * (ke AM Resell lain, atau tanpa pemilik) -- catatan saja, tidak ikut value.
     */
    crossSellFor(entries: CrossSellDealEntry[], employeeId: string): SalesCrossSell {
        const summarize = (list: CrossSellDealEntry[]) => ({
            value: list.reduce((sum, e) => sum + e.deal.mrc, 0),
            count: list.length,
            deals: list.map(e => e.deal)
        });
        const creditedTo = (e: CrossSellDealEntry) => e.resellOwnerIds[0] ?? null;
        return {
            ...summarize(entries.filter(e => creditedTo(e) === employeeId)),
            asSeller: summarize(entries.filter(e => e.sellerId === employeeId && creditedTo(e) !== employeeId))
        };
    }

    /**
     * Churn per sales untuk API eksternal /commission/:email. `value` sama dengan kartu MRC churn
     * (kriteria getChurnMrcBySales), `mrcActiveStart` = MRC aktif pada startDate sebagai penyebut churn rate.
     * NIS belum mencatat downgrade, jadi semua churn 'full'; reason = CustCloseReason (teks bebas dari NIS).
     */
    async getSalesChurnSummary(salesIds: string[], startDate: string, endDate: string): Promise<Map<string, SalesChurnSummary>> {
        const [churnRows, activeRows] = await Promise.all([
            this.nisService.getChurnListBySales(salesIds, startDate, endDate),
            this.nisService.getActiveMrcBySales(salesIds, startDate)
        ]);
        const activeMrc = new Map<string, number>(activeRows.map((r: any) => [r.sales_id, Number(r.total) || 0]));

        return new Map(salesIds.map(salesId => {
            const rows = churnRows.filter((r: any) => r.sales_id === salesId);
            const value = rows.reduce((sum: number, r: any) => sum + (Number(r.mrc) || 0), 0);
            return [salesId, {
                value: Math.round(value),
                customerCount: new Set(rows.map((r: any) => r.customer_id)).size,
                mrcActiveStart: Math.round(activeMrc.get(salesId) ?? 0),
                customers: rows.map((r: any) => ({
                    customerServiceId: r.customer_service_id,
                    customerId: r.customer_id ?? null,
                    customerName: r.customer_company ?? null,
                    productName: r.service_name ?? null,
                    churnType: 'full' as const,
                    mrcLost: Math.round(Number(r.mrc) || 0),
                    effectiveDate: toDateString(r.unreg_date),
                    reason: r.close_reason ?? null
                }))
            }];
        }));
    }

    private async aggregateSalesCommission(employeeId: string, startDate: string, endDate: string) {
        const [internalSnapshots, resellSnapshots] = await Promise.all([
            this.snapshotRepository.getInternalInvoice(employeeId, startDate, endDate),
            this.snapshotRepository.getResellInvoice(employeeId, startDate, endDate)
        ]);

        let commissionNew = 0;
        let commissionRecurring = 0;
        let totalMrc = 0;
        let totalSubscription = 0;
        let subscriptionRecurring = 0;
        let newAccount = 0;
        // MRC dipecah: invoice 'new' (layanan baru) vs upgrade/prorate/add (add-on). dealKeys = layanan yang menghasilkan MRC.
        let mrcNew = 0;
        let mrcAddon = 0;
        const dealKeys = new Set<string>();
        const newCustomerIds = new Set<string>();
        // Rincian per invoice untuk API eksternal: baris yang membawa MRC, dan recurring tahunan (renewal)
        const dealRows: { row: any; mrc: number }[] = [];
        const renewalRows: any[] = [];
        const addMrc = (row: any, mrc: number) => {
            totalMrc += mrc;
            if (row.status === 'new') mrcNew += mrc; else mrcAddon += mrc;
            if (mrc > 0) dealKeys.add(`${row.service_type}:${row.customer_service_id ?? `ai${row.ai}`}`);
            if (mrc !== 0) dealRows.push({ row, mrc });
        };

        for (const row of internalSnapshots) {
            const subscription = Number(row.subscription) || 0;
            const monthPeriod = Number(row.month_period) || 1;
            const status = row.status;

            const { commissionAmount } = Calculate.internalSalesCommission(
                status, this.commissionBase(row, subscription), row.cross_sell_count, monthPeriod
            );

            if (status === 'recurring') {
                commissionRecurring += commissionAmount;
                subscriptionRecurring += subscription;
                if (Number(row.month_period) >= 12) renewalRows.push(row);
            } else if (['new', 'prorate', 'upgrade', 'termin', 'add'].includes(status)) {
                commissionNew += commissionAmount;
                addMrc(row, this.applyMrcOverride(row, status !== 'termin' ? Calculate.mrc(subscription, monthPeriod, status) : 0));
                totalSubscription += subscription;
            }

            if (status === 'new' && row.customer_id) newCustomerIds.add(row.customer_id);
            if (['new', 'upgrade', 'prorate', 'termin', 'add'].includes(status)) newAccount += Number(row.total_account) || 0;
        }

        const newResellServiceIds = this.collectNewResellServiceIds(resellSnapshots);
        for (const row of resellSnapshots) {
            const subscription = Number(row.subscription) || 0;
            const status = row.status;

            const { commissionAmount } = Calculate.resellSalesCommission(
                status, subscription, Number(row.total_account) || 1, Number(row.modal) || 0, this.commissionBase(row, subscription)
            );

            if (status === 'recurring') {
                commissionRecurring += commissionAmount;
                subscriptionRecurring += subscription;
                if (Number(row.month_period) >= 12) renewalRows.push(row);
            } else if (['new', 'prorate', 'upgrade', 'termin', 'add'].includes(status)) {
                commissionNew += commissionAmount;
                // MRC 0 utk prorate (dan upgrade sebelum periode aturan baru) resell jika ada 'new' dgn customer_service_id sama di periode ini
                addMrc(row, this.resellMrc(row, newResellServiceIds, startDate));
                totalSubscription += subscription;
            }

            if (status === 'new' && row.customer_id) newCustomerIds.add(row.customer_id);
            if (['new', 'upgrade', 'prorate', 'termin', 'add'].includes(status)) newAccount += Number(row.total_account) || 0;
        }

        return { commissionNew, commissionRecurring, totalMrc, totalSubscription, subscriptionRecurring, newCustomer: newCustomerIds.size, newAccount, mrcNew, mrcAddon, dealCount: dealKeys.size, dealRows, renewalRows };
    }

    async getInternalInvoiceDetail(employeeId: string, startDate: string, endDate: string): Promise<any> {
        const snapshots = await this.snapshotRepository.getInternalInvoice(employeeId, startDate, endDate);

        return snapshots.map(row => {
            const subscription = Number(row.subscription) || 0;
            const monthPeriod = Number(row.month_period) || 1;

            const { commissionAmount, commissionPercentage } = Calculate.internalSalesCommission(
                row.status, this.commissionBase(row, subscription), row.cross_sell_count, monthPeriod
            );

            return {
                ai: row.ai,
                invoiceNumber: row.invoice_number,
                sequenceNumber: row.sequence_number,
                paidDate: row.paid_date,
                status: row.status,
                monthPeriod: row.month_period,
                monthPeriodSummary: Calculate.monthPeriodSummary(monthPeriod),
                totalAccount: row.total_account,
                customerId: row.customer_id,
                customerServiceId: row.customer_service_id,
                customerCompany: row.customer_company,
                contractUntilDate: row.contract_until_date,
                serviceGroupId: row.service_group_id,
                serviceId: row.service_id,
                serviceName: row.service_name,
                serviceType: row.service_type,
                crossSellCount: row.cross_sell_count,
                implementator: {
                    name: row.implementator_name || '',
                    employeeId: row.implementator_id || '',
                    photoProfile: row.implementator_photo_profile || ''
                },
                subscription,
                baseCommission: row.base_commission !== null && row.base_commission !== undefined ? Number(row.base_commission) : null,
                mrcOverride: row.mrc_override !== null && row.mrc_override !== undefined ? Number(row.mrc_override) : null,
                mrc: this.applyMrcOverride(row, ['recurring', 'termin'].includes(row.status) ? 0 : Calculate.mrc(subscription, monthPeriod, row.status)),
                commissionPercentage,
                commission: commissionAmount,
                isAdjust: Boolean(row.is_adjust)
            };
        });
    }

    /**
     * Kumpulkan customer_service_id yang punya invoice 'new' (resell) dalam satu set baris/periode.
     */
    private collectNewResellServiceIds(rows: any[]): Set<any> {
        const ids = new Set<any>();
        for (const row of rows) {
            if (row.status === 'new' && row.customer_service_id != null) {
                ids.add(row.customer_service_id);
            }
        }
        return ids;
    }

    /**
     * MRC untuk baris resell.
     * - mrc_override (diisi manual lewat edit /invoice): selalu dipakai kalau terisi
     * - recurring / termin: selalu 0
     * - prorate: 0 jika customer_service_id-nya juga punya invoice 'new' di periode yang sama
     *   (hindari dobel hitung; new-nya sudah membawa MRC).
     * - upgrade: SEBELUM periode aturan baru (< 26 Juli 2026), berlaku aturan yang sama seperti
     *   prorate di atas (bisa 0 kalau ada 'new' di periode sama). MULAI periode aturan baru,
     *   upgrade SELALU dihitung MRC-nya, tidak pernah di-nol-kan oleh aturan dedup ini lagi.
     * - upgrade (jika tidak di-nol-kan): MRC dibagi bulan bulat (lihat Calculate.resellUpgradeMrc)
     * - new / prorate / add: MRC normal (subscription / monthPeriod); add < 1 bulan = subscription penuh
     */
    /**
     * MRC churn (layanan yang unreg di periode, dari NIS) dan Net MRC = Total MRC - MRC churn.
     */
    private async churnMrcTrend(salesIds: string[], currentMrc: number, previousMrc: number, startDate: string, endDate: string, prevStartDate: string, prevEndDate: string) {
        const [currentChurn, previousChurn] = await Promise.all([
            this.nisService.getChurnMrcBySales(salesIds, startDate, endDate),
            this.nisService.getChurnMrcBySales(salesIds, prevStartDate, prevEndDate)
        ]);

        return {
            mrcChurn: Calculate.trend(currentChurn, previousChurn),
            mrcNet: Calculate.trend(currentMrc - currentChurn, previousMrc - previousChurn)
        };
    }

    private previousPeriod(endDate: string): { startDate: string; endDate: string } {
        return new PeriodHelper().getStartAndEndDateForPreviousMonth(new Date(`${endDate}T00:00:00`));
    }

    private resellMrc(row: any, newResellServiceIds: Set<any>, startDate: string): number {
        if (row.mrc_override !== null && row.mrc_override !== undefined) return Number(row.mrc_override);

        const status = row.status;
        if (['recurring', 'termin', 'setup'].includes(status)) return 0;

        const isDuplicateWithNew = newResellServiceIds.has(row.customer_service_id);
        if (status === 'prorate' && isDuplicateWithNew) {
            return 0;
        }
        if (status === 'upgrade' && isDuplicateWithNew && !Calculate.isNewRulePeriod(startDate)) {
            return 0;
        }

        const subscription = Number(row.subscription) || 0;
        const monthPeriod = Number(row.month_period) || 1;
        if (status === 'upgrade') {
            return Calculate.resellUpgradeMrc(subscription, monthPeriod);
        }
        return Calculate.mrc(subscription, monthPeriod, status);
    }

    async getResellInvoiceDetail(employeeId: string, startDate: string, endDate: string): Promise<any> {
        const snapshots = await this.snapshotRepository.getResellInvoice(employeeId, startDate, endDate);
        const newResellServiceIds = this.collectNewResellServiceIds(snapshots);

        return snapshots.map(row => {
            const subscription = Number(row.subscription) || 0;
            const monthPeriod = Number(row.month_period) || 1;
            const modal = Number(row.modal) || 0;

            const { commissionAmount, commissionPercentage, price, markup, margin } = Calculate.resellSalesCommission(
                row.status, subscription, Number(row.total_account) || 1, modal, this.commissionBase(row, subscription)
            );

            return {
                ai: row.ai,
                invoiceNumber: row.invoice_number,
                sequenceNumber: row.sequence_number,
                paidDate: row.paid_date,
                status: row.status,
                monthPeriod: row.month_period,
                monthPeriodSummary: Calculate.monthPeriodSummary(monthPeriod),
                totalAccount: row.total_account,
                customerId: row.customer_id,
                customerServiceId: row.customer_service_id,
                customerCompany: row.customer_company,
                serviceGroupId: row.service_group_id,
                serviceId: row.service_id,
                serviceName: row.service_name,
                serviceType: row.service_type,
                subscription,
                modal,
                price,
                markup,
                margin,
                baseCommission: row.base_commission !== null && row.base_commission !== undefined ? Number(row.base_commission) : null,
                mrcOverride: row.mrc_override !== null && row.mrc_override !== undefined ? Number(row.mrc_override) : null,
                mrc: this.resellMrc(row, newResellServiceIds, startDate),
                commissionPercentage,
                commission: commissionAmount,
                isAdjust: Boolean(row.is_adjust)
            };
        });
    }

    async deleteSnapshotByDateRangeAndType(startDate: string, endDate: string, serviceType: 'internal' | 'resell'): Promise<any> {
        return await this.snapshotRepository.deleteSnapshotByDateRangeAndType(startDate, endDate, serviceType);
    }

    async insertSnapshot(data: SnapshotData): Promise<any> {
        return await this.snapshotRepository.insertSnapshot(data);
    }

    async updateSnapshot(ai: number, data: SnapshotUpdateData): Promise<any> {
        return await this.snapshotRepository.updateSnapshot(ai, data);
    }

    async getManagerTeamSummary(employees: { employeeId: string; name: string; photoProfile: string }[], startDate: string, endDate: string): Promise<any> {
        const results = await Promise.all(
            employees.map(async (emp) => {
                const data = await this.aggregateSalesCommission(emp.employeeId, startDate, endDate);
                const totalCommission = data.commissionNew + data.commissionRecurring;

                return {
                    employeeId: emp.employeeId,
                    name: emp.name,
                    photoProfile: emp.photoProfile,
                    detail: {
                        commission: totalCommission,
                        mrc: data.totalMrc,
                        subscription: data.totalSubscription,
                        newCustomer: data.newCustomer,
                        newAccount: data.newAccount
                    },
                    managerCommission: totalCommission * 0.25
                };
            })
        );

        return results;
    }

    async getManagerTeamYearlySummary(employeesByMonth: { employeeId: string; name: string; photoProfile: string }[][], year: number): Promise<any> {
        // Roster = union semua staff yang pernah jadi anak buah manager ini sepanjang tahun,
        // supaya staff yang pindah masuk/keluar di tengah tahun tetap muncul di daftar.
        const rosterMap = new Map<string, { employeeId: string; name: string; photoProfile: string }>();
        for (const monthList of employeesByMonth) {
            for (const emp of monthList) {
                rosterMap.set(emp.employeeId, emp);
            }
        }
        const roster = Array.from(rosterMap.values());

        const zeroData = { commissionNew: 0, commissionRecurring: 0, totalMrc: 0, totalSubscription: 0, newCustomer: 0, newAccount: 0 };

        const results = await Promise.all(
            roster.map(async (emp) => {
                const periodHelper = new PeriodHelper();

                const monthlyData = await Promise.all(
                    employeesByMonth.map(async (monthList, idx) => {
                        // Bulan di mana staff ini bukan anak buah manager (belum/sudah pindah) -> nol,
                        // bukan ikut dihitung ke manager ini.
                        const isMember = monthList.some(m => m.employeeId === emp.employeeId);
                        if (!isMember) return zeroData;

                        const month = idx + 1;
                        const { startDate, endDate } = periodHelper.getStartAndEndDateForMonth(year, month);
                        return this.aggregateSalesCommission(emp.employeeId, startDate, endDate);
                    })
                );

                return {
                    employeeId: emp.employeeId,
                    name: emp.name,
                    photoProfile: emp.photoProfile,
                    monthly: monthlyData.map(data => {
                        const totalCommission = data.commissionNew + data.commissionRecurring;
                        return {
                            commission: totalCommission,
                            mrc: data.totalMrc,
                            subscription: data.totalSubscription,
                            newCustomer: data.newCustomer,
                            newAccount: data.newAccount,
                            managerCommission: totalCommission * 0.25
                        };
                    })
                };
            })
        );

        return results;
    }

    async getManagerCommissionSummary(employeeIds: string[], startDate: string, endDate: string, managerId?: string): Promise<any> {
        // Periode bulan lalu: tanggal 26 dua bulan lalu s/d 25 bulan lalu
        const { startDate: prevStartDate, endDate: prevEndDate } = this.previousPeriod(endDate);

        // Aggregate semua staff untuk current dan previous period
        const [currentResults, previousResults] = await Promise.all([
            Promise.all(employeeIds.map(id => this.aggregateSalesCommission(id, startDate, endDate))),
            Promise.all(employeeIds.map(id => this.aggregateSalesCommission(id, prevStartDate, prevEndDate)))
        ]);

        // Sum across all staff
        const sumData = (results: typeof currentResults) => results.reduce((acc, data) => ({
            commissionNew: acc.commissionNew + data.commissionNew,
            commissionRecurring: acc.commissionRecurring + data.commissionRecurring,
            totalMrc: acc.totalMrc + data.totalMrc,
            totalSubscription: acc.totalSubscription + data.totalSubscription,
            subscriptionRecurring: acc.subscriptionRecurring + data.subscriptionRecurring,
            newCustomer: acc.newCustomer + data.newCustomer,
            newAccount: acc.newAccount + data.newAccount
        }), { commissionNew: 0, commissionRecurring: 0, totalMrc: 0, totalSubscription: 0, subscriptionRecurring: 0, newCustomer: 0, newAccount: 0 });

        const current = sumData(currentResults);
        const previous = sumData(previousResults);

        const currentTotal = current.commissionNew + current.commissionRecurring;
        const previousTotal = previous.commissionNew + previous.commissionRecurring;

        // "Cust Lama" = komisi & subscription invoice RECURRING pribadi manager sebagai sales (sales_id = manager),
        // sama dengan tabel "Manager's own recurring invoices". Invoice new/upgrade/prorate/add milik manager
        // tidak dihitung. Dihitung PENUH (bukan dipotong 25%), lalu DITAMBAHKAN ke angka tim untuk jadi headline
        // "Manager Commission" & "Total Subscription" (total: tim + pribadi manager).
        // Komisi Cust Lama hanya untuk manager & periode di CUST_LAMA_CLAIM_UNTIL; selain itu 0 (subscription tetap tampil).
        let managerCurrentCommission = 0;
        let managerPreviousCommission = 0;
        let managerCurrentSubscription = 0;
        let managerPreviousSubscription = 0;
        let custLamaCommission = Calculate.trend(0, 0);
        let custLamaSubscription = Calculate.trend(0, 0);

        if (managerId) {
            const [managerCurrent, managerPrevious] = await Promise.all([
                this.aggregateSalesCommission(managerId, startDate, endDate),
                this.aggregateSalesCommission(managerId, prevStartDate, prevEndDate)
            ]);

            managerCurrentCommission = claimsCustLama(managerId, endDate) ? managerCurrent.commissionRecurring : 0;
            managerPreviousCommission = claimsCustLama(managerId, prevEndDate) ? managerPrevious.commissionRecurring : 0;
            custLamaCommission = Calculate.trend(managerCurrentCommission, managerPreviousCommission);

            managerCurrentSubscription = managerCurrent.subscriptionRecurring;
            managerPreviousSubscription = managerPrevious.subscriptionRecurring;
            custLamaSubscription = Calculate.trend(managerCurrentSubscription, managerPreviousSubscription);
        }

        const managerCommissionCurrent = (currentTotal * 0.25) + managerCurrentCommission;
        const managerCommissionPrevious = (previousTotal * 0.25) + managerPreviousCommission;

        const subscriptionTotalCurrent = current.totalSubscription + current.subscriptionRecurring + managerCurrentSubscription;
        const subscriptionTotalPrevious = previous.totalSubscription + previous.subscriptionRecurring + managerPreviousSubscription;

        const churn = await this.churnMrcTrend(employeeIds, current.totalMrc, previous.totalMrc, startDate, endDate, prevStartDate, prevEndDate);

        return {
            managerCommission: Calculate.trend(managerCommissionCurrent, managerCommissionPrevious),
            commission: {
                new: Calculate.trend(current.commissionNew, previous.commissionNew),
                recurring: Calculate.trend(current.commissionRecurring, previous.commissionRecurring),
                total: Calculate.trend(currentTotal, previousTotal),
                custLama: custLamaCommission
            },
            mrc: Calculate.trend(current.totalMrc, previous.totalMrc),
            ...churn,
            subscription: {
                new: Calculate.trend(current.totalSubscription, previous.totalSubscription),
                recurring: Calculate.trend(current.subscriptionRecurring, previous.subscriptionRecurring),
                total: Calculate.trend(subscriptionTotalCurrent, subscriptionTotalPrevious),
                custLama: custLamaSubscription
            },
            newCustomer: Calculate.trend(current.newCustomer, previous.newCustomer),
            newAccount: Calculate.trend(current.newAccount, previous.newAccount)
        };
    }

    async getManagerCommissionYearlySummary(employeeIdsByMonth: string[][], year: number): Promise<any[]> {
        const periodHelper = new PeriodHelper();
        const promises = [];
        for (let month = 1; month <= 12; month++) {
            const { startDate, endDate } = periodHelper.getStartAndEndDateForMonth(year, month);
            const employeeIds = employeeIdsByMonth[month - 1] || [];

            promises.push(
                Promise.all(employeeIds.map(id => this.aggregateSalesCommission(id, startDate, endDate)))
            );
        }

        const monthlyResults = await Promise.all(promises);

        const sumData = (results: Awaited<ReturnType<typeof this.aggregateSalesCommission>>[]) =>
            results.reduce((acc, data) => ({
                commissionNew: acc.commissionNew + data.commissionNew,
                commissionRecurring: acc.commissionRecurring + data.commissionRecurring,
                totalMrc: acc.totalMrc + data.totalMrc,
                totalSubscription: acc.totalSubscription + data.totalSubscription,
                newCustomer: acc.newCustomer + data.newCustomer,
                newAccount: acc.newAccount + data.newAccount
            }), { commissionNew: 0, commissionRecurring: 0, totalMrc: 0, totalSubscription: 0, newCustomer: 0, newAccount: 0 });

        return monthlyResults.map(staffResults => {
            const data = sumData(staffResults);
            const totalCommission = data.commissionNew + data.commissionRecurring;
            return {
                managerCommission: totalCommission * 0.25,
                commission: totalCommission,
                mrc: data.totalMrc,
                subscription: data.totalSubscription,
                newCustomer: data.newCustomer,
                newAccount: data.newAccount
            };
        });
    }
}
