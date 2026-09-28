import { Context } from "hono";
import { ISnapshotService } from "../interface/snapshot.interface";
import { IEmployeeService } from "../interface/employee.interface";
import { ApiResponse } from "../helper/response";
import { PeriodHelper } from "../helper/period";
import { RewardService, QuarterReward } from "../service/reward.service";
import { Calculate } from "../helper/calculate";

export class CommissionController {
    constructor(
        private readonly snapshotService: ISnapshotService,
        private readonly employeeService: IEmployeeService,
        private readonly rewardService: RewardService,
        private readonly periodHelper: PeriodHelper = new PeriodHelper(),
    ) {}

    private previousPeriod(year: number, month: number): { year: number; month: number } {
        return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
    }

    /**
     * Tambahkan reward kuartal ke total komisi (bulan ini & bulan lalu, supaya tren "from last month" tetap benar).
     */
    private withReward(total: { value: number; growth: number }, reward: QuarterReward | null, previousReward: QuarterReward | null) {
        const previousTotal = total.value - total.growth;
        return Calculate.trend(total.value + (reward?.amount ?? 0), previousTotal + (previousReward?.amount ?? 0));
    }

    async implementatorCommission(c: Context) {
        const { month: monthQuery, year: yearQuery } = c.req.query();
        const employeeId = c.req.param('id');

        if (!employeeId) {
            return ApiResponse.error(c, "id is required", 400);
        }

        const period = this.periodHelper.getPeriodFromQuery(monthQuery, yearQuery);
        const data = await this.snapshotService.getImplementatorCommissionSummary(employeeId, period.startDate, period.endDate);
        return ApiResponse.success(c, data, "implementator commission retrieved successfully");
    }

    async implementatorCommissionYearly(c: Context) {
        const { year: yearQuery } = c.req.query();
        const employeeId = c.req.param('id');

        if (!employeeId) {
            return ApiResponse.error(c, "id is required", 400);
        }

        const year = yearQuery ? parseInt(yearQuery, 10) : new Date().getFullYear();
        if (isNaN(year)) {
            return ApiResponse.error(c, "invalid year parameter", 400);
        }

        const data = await this.snapshotService.getImplementatorCommissionYearlySummary(employeeId, year);
        return ApiResponse.success(c, data, "implementator commission yearly retrieved successfully");
    }

    async salesCommission(c: Context) {
        const { month: monthQuery, year: yearQuery } = c.req.query();
        const employeeId = c.req.param('id');

        if (!employeeId) {
            return ApiResponse.error(c, "id is required", 400);
        }

        const period = this.periodHelper.getPeriodFromQuery(monthQuery, yearQuery);
        const [data, employee] = await Promise.all([
            this.snapshotService.getSalesCommissionSummary(employeeId, period.startDate, period.endDate),
            this.employeeService.getEmployeeByEmployeeId(employeeId)
        ]);
        const previous = this.previousPeriod(period.year, period.month);
        const [reward, previousReward] = employee
            ? await Promise.all([
                this.rewardService.getSalesQuarterReward(employee, period.year, period.month),
                this.rewardService.getSalesQuarterReward(employee, previous.year, previous.month)
            ])
            : [null, null];
        data.reward = reward;
        data.commission.total = this.withReward(data.commission.total, reward, previousReward);
        return ApiResponse.success(c, data, "sales commission retrieved successfully");
    }

    async salesCommissionYearly(c: Context) {
        const { year: yearQuery } = c.req.query();
        const employeeId = c.req.param('id');

        if (!employeeId) {
            return ApiResponse.error(c, "id is required", 400);
        }

        const year = yearQuery ? parseInt(yearQuery, 10) : new Date().getFullYear();
        if (isNaN(year)) {
            return ApiResponse.error(c, "invalid year parameter", 400);
        }

        const data = await this.snapshotService.getSalesCommissionYearlySummary(employeeId, year);
        return ApiResponse.success(c, data, "sales commission yearly retrieved successfully");
    }

    async managerTeam(c: Context) {
        const { month: monthQuery, year: yearQuery } = c.req.query();
        const managerId = c.req.param('id');

        if (!managerId) {
            return ApiResponse.error(c, "id is required", 400);
        }

        // Get staff under this manager
        const manager = await this.employeeService.getManagerById(managerId);
        if (!manager.length) {
            return ApiResponse.error(c, "manager not found", 404);
        }

        const period = this.periodHelper.getPeriodFromQuery(monthQuery, yearQuery);
        const staff = await this.employeeService.getStaffForPeriod(manager[0].id, period.year, period.month);
        const employees = staff.map((s: any) => ({
            employeeId: s.employee_id,
            name: s.name,
            photoProfile: s.photo_profile || ''
        }));

        const data = await this.snapshotService.getManagerTeamSummary(employees, period.startDate, period.endDate);
        return ApiResponse.success(c, data, "manager team commission retrieved successfully");
    }

    async managerTeamYearly(c: Context) {
        const { year: yearQuery } = c.req.query();
        const managerId = c.req.param('id');

        if (!managerId) {
            return ApiResponse.error(c, "id is required", 400);
        }

        const manager = await this.employeeService.getManagerById(managerId);
        if (!manager.length) {
            return ApiResponse.error(c, "manager not found", 404);
        }

        const year = yearQuery ? parseInt(yearQuery, 10) : new Date().getFullYear();
        if (isNaN(year)) {
            return ApiResponse.error(c, "invalid year parameter", 400);
        }

        const employeesByMonth = await Promise.all(
            Array.from({ length: 12 }, async (_, idx) => {
                const staff = await this.employeeService.getStaffForPeriod(manager[0].id, year, idx + 1);
                return staff.map((s: any) => ({
                    employeeId: s.employee_id,
                    name: s.name,
                    photoProfile: s.photo_profile || ''
                }));
            })
        );

        const data = await this.snapshotService.getManagerTeamYearlySummary(employeesByMonth, year);
        return ApiResponse.success(c, data, "manager team yearly retrieved successfully");
    }

    async managerCommission(c: Context) {
        const { month: monthQuery, year: yearQuery } = c.req.query();
        const managerId = c.req.param('id');

        if (!managerId) {
            return ApiResponse.error(c, "id is required", 400);
        }

        const manager = await this.employeeService.getManagerById(managerId);
        if (!manager.length) {
            return ApiResponse.error(c, "manager not found", 404);
        }

        const period = this.periodHelper.getPeriodFromQuery(monthQuery, yearQuery);
        const staff = await this.employeeService.getStaffForPeriod(manager[0].id, period.year, period.month);
        // Manager Commission = 25% dari komisi TIM saja. Komisi pribadi manager sebagai sales
        // adalah penghasilan terpisah (dilihat lewat invoice-nya sendiri), tidak dicampur ke pool ini.
        const employeeIds = staff.map((s: any) => s.employee_id);

        const data = await this.snapshotService.getManagerCommissionSummary(employeeIds, period.startDate, period.endDate, managerId);
        const previous = this.previousPeriod(period.year, period.month);
        const [reward, previousReward] = await Promise.all([
            this.rewardService.getManagerQuarterReward(manager[0], period.year, period.month),
            this.rewardService.getManagerQuarterReward(manager[0], previous.year, previous.month)
        ]);
        data.reward = reward;
        data.managerCommission = this.withReward(data.managerCommission, reward, previousReward);
        return ApiResponse.success(c, data, "manager commission retrieved successfully");
    }

    async managerCommissionYearly(c: Context) {
        const { year: yearQuery } = c.req.query();
        const managerId = c.req.param('id');

        if (!managerId) {
            return ApiResponse.error(c, "id is required", 400);
        }

        const manager = await this.employeeService.getManagerById(managerId);
        if (!manager.length) {
            return ApiResponse.error(c, "manager not found", 404);
        }

        const year = yearQuery ? parseInt(yearQuery, 10) : new Date().getFullYear();
        if (isNaN(year)) {
            return ApiResponse.error(c, "invalid year parameter", 400);
        }

        const employeeIdsByMonth = await Promise.all(
            Array.from({ length: 12 }, async (_, idx) => {
                const staff = await this.employeeService.getStaffForPeriod(manager[0].id, year, idx + 1);
                // Manager Commission = 25% dari komisi TIM saja (lihat catatan di managerCommission()).
                return staff.map((s: any) => s.employee_id);
            })
        );

        const data = await this.snapshotService.getManagerCommissionYearlySummary(employeeIdsByMonth, year);
        return ApiResponse.success(c, data, "manager commission yearly retrieved successfully");
    }
}