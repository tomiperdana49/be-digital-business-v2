import { ITargetRepository, BranchTarget } from '../interface/target.interface';
import { ISnapshotService } from '../interface/snapshot.interface';
import { IEmployeeService } from '../interface/employee.interface';
import { PeriodHelper } from '../helper/period';

/**
 * Reward kuartal berdasarkan pencapaian New MRC terhadap target.
 * - AM: akumulasi New MRC sendiri 1 kuartal >= 125% dari target kuartal (target bulanan branch + organisasi x 3).
 * - SM: akumulasi New MRC seluruh AM di timnya >= 125% dari jumlah target kuartal AM tsb.
 *   Karyawan yang menjadi manager_id karyawan lain dianggap SM: tidak dapat reward AM.
 *   Reward SM hanya untuk jabatan Sales Manager (VP / Product Manager tidak dapat).
 * Kuartal mengikuti periode komisi (Q3 = periode Juli, Agustus, September).
 * Reward hanya ditampilkan di bulan terakhir kuartal (Mar/Jun/Sep/Des) dan berlaku mulai REWARD_START;
 * periode lain mengembalikan null (reward tidak ditampilkan).
 */
export const QUARTER_REWARD = {
    am: { thresholdPercentage: 125, bonus: 2_000_000 },
    sm: { thresholdPercentage: 125, bonus: 2_500_000 },
};

export const DEFAULT_BRANCH_TARGET_ID = '*';
export const DEFAULT_ORGANIZATION_TARGET = '*';
export const DEFAULT_EMPLOYEE_TARGET = '*';

export interface TargetEmployee {
    employee_id: string;
    branch_id: string | null;
    organization_name: string | null;
}

/**
 * Reward kuartal mulai berlaku Q3 2026 (periode Juli 2026). Kuartal sebelumnya tidak punya reward.
 */
export const REWARD_START = { year: 2026, quarter: 3 };

export const SALES_MANAGER_POSITION = 'Sales Manager';

export interface QuarterReward {
    year: number;
    quarter: number;
    months: number[];
    target: number;
    achievement: number;
    percentage: number;
    thresholdPercentage: number;
    bonus: number;
    eligible: boolean;
    isFinalMonth: boolean;
    amount: number;
}

export class RewardService {
    constructor(
        private readonly targetRepository: ITargetRepository,
        private readonly snapshotService: ISnapshotService,
        private readonly employeeService: IEmployeeService,
        private readonly periodHelper: PeriodHelper = new PeriodHelper()
    ) {}

    isRewardPeriod(year: number, month: number): boolean {
        const isFinalMonth = month % 3 === 0;
        return isFinalMonth && year * 10 + Math.ceil(month / 3) >= REWARD_START.year * 10 + REWARD_START.quarter;
    }

    getQuarterMonths(month: number): number[] {
        const quarter = Math.ceil(month / 3);
        return [quarter * 3 - 2, quarter * 3 - 1, quarter * 3];
    }

