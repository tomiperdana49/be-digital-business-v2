import { Context } from "hono";
import { ITargetRepository } from "../interface/target.interface";
import { IEmployeeService } from "../interface/employee.interface";
import { ApiResponse } from "../helper/response";
import { BadRequestException } from "../helper/exception";
import { DEFAULT_BRANCH_TARGET_ID, DEFAULT_ORGANIZATION_TARGET, QUARTER_REWARD } from "../service/reward.service";

export class TargetController {
    constructor(
        private readonly targetRepository: ITargetRepository,
        private readonly employeeService: IEmployeeService
    ) {}

    async list(c: Context) {
        const [targets, employees] = await Promise.all([
            this.targetRepository.getAll(),
            this.employeeService.getAllEmployees()
        ]);

        // Daftar branch & organisasi yang dipakai karyawan, untuk pilihan di form target
        const branchMap = new Map<string, string>();
        const organizationBranches = new Map<string, Set<string>>();
        for (const e of employees) {
            if (e.branch_id) branchMap.set(e.branch_id, e.branch);
            // Organisasi dari karyawan admin (VP, direksi, finance, dll.) tidak dijadikan pilihan target
            if (e.organization_name && !e.is_admin) {
                const branchIds = organizationBranches.get(e.organization_name) ?? new Set<string>();
                if (e.branch_id) branchIds.add(e.branch_id);
                organizationBranches.set(e.organization_name, branchIds);
            }
        }
        const branches = [
            { branchId: DEFAULT_BRANCH_TARGET_ID, name: 'Default (branch lain)' },
            ...Array.from(branchMap, ([branchId, name]) => ({ branchId, name })).sort((a, b) => a.branchId.localeCompare(b.branchId))
        ];

        // branchIds: branch tempat organisasi tsb ada, supaya form bisa memfilter organisasi per branch
        const organizations = [
            { organizationName: DEFAULT_ORGANIZATION_TARGET, name: 'Semua organisasi', branchIds: [] as string[] },
            ...Array.from(organizationBranches)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, branchIds]) => ({ organizationName: name, name, branchIds: Array.from(branchIds).sort() }))
        ];

        return ApiResponse.success(c, { targets, branches, organizations, rules: QUARTER_REWARD }, "Branch targets retrieved successfully");
    }

    async upsert(c: Context) {
        const body = await c.req.json();
        const branchId = typeof body.branchId === 'string' ? body.branchId.trim() : '';
        const organizationName = typeof body.organizationName === 'string' && body.organizationName.trim()
            ? body.organizationName.trim()
            : DEFAULT_ORGANIZATION_TARGET;
        const year = Number(body.year);
        const month = Number(body.month);
        const targetNewMrc = Number(body.targetNewMrc);

        if (!branchId || branchId.length > 20) {
            throw new BadRequestException('branchId is required (max 20 characters)');
        }
        if (organizationName.length > 255) {
            throw new BadRequestException('organizationName max 255 characters');
        }
        if (!Number.isInteger(year) || year < 2000 || year > 2100) {
            throw new BadRequestException('Valid year is required');
        }
        if (!Number.isInteger(month) || month < 1 || month > 12) {
            throw new BadRequestException('Valid month (1-12) is required');
        }
        if (!Number.isFinite(targetNewMrc) || targetNewMrc < 0) {
            throw new BadRequestException('targetNewMrc must be a number >= 0');
        }

        await this.targetRepository.upsert({ branchId, organizationName, year, month, targetNewMrc });
        return ApiResponse.success(c, { branchId, organizationName, year, month, targetNewMrc }, "Branch target saved successfully");
    }

    async delete(c: Context) {
        const id = Number(c.req.param('id'));
        if (!Number.isInteger(id) || id <= 0) {
            throw new BadRequestException('Valid id is required');
        }

        const result = await this.targetRepository.delete(id);
        if (!result.affectedRows) {
            throw new BadRequestException('Branch target not found');
        }
        return ApiResponse.success(c, { id }, "Branch target deleted successfully");
    }
}
