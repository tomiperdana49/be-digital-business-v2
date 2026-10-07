import { Context } from "hono";
import { IEmployeeService } from "../interface/employee.interface";
import { ApiResponse } from "../helper/response";
import { NotFoundException, BadRequestException } from "../helper/exception";
import { PeriodHelper } from "../helper/period";

export class EmployeeController {
    constructor(
        private readonly employeeService: IEmployeeService,
        private readonly periodHelper: PeriodHelper = new PeriodHelper()
    ) {}

    async getEmployeeByEmployeeId(c: Context) {
        const employeeId = c.req.param('id');
        if (!employeeId) {
            throw new BadRequestException('Employee ID is required');
        }

        const result = await this.employeeService.getEmployeeByEmployeeId(employeeId);
        
        if (!result) {
            throw new NotFoundException('Employee not found');
        }
        
        return ApiResponse.success(c, result, "Employee retrieved successfully");
    }

    async getEmployeeHierarchy(c: Context) {
        const employeeId = c.req.param('id');
        if (!employeeId) {
            throw new BadRequestException('Employee ID is required');
        }

        // Hanya tampilkan karyawan yang masih aktif di periode yang dipilih (default: periode berjalan)
        const { month, year } = c.req.query();
        const { startDate } = this.periodHelper.getPeriodFromQuery(month, year);
        const hierarchy = await this.employeeService.getHierarchy(employeeId, startDate);

        return ApiResponse.success(c, hierarchy, "Employee hierarchy retrieved successfully");
    }

    async setManagerMapping(c: Context) {
        const body = await c.req.json();
        const rawMappings = Array.isArray(body?.mappings) ? body.mappings : [body];

        if (!rawMappings.length) {
            throw new BadRequestException('At least one mapping is required');
        }

        const mappings = rawMappings.map((m: any) => {
            if (!m?.employeeId || !m?.managerId || !m?.year || !m?.month) {
                throw new BadRequestException('employeeId, managerId, year, and month are required for each mapping');
            }
            return {
                employeeId: String(m.employeeId),
                managerId: String(m.managerId),
                year: Number(m.year),
                month: Number(m.month)
            };
        });

        await this.employeeService.setManagerMapping(mappings);

        return ApiResponse.success(c, null, "Manager mapping updated successfully");
    }
}
