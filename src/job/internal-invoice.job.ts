import { NisService } from '../service/nis.service';
import { NisRepository } from '../repository/nis.repository';
import { SnapshotService } from '../service/snapshot.service';
import { SnapshotRepository } from '../repository/snapshot.repository';
import { dashboardPool, nisPool } from '../config/database';
import { PeriodHelper } from '../helper/period';
import { format } from 'date-fns';

const nisRepository = new NisRepository(nisPool);
const nisService = new NisService(nisRepository);
const snapshotRepository = new SnapshotRepository(dashboardPool);
const snapshotService = new SnapshotService(snapshotRepository, nisService);
const periodHelper = new PeriodHelper();

async function syncInternalInvoices(startDate: string, endDate: string) {
    console.log('[SYNC] Starting internal invoice synchronization from NIS...');

    try {
        console.log(`[SYNC] Deleting existing internal invoices from ${startDate} to ${endDate}...`);
        await snapshotService.deleteSnapshotByDateRangeAndType(startDate, endDate, 'internal');

        console.log(`[SYNC] Fetching internal invoices from ${startDate} to ${endDate}...`);
        const rows = await nisService.getInternalByDateRange(startDate, endDate);
        console.log(`[SYNC] Found ${rows.length} internal invoices.`);

        let successCount = 0;
        let errorCount = 0;

        for (const row of rows) {
            try {
                // Selisih bulan dari aktivasi ke awal periode invoice

                let activationMonthDiff = -1;
                if (row.activation_date && row.period_start) {
                    const activationDate = new Date(row.activation_date);
                    const startStr = String(row.period_start);
                    const startYear = Number(startStr.slice(0, 4));
                    const startMonth = Number(startStr.slice(4, 6));

                    if (Number.isFinite(startYear) && Number.isFinite(startMonth)) {
                        activationMonthDiff = (startYear - activationDate.getFullYear()) * 12 +
                            (startMonth - (activationDate.getMonth() + 1));
                    }
                }

                let isUnderContract = false;
                if (Number(row.invoice_type) > 0 && row.contract_until && row.period_start) {
                    const contractDate = new Date(row.contract_until);
                    if (!isNaN(contractDate.getTime())) {
                        const contractYear = contractDate.getFullYear();
                        const contractMonth = (contractDate.getMonth() + 1).toString().padStart(2, '0');
                        const contractEndPeriod = Number(`${contractYear}${contractMonth}`);
                        
                        const startContract = Number(String(row.period_start).slice(0, 6));

                        if (startContract >= contractEndPeriod) {
                            isUnderContract = true;
                        }
                    }
                }

                let status = 'recurring';
                if (row.is_add_account === 1) {
                    status = 'add';
                } else if (row.service_group_id === 'NW' && /\btermin\b(?!\w)/i.test(row.description || '')) {
                    status = 'termin';
                } else if (row.service_group_id === 'NW' && /\bsetup\b(?!\w)/i.test(row.description || '')) {
                    status = 'setup';
                } else if (row.new_subscription > 0 && row.is_upgrade === 0 && row.is_prorate === 0) {
                    status = 'new';
                } else if (row.is_upgrade === 1 && row.is_prorate === 0) {
                    status = 'upgrade';
                } else if (row.is_prorate === 1 && row.is_upgrade === 0) {
                    status = 'prorate';
                } else if (Number(row.invoice_type) > 0) {
                    status = (!isUnderContract && row.service_group_id === 'NW') ? 'termin' : 'recurring';
                } else if (!isUnderContract && activationMonthDiff > 0) {
                    status = 'recurring';
                } else if (row.is_upgrade === 0 && row.is_prorate === 0 && row.new_subscription === 0) {
                    status = 'recurring';
                }

                let monthPeriod = row.month;
                if (row.service_group_id === 'NW' && row.month > 12) {
                    monthPeriod = 12;
                }

                await snapshotService.insertSnapshot({
                    ai: row.ai,
                    invoice_number: row.invoice_number,
                    sequence_number: row.sequence_number,
                    paid_date: row.paid_date,
                    subscription: row.subscription,
                    status: status as any,
                    month_period: monthPeriod,
                    total_account: row.total_account,
                    customer_id: row.customer_id,
                    customer_service_id: row.customer_service_id,
                    customer_company: row.customer_company,
                    contract_until_date: row.contract_until,
                    service_group_id: row.service_group_id,
                    service_id: row.service_id,
                    service_name: row.service_name,
                    service_type: 'internal',
                    cross_sell_count: row.cross_sell_count,
                    sales_id: row.sales_id,
                    manager_sales_id: row.sales_manager_id,
                    implementator_id: row.implementator_id,
                    modal: null
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

/**
 * Implementator yang baru diisi di NIS setelah periode invoice-nya tutup: komisi implementatornya
 * dialihkan ke periode berjalan (implementator_period_date = hari ini), bukan ke periode yang sudah tutup.
 * Komisi sales/manager tetap di periode paid_date. Dijalankan sebelum sync supaya re-sync periode
 * sebelumnya (tanggal 26-31) tidak keburu mengisi implementator ke periode lama.
 */
async function carryOverLateImplementators() {
    const previous = periodHelper.getStartAndEndDateForPreviousMonth();
    const today = format(new Date(), 'yyyy-MM-dd');

    try {
        const rows = await snapshotRepository.getSnapshotsWithoutImplementator(previous.startDate, previous.endDate);
        if (rows.length === 0) return;

        const customerIds = Array.from(new Set(rows.map(row => row.customer_id).filter(Boolean))) as string[];
        const surveyors = await nisService.getSurveyorByCustomerIds(customerIds);
        const surveyorByCustomer = new Map(surveyors.map(row => [row.customer_id, row.implementator_id]));

        let movedCount = 0;
        for (const row of rows) {
            const implementatorId = surveyorByCustomer.get(row.customer_id);
            if (!implementatorId) continue;

            await snapshotRepository.carryOverImplementator(row.ai, implementatorId, today);
            console.log(`[CARRY OVER] AI ${row.ai}: implementator ${implementatorId} dialihkan ke periode ${today}`);
            movedCount++;
        }

        console.log(`[CARRY OVER] ${movedCount} of ${rows.length} invoices without implementator from ${previous.startDate} to ${previous.endDate} moved.`);
    } catch (error: any) {
        console.error(`[CARRY OVER ERROR] ${error.message}`);
    }
}

async function main() {
    // Tanpa argumen: periode berjalan, ditambah periode sebelumnya mulai tanggal 26
    const periods = process.argv[2]
        ? [{ startDate: process.argv[2], endDate: process.argv[3] || periodHelper.getStartAndEndDateForCurrentMonth().endDate }]
        : periodHelper.getPeriodsToSync();

    if (!process.argv[2]) {
        await carryOverLateImplementators();
    }

    for (const { startDate, endDate } of periods) {
        await syncInternalInvoices(startDate, endDate);
    }

    process.exit(0);
}

main();
