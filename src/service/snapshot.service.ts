import { ISnapshotRepository, ISnapshotService, SnapshotData, SnapshotListFilters, SnapshotUpdateData } from '../interface/snapshot.interface';
import { Calculate } from '../helper/calculate';
import { INisService } from '../interface/nis.interface';
import { PeriodHelper } from '../helper/period';

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
        // Hitung periode bulan lalu
        const start = new Date(startDate);
        const prevEnd = new Date(start);
        prevEnd.setDate(prevEnd.getDate() - 1);
        const prevStart = new Date(prevEnd);
        prevStart.setDate(prevStart.getDate() - (Math.round((new Date(endDate).getTime() - start.getTime()) / (1000 * 60 * 60 * 24))));
        const prevStartDate = prevStart.toISOString().split('T')[0];
        const prevEndDate = prevEnd.toISOString().split('T')[0];

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
        // Hitung periode bulan lalu dari startDate
        const start = new Date(startDate);
        const prevEnd = new Date(start);
        prevEnd.setDate(prevEnd.getDate() - 1);
        const prevStart = new Date(prevEnd);
        prevStart.setDate(prevStart.getDate() - (Math.round((new Date(endDate).getTime() - start.getTime()) / (1000 * 60 * 60 * 24))));
        const prevStartDate = prevStart.toISOString().split('T')[0];
        const prevEndDate = prevEnd.toISOString().split('T')[0];

        const [current, previous] = await Promise.all([
            this.aggregateSalesCommission(employeeId, startDate, endDate),
            this.aggregateSalesCommission(employeeId, prevStartDate, prevEndDate)
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
        const newCustomerIds = new Set<string>();

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
            } else if (['new', 'prorate', 'upgrade', 'termin', 'add'].includes(status)) {
                commissionNew += commissionAmount;
                totalMrc += this.applyMrcOverride(row, status !== 'termin' ? Calculate.mrc(subscription, monthPeriod, status) : 0);
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
            } else if (['new', 'prorate', 'upgrade', 'termin', 'add'].includes(status)) {
                commissionNew += commissionAmount;
                // MRC 0 utk prorate (dan upgrade sebelum periode aturan baru) resell jika ada 'new' dgn customer_service_id sama di periode ini
                totalMrc += this.resellMrc(row, newResellServiceIds, startDate);
                totalSubscription += subscription;
            }

            if (status === 'new' && row.customer_id) newCustomerIds.add(row.customer_id);
            if (['new', 'upgrade', 'prorate', 'termin', 'add'].includes(status)) newAccount += Number(row.total_account) || 0;
        }

        return { commissionNew, commissionRecurring, totalMrc, totalSubscription, subscriptionRecurring, newCustomer: newCustomerIds.size, newAccount };
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
        // Hitung periode bulan lalu
        const start = new Date(startDate);
        const prevEnd = new Date(start);
        prevEnd.setDate(prevEnd.getDate() - 1);
        const prevStart = new Date(prevEnd);
        prevStart.setDate(prevStart.getDate() - (Math.round((new Date(endDate).getTime() - start.getTime()) / (1000 * 60 * 60 * 24))));
        const prevStartDate = prevStart.toISOString().split('T')[0];
        const prevEndDate = prevEnd.toISOString().split('T')[0];

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

        // "Cust Lama" = komisi & subscription pribadi manager sebagai sales (sales_id = manager).
        // Dihitung PENUH (bukan dipotong 25%), lalu DITAMBAHKAN ke angka tim untuk jadi headline
        // "Manager Commission" & "Total Subscription" (total: tim + pribadi manager).
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

            managerCurrentCommission = managerCurrent.commissionNew + managerCurrent.commissionRecurring;
            managerPreviousCommission = managerPrevious.commissionNew + managerPrevious.commissionRecurring;
            custLamaCommission = Calculate.trend(managerCurrentCommission, managerPreviousCommission);

            managerCurrentSubscription = managerCurrent.totalSubscription + managerCurrent.subscriptionRecurring;
            managerPreviousSubscription = managerPrevious.totalSubscription + managerPrevious.subscriptionRecurring;
            custLamaSubscription = Calculate.trend(managerCurrentSubscription, managerPreviousSubscription);
        }

        const managerCommissionCurrent = (currentTotal * 0.25) + managerCurrentCommission;
        const managerCommissionPrevious = (previousTotal * 0.25) + managerPreviousCommission;

        const subscriptionTotalCurrent = current.totalSubscription + current.subscriptionRecurring + managerCurrentSubscription;
        const subscriptionTotalPrevious = previous.totalSubscription + previous.subscriptionRecurring + managerPreviousSubscription;

        return {
            managerCommission: Calculate.trend(managerCommissionCurrent, managerCommissionPrevious),
            commission: {
                new: Calculate.trend(current.commissionNew, previous.commissionNew),
                recurring: Calculate.trend(current.commissionRecurring, previous.commissionRecurring),
                total: Calculate.trend(currentTotal, previousTotal),
                custLama: custLamaCommission
            },
            mrc: Calculate.trend(current.totalMrc, previous.totalMrc),
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
