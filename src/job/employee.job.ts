import { NusaworkService } from '../service/nusawork.service';
import { EmployeeService } from '../service/employee.service';
import { EmployeeRepository } from '../repository/employee.repository';
import { dashboardPool } from '../config/database';

const nusaworkService = new NusaworkService();
const employeeRepository = new EmployeeRepository(dashboardPool);
const employeeService = new EmployeeService(employeeRepository);

async function syncEmployees() {
    console.log('[SYNC] Starting employee synchronization from Nusawork...');
    
    try {
        console.log('[SYNC] Fetching Sales Digital employees...');
        const salesEmployees = (await nusaworkService.getSalesDigital()).map(emp => ({
            ...emp,
            hasDashboard: true
        }));
        console.log(`[SYNC] Found ${salesEmployees.length} Sales Digital employees.`);

        console.log('[SYNC] Fetching Admin employees...');
        const adminEmployees = await nusaworkService.getEmployeeAdmin();
        console.log(`[SYNC] Found ${adminEmployees.length} Admin employees.`);

        console.log('[SYNC] Fetching Implementator employees...');
        const implementatorEmployees = await nusaworkService.getImplementator();
        console.log(`[SYNC] Found ${implementatorEmployees.length} Implementator employees.`);

        // Combine both lists
        const allEmployees = [...salesEmployees, ...adminEmployees, ...implementatorEmployees];
        
        // Remove duplicates if any (based on employeeId)
        const uniqueEmployeesMap = new Map();
        for (const emp of allEmployees) {
            if (uniqueEmployeesMap.has(emp.employeeId)) {
                const existing = uniqueEmployeesMap.get(emp.employeeId);
                uniqueEmployeesMap.set(emp.employeeId, {
                    ...existing,
                    ...emp,
                    hasDashboard: Boolean(existing.hasDashboard || emp.hasDashboard),
                    isAdmin: Boolean(existing.isAdmin || emp.isAdmin),
                });
            } else {
                uniqueEmployeesMap.set(emp.employeeId, emp);
            }
        }
        const uniqueEmployees = Array.from(uniqueEmployeesMap.values());

        console.log(`[SYNC] Total unique employees to sync: ${uniqueEmployees.length}`);

        let successCount = 0;
        let errorCount = 0;

        for (const emp of uniqueEmployees) {
            try {
                await employeeService.insertEmployee(emp);
                successCount++;
            } catch (err: any) {
                console.error(`[SYNC ERROR] Failed to insert employee ${emp.name} (${emp.employeeId}): ${err.message}`);
                errorCount++;
            }
        }

        // Karyawan resign: pakai tanggal resign dari Nusawork supaya filter periode akurat
        const resignedEmployees = await nusaworkService.getResignedEmployees();
        let resignedCount = 0;
        for (const emp of resignedEmployees) {
            resignedCount += await employeeRepository.setDeactivatedAt(emp.userId, emp.resignDate);
        }
        console.log(`[SYNC] Set resign date for ${resignedCount} employees.`);

        // Sisanya yang tidak lagi ada di daftar aktif Nusawork (mis. pindah unit) ditandai nonaktif per hari ini
        const deactivatedCount = await employeeRepository.deactivateEmployeesNotIn(uniqueEmployees.map(emp => emp.userId));
        console.log(`[SYNC] Deactivated ${deactivatedCount} employees no longer active in Nusawork.`);

        console.log(`[SYNC] Completed! Success: ${successCount}, Errors: ${errorCount}`);

    } catch (error: any) {
        console.error(`[SYNC FATAL ERROR] Synchronization failed: ${error.message}`);
    } finally {
        process.exit(0);
    }
}

syncEmployees();
