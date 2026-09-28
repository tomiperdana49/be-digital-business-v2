import { NisService } from '../service/nis.service';
import { NisRepository } from '../repository/nis.repository';
import { SnapshotService } from '../service/snapshot.service';
import { SnapshotRepository } from '../repository/snapshot.repository';
import { dashboardPool, nisPool } from '../config/database';
import { PeriodHelper } from '../helper/period';
import { differenceInDays, getDaysInMonth, endOfMonth, addDays, startOfDay } from 'date-fns';

const nisRepository = new NisRepository(nisPool);
const nisService = new NisService(nisRepository);
const snapshotRepository = new SnapshotRepository(dashboardPool);
const snapshotService = new SnapshotService(snapshotRepository, nisService);
const periodHelper = new PeriodHelper();

async function syncResellInvoices(startDate: string, endDate: string) {
    console.log('[SYNC] Starting resell invoice synchronization from NIS...');

    try {
        console.log(`[SYNC] Deleting existing resell invoices from ${startDate} to ${endDate}...`);
        await snapshotService.deleteSnapshotByDateRangeAndType(startDate, endDate, 'resell');

        console.log(`[SYNC] Fetching resell invoices from ${startDate} to ${endDate}...`);
        const rows = await nisService.getResellByDateRange(startDate, endDate);
        console.log(`[SYNC] Found ${rows.length} resell invoices.`);

        let successCount = 0;
        let errorCount = 0;

        for (const row of rows) {
            try {
                let status = 'recurring';
                if (row.is_add_account === 1) {
                    status = 'add';
                } else if (row.new_subscription > 0 && row.is_upgrade === 0 && row.is_prorate === 0) {
                    status = 'new';
                } else if (row.is_upgrade === 1 && row.is_prorate === 0) {
                    status = 'upgrade';
                } else if (row.is_prorate === 1 && row.is_upgrade === 0) {
                    status = 'prorate';
                } else if (row.is_upgrade === 0 && row.is_prorate === 0 && row.new_subscription === 0) {
                    status = 'recurring';
                }

                let finalModal = Number(row.modal) || 0;
                let finalMonthPeriod = row.month;

                if (row.period_start_date && row.period_end_date) {
                    const periodStartDate = startOfDay(new Date(row.period_start_date));
                    const periodEndDate = startOfDay(new Date(row.period_end_date));
                    const baseModal = Number(row.modal) || 0;

                    // Cek apakah periode tepat kelipatan bulan
                    // Contoh: 19 Apr - 18 May = 1 bulan (endDate + 1 hari = tanggal yang sama dengan startDate)
                    const nextDayAfterEnd = addDays(periodEndDate, 1);
                    const isExactMonth = nextDayAfterEnd.getDate() === periodStartDate.getDate();

                    if (isExactMonth) {
                        // Hitung jumlah bulan langsung
                        const months = (nextDayAfterEnd.getFullYear() - periodStartDate.getFullYear()) * 12
                            + (nextDayAfterEnd.getMonth() - periodStartDate.getMonth());
                        finalMonthPeriod = months;
                        finalModal = baseModal;
                    } else {
                        // Tanggal janggal: hitung prorata per chunk bulan
                        // Hitung total hari dalam semua bulan kalender yang dicakup periode
                        let totalDaysInMonths = 0;
                        let tempMonth = new Date(periodStartDate.getFullYear(), periodStartDate.getMonth(), 1);
                        const lastMonth = new Date(periodEndDate.getFullYear(), periodEndDate.getMonth(), 1);
                        while (tempMonth <= lastMonth) {
                            totalDaysInMonths += getDaysInMonth(tempMonth);
                            tempMonth = new Date(tempMonth.getFullYear(), tempMonth.getMonth() + 1, 1);
                        }

                        // actualDays inklusif (1 Apr - 10 Apr = 10 hari)
                        const actualDays = differenceInDays(periodEndDate, periodStartDate) + 1;

                        // Modal prorata = (modal / total hari semua bulan) * hari aktual
                        finalModal = (baseModal / totalDaysInMonths) * actualDays;

                        // Month period prorata per chunk bulan
                        let monthPeriod = 0;
                        let current = periodStartDate;
                        while (current <= periodEndDate) {
                            const monthEnd = startOfDay(endOfMonth(current));
                            const chunkEnd = monthEnd < periodEndDate ? monthEnd : periodEndDate;
                            const daysInChunk = differenceInDays(chunkEnd, current) + 1;
                            const daysInMonth = getDaysInMonth(current);
                            monthPeriod += daysInChunk / daysInMonth;
                            current = addDays(chunkEnd, 1);
                        }
                        finalMonthPeriod = monthPeriod;
                    }
                }

                await snapshotService.insertSnapshot({
                    ai: row.ai,
                    invoice_number: row.invoice_number,
                    sequence_number: row.sequence_number,
                    paid_date: row.paid_date,
                    subscription: row.subscription,
                    status: status as any,
                    month_period: finalMonthPeriod,
                    total_account: row.total_account,
                    customer_id: row.customer_id,
                    customer_service_id: row.customer_service_id,
                    customer_company: row.customer_company,
                    contract_until_date: null,
                    service_group_id: row.service_group_id,
                    service_id: row.service_id,
                    service_name: row.service_name,
                    service_type: 'resell',
                    cross_sell_count: 0,
                    sales_id: row.sales_id,
                    manager_sales_id: row.sales_manager_id,
                    implementator_id: null,
                    modal: finalModal
                });
                successCount++;
            } catch (err: any) {
                console.error(`[SYNC ERROR] Failed to insert snapshot for AI ${row.ai}: ${err.message}`);
                errorCount++;
            }
        }

        console.log(`[SYNC] Completed! Success: ${successCount}, Errors: ${errorCount}`);

    } catch (error: any) {
        console.error(`[SYNC FATAL ERROR] Synchronization failed: ${error.message}`);
    }
}

async function main() {
    // Tanpa argumen: periode berjalan, ditambah periode sebelumnya mulai tanggal 26
    const periods = process.argv[2]
        ? [{ startDate: process.argv[2], endDate: process.argv[3] || periodHelper.getStartAndEndDateForCurrentMonth().endDate }]
        : periodHelper.getPeriodsToSync();

    for (const { startDate, endDate } of periods) {
        await syncResellInvoices(startDate, endDate);
    }

    process.exit(0);
}

main();
