import { EmployeeRepository } from '../repository/employee.repository';
import { dashboardPool } from '../config/database';
import { PeriodHelper } from '../helper/period';

const employeeRepository = new EmployeeRepository(dashboardPool);
const periodHelper = new PeriodHelper();

async function snapshotManagerMapping() {
    console.log('[SYNC] Starting manager mapping snapshot...');

    const currentPeriod = periodHelper.getPeriodByDate(new Date());
    const year = process.argv[2] ? Number(process.argv[2]) : currentPeriod.year;
    const month = process.argv[3] ? Number(process.argv[3]) : currentPeriod.month;

    try {
        console.log(`[SYNC] Snapshotting current manager mapping for period ${year}-${month}...`);
        // Karyawan nonaktif tidak di-mapping ke periode baru; mapping periode lama tetap utuh
        const employees = await employeeRepository.getActiveEmployees();
        const staff = employees.filter(emp => emp.manager_id != null);

        console.log(`[SYNC] Found ${staff.length} employees with a manager assigned.`);

        let successCount = 0;
        let errorCount = 0;

        for (const emp of staff) {
            try {
                await employeeRepository.upsertManagerMapping(emp.id, emp.manager_id, year, month);
                successCount++;
            } catch (err: any) {
                console.error(`[SYNC ERROR] Failed to snapshot mapping for employee ${emp.employee_id}: ${err.message}`);
                errorCount++;
            }
        }

        console.log(`[SYNC] Completed! Success: ${successCount}, Errors: ${errorCount}`);
    } catch (error: any) {
        console.error(`[SYNC FATAL ERROR] Manager mapping snapshot failed: ${error.message}`);
    } finally {
        process.exit(0);
    }
}

snapshotManagerMapping();
