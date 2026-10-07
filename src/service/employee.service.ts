import { Employee } from "../interface/nusawork.interface";
import { IEmployeeRepository, IEmployeeService, ManagerMappingInput } from "../interface/employee.interface";
import { NotFoundException } from "../helper/exception";
import { PeriodHelper } from "../helper/period";

export class EmployeeService implements IEmployeeService {
    constructor(
        private readonly employeeRepository: IEmployeeRepository,
        private readonly periodHelper: PeriodHelper = new PeriodHelper()
    ) {}

    async insertEmployee(data: Employee) {
        const result = await this.employeeRepository.insertEmployee(data);

        // Setiap kali employee di-sync (crawl), langsung mapping ke periode berjalan.
        // Kalau manager_id-nya berubah dari crawl sebelumnya, mapping periode berjalan ikut ter-update.
        if (data.managerId != null) {
            const { year, month } = this.periodHelper.getPeriodByDate(new Date());
            await this.employeeRepository.upsertManagerMapping(Number(data.userId), Number(data.managerId), year, month);
        }

        return result;
    }

    async getManagerById(employeeId: string) {
        return await this.employeeRepository.getManagerById(employeeId);
    }

    async getStaff(managerId: string) {
        return await this.employeeRepository.getStaff(managerId);
    }

    async getStaffForPeriod(managerId: string, year: number, month: number) {
        return await this.employeeRepository.getStaffForPeriod(managerId, year, month);
    }

    async setManagerMapping(mappings: ManagerMappingInput[]) {
        for (const mapping of mappings) {
            const employee = await this.employeeRepository.getEmployeeByEmployeeId(mapping.employeeId);
            if (!employee) {
                throw new NotFoundException(`Employee ${mapping.employeeId} not found`);
            }

            const manager = await this.employeeRepository.getEmployeeByEmployeeId(mapping.managerId);
            if (!manager) {
                throw new NotFoundException(`Manager ${mapping.managerId} not found`);
            }

            await this.employeeRepository.upsertManagerMapping(employee.id, manager.id, mapping.year, mapping.month);
        }
    }

    async getEmployeeByEmployeeId(employeeId: string) {
        return await this.employeeRepository.getEmployeeByEmployeeId(employeeId);
    }

    async getEmployeeById(id: string) {
        return await this.employeeRepository.getEmployeeById(id);
    }

    async getEmployeeByEmail(email: string) {
        return await this.employeeRepository.getEmployeeByEmail(email);
    }

    async getAllEmployees() {
        return await this.employeeRepository.getAllEmployees();
    }

    async getActiveEmployees() {
        return await this.employeeRepository.getActiveEmployees();
    }

    /**
     * activeFrom: awal periode (YYYY-MM-DD). Karyawan yang resign sebelum tanggal ini disembunyikan.
     * Tanpa activeFrom semua karyawan ikut (dipakai untuk otorisasi akses halaman komisi).
     */
    async getHierarchy(employeeId: string, activeFrom?: string) {
        const employee = await this.getEmployeeByEmployeeId(employeeId);

        if (employee && employee.manager_id == null) {
            return await this.employeeRepository.getAllDashboardEmployees(activeFrom);
        }

        return await this.employeeRepository.getHierarchy(employeeId, activeFrom);
    }
}