    /**
     * Target bulanan karyawan pada (year, month): baris terbaru yang sedang berlaku di periode itu
     * (mulai <= periode, dan akhir >= periode kalau akhirnya diisi), dicari dari yang paling spesifik:
     * karyawan, branch + organisasi, branch saja ('*' organisasi), organisasi saja ('*' branch),
     * lalu default ('*', '*'). Kalau tidak ada sama sekali, 0.
     */
    resolveMonthlyTarget(targets: BranchTarget[], employee: TargetEmployee, year: number, month: number): number {
        const period = year * 100 + month;
        const isActive = (t: BranchTarget) => t.year * 100 + t.month <= period
            && (t.end_year === null || t.end_month === null || t.end_year * 100 + t.end_month >= period);
        const latestOf = (rows: BranchTarget[]) => rows
            .filter(isActive)
            .sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month))[0];
        const latest = (branchId: string, organizationName: string) => latestOf(targets.filter(t =>
            t.employee_id === DEFAULT_EMPLOYEE_TARGET && t.branch_id === branchId && t.organization_name === organizationName
        ));

        const { employee_id: employeeId, branch_id: branchId, organization_name: organizationName } = employee;
        const target = latestOf(targets.filter(t => t.employee_id === employeeId))
            ?? (branchId && organizationName ? latest(branchId, organizationName) : undefined)
            ?? (branchId ? latest(branchId, DEFAULT_ORGANIZATION_TARGET) : undefined)
            ?? (organizationName ? latest(DEFAULT_BRANCH_TARGET_ID, organizationName) : undefined)
            ?? latest(DEFAULT_BRANCH_TARGET_ID, DEFAULT_ORGANIZATION_TARGET);
        return target ? target.target_new_mrc : 0;
    }

    async getSalesQuarterReward(employee: TargetEmployee & { id: string }, year: number, month: number): Promise<QuarterReward | null> {
        if (!this.isRewardPeriod(year, month)) return null;
        if (await this.isManager(employee.id, year, month)) return null;

        const targets = await this.targetRepository.getAll();
        const months = this.getQuarterMonths(month);

        const target = months.reduce((sum, m) => sum + this.resolveMonthlyTarget(targets, employee, year, m), 0);
        const achievements = await Promise.all(
            months.filter(m => m <= month).map(m => {
                const { startDate, endDate } = this.periodHelper.getStartAndEndDateForMonth(year, m);
                return this.snapshotService.getSalesTotalMrc(employee.employee_id, startDate, endDate);
            })
        );

        return this.buildReward(year, month, months, target, achievements.reduce((a, b) => a + b, 0), QUARTER_REWARD.am);
    }

    async getManagerQuarterReward(manager: { id: string; job_position: string }, year: number, month: number): Promise<QuarterReward | null> {
        if (!this.isRewardPeriod(year, month)) return null;
        if (manager.job_position !== SALES_MANAGER_POSITION) return null;

        const managerInternalId = manager.id;
        const targets = await this.targetRepository.getAll();
        const months = this.getQuarterMonths(month);
        const selectedStaff = await this.employeeService.getStaffForPeriod(managerInternalId, year, month);

        let target = 0;
        let achievement = 0;
        for (const m of months) {
            // Bulan setelah bulan yang dipilih belum tentu sudah di-mapping, pakai tim bulan yang dipilih
            const staff = m <= month ? await this.employeeService.getStaffForPeriod(managerInternalId, year, m) : selectedStaff;
            target += staff.reduce((sum: number, s: any) => sum + this.resolveMonthlyTarget(targets, s, year, m), 0);

            if (m <= month) {
                const { startDate, endDate } = this.periodHelper.getStartAndEndDateForMonth(year, m);
                const mrcs = await Promise.all(staff.map((s: any) => this.snapshotService.getSalesTotalMrc(s.employee_id, startDate, endDate)));
                achievement += mrcs.reduce((a, b) => a + b, 0);
            }
        }

        return this.buildReward(year, month, months, target, achievement, QUARTER_REWARD.sm);
    }

    /**
     * SM = karyawan yang menjadi manager_id karyawan lain (live) atau punya staff di mapping periode tsb.
     */
    private async isManager(employeeInternalId: string, year: number, month: number): Promise<boolean> {
        const [liveStaff, periodStaff] = await Promise.all([
            this.employeeService.getStaff(employeeInternalId),
            this.employeeService.getStaffForPeriod(employeeInternalId, year, month)
        ]);
        return liveStaff.length > 0 || periodStaff.length > 0;
    }

    private buildReward(
        year: number,
        month: number,
        months: number[],
        target: number,
        achievement: number,
        rule: { thresholdPercentage: number; bonus: number }
    ): QuarterReward {
        const rawPercentage = target > 0 ? (achievement / target) * 100 : 0;
        // Eligibility pakai nilai asli, bukan yang dibulatkan (124,96% tidak boleh lolos jadi 125%)
        const eligible = target > 0 && rawPercentage >= rule.thresholdPercentage;
        const percentage = Math.round(rawPercentage * 10) / 10;
        const isFinalMonth = month === months[2];

        return {
            year,
            quarter: Math.ceil(month / 3),
            months,
            target,
            achievement,
            percentage,
            thresholdPercentage: rule.thresholdPercentage,
            bonus: rule.bonus,
            eligible,
            isFinalMonth,
            amount: eligible && isFinalMonth ? rule.bonus : 0
        };
    }
}
