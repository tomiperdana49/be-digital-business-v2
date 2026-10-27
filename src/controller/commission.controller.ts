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
        const data = await this.getManagerCommissionSummary(manager[0], period);
        return ApiResponse.success(c, data, "manager commission retrieved successfully");
    }

    /**
     * Untuk client eksternal (lewat API key), dicari berdasarkan email. `month` boleh 1 atau 2 bulan
     * (mis. `10` atau `9,10`) dalam `year` yang sama. Satu struktur untuk semua orang: angka pribadi
     * (New MRC, DPP) + target, dan `team` (New MRC per staff) hanya terisi kalau punya staff di periode itu.
     */
    async clientSalesCommission(c: Context) {
        const { month: monthQuery, year: yearQuery } = c.req.query();
        const email = c.req.param('email');

        if (!email) {
            return ApiResponse.error(c, "email is required", 400);
        }
        if (yearQuery && !/^\d{4}$/.test(yearQuery)) {
            return ApiResponse.error(c, "invalid year parameter", 400);
        }

        let periods = [this.periodHelper.getPeriodFromQuery(null, yearQuery)];
        if (monthQuery) {
            const months = [...new Set(monthQuery.split(',').map(m => m.trim()))];
            if (months.length > 2 || !months.every(m => /^(?:[1-9]|1[0-2])$/.test(m))) {
                return ApiResponse.error(c, "invalid month parameter, expected 1 or 2 months between 1-12, e.g. 10 or 9,10", 400);
            }
            periods = months
                .map(Number)
                .sort((a, b) => a - b)
                .map(month => this.periodHelper.getPeriodFromQuery(month, yearQuery));
        }

        const employee = await this.employeeService.getEmployeeByEmail(email);
        if (!employee) {
            return ApiResponse.error(c, "employee not found", 404, [{ field: "email", value: email }]);
        }

        // Supervisor diambil dari periode terakhir yang diminta
        const lastPeriod = periods[periods.length - 1];
        const [targets, supervisor] = await Promise.all([
            this.rewardService.getTargets(),
            this.employeeService.getManagerForPeriod(employee.id, lastPeriod.year, lastPeriod.month)
        ]);

        const months = await Promise.all(periods.map(async period => {
            const [own, staff, crossSellDeals] = await Promise.all([
                this.snapshotService.getSalesNewMrcSummary(employee.employee_id, period.startDate, period.endDate),
                this.employeeService.getStaffForPeriod(employee.id, period.year, period.month),
                // Deal cross-sell seluruh sales di periode, dibagi per orang (kredit ke AM Resell)
                this.snapshotService.getCrossSellDeals(period.startDate, period.endDate)
            ]);
            // Churn diambil sekali dari NIS untuk sales ini + semua staff-nya
            const churn = await this.snapshotService.getSalesChurnSummary(
                [employee.employee_id, ...staff.map((s: any) => s.employee_id)], period.startDate, period.endDate
            );

            const members = await Promise.all(staff.map(async (s: any) => {
                const summary = await this.snapshotService.getSalesNewMrcSummary(s.employee_id, period.startDate, period.endDate);
                const memberChurn = churn.get(s.employee_id)!;
                const memberCrossSell = this.snapshotService.crossSellFor(crossSellDeals, s.employee_id);
                return {
                    email: s.email,
                    name: s.name,
                    targetNewMrc: this.rewardService.resolveMonthlyTarget(targets, s, period.year, period.month),
                    newMrc: summary.newMrc.value,
                    dealCount: summary.newMrc.dealCount,
                    crossSell: {
                        value: memberCrossSell.value,
                        count: memberCrossSell.count,
                        asSeller: { value: memberCrossSell.asSeller.value, count: memberCrossSell.asSeller.count }
                    },
                    churn: {
                        value: memberChurn.value,
                        customerCount: memberChurn.customerCount,
                        mrcActiveStart: memberChurn.mrcActiveStart
                    }
                };
            }));
            members.sort((a, b) => b.newMrc - a.newMrc);

            return {
                period,
                // Sama seperti reward kuartal: yang punya staff tidak punya target New MRC pribadi
                target: { newMrc: staff.length ? 0 : this.rewardService.resolveMonthlyTarget(targets, employee, period.year, period.month) },
                ...own,
                crossSell: this.snapshotService.crossSellFor(crossSellDeals, employee.employee_id),
                churn: churn.get(employee.employee_id)!,
                team: staff.length
                    ? { newMrc: members.reduce((sum, m) => sum + m.newMrc, 0), includesOwn: false, members }
                    : null
            };
        }));

        return ApiResponse.success(c, {
            sales: {
                employeeId: employee.employee_id,
                email: employee.email,
                name: employee.name,
                jobPosition: employee.job_position,
                branch: employee.branch,
                supervisorEmail: supervisor?.email ?? null
            },
            months,
        }, "sales commission retrieved successfully");
    }

    private async getManagerCommissionSummary(manager: any, period: { year: number; month: number; startDate: string; endDate: string }) {
        const staff = await this.employeeService.getStaffForPeriod(manager.id, period.year, period.month);
        // Manager Commission = 25% dari komisi TIM saja. Komisi pribadi manager sebagai sales
        // adalah penghasilan terpisah (dilihat lewat invoice-nya sendiri), tidak dicampur ke pool ini.
        const employeeIds = staff.map((s: any) => s.employee_id);

        const data = await this.snapshotService.getManagerCommissionSummary(employeeIds, period.startDate, period.endDate, manager.employee_id);
        const previous = this.previousPeriod(period.year, period.month);
        const [reward, previousReward] = await Promise.all([
            this.rewardService.getManagerQuarterReward(manager, period.year, period.month),
            this.rewardService.getManagerQuarterReward(manager, previous.year, previous.month)
        ]);
        data.reward = reward;
        data.managerCommission = this.withReward(data.managerCommission, reward, previousReward);
        return data;
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