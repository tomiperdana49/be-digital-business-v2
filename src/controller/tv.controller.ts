import { createHash, timingSafeEqual } from "node:crypto";
import { subMonths } from "date-fns";
import { Context } from "hono";
import { config } from "../config/app";
import { NotFoundException } from "../helper/exception";
import { PeriodHelper } from "../helper/period";
import { ApiResponse } from "../helper/response";
import { BranchTarget } from "../interface/target.interface";
import { EmployeeService } from "../service/employee.service";
import { RewardService } from "../service/reward.service";
import { SnapshotService } from "../service/snapshot.service";

type Period = { year: number; month: number; startDate: string; endDate: string };

/** Yang boleh tampil di layar TV: tanpa ID, tanpa nominal MRC/target, tanpa komisi. Urutan baris = peringkat. */
type TvMrcRow = {
    name: string;
    photoProfile: string;
    branch: string;
    hasMrc: boolean;
    /** MRC / target bulanan x 100 (1 desimal); null kalau tidak punya target di periode itu atau masih masa percobaan. */
    achievementPercentage: number | null;
    /** Bergabung kurang dari NEW_JOINER_MONTHS bulan lalu. Tanggalnya sendiri tidak dikirim. */
    isNewJoiner: boolean;
};

/** rows = Account Manager, managers = Sales Manager. */
type TvMrcPeriod = Period & { rows: TvMrcRow[]; managers: TvMrcRow[] };

type TvMrcData = { previous: TvMrcPeriod; current: TvMrcPeriod; generatedAt: string };

const CACHE_MS = 2 * 60 * 1000;
const NEW_JOINER_MONTHS = 6;
const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Layar TV "Who's Next? Best MRC": pemenang periode lalu dan ranking periode berjalan.
 * TV tidak bisa login, jadi aksesnya lewat key bersama (TV_DISPLAY_KEY). Kosong = endpoint mati (404).
 */
export class TvController {
    private cache: { at: number; period: string; data: Promise<TvMrcData> } | null = null;

    constructor(
        private readonly snapshotService: SnapshotService,
        private readonly employeeService: EmployeeService,
        private readonly rewardService: RewardService,
        private readonly periodHelper: PeriodHelper = new PeriodHelper()
    ) {}

    async mrc(c: Context) {
        const displayKey = config.tv.displayKey;
        const key = c.req.query('key') ?? '';
        if (!displayKey || !timingSafeEqual(digest(key), digest(displayKey))) {
            throw new NotFoundException('Not found');
        }

        const current = this.periodHelper.getPeriodByDate(new Date());
        const period = `${current.year}-${current.month}`;
        // Beberapa TV yang refresh tidak perlu menghitung ulang MRC tiap orang
        if (!this.cache || this.cache.period !== period || Date.now() - this.cache.at > CACHE_MS) {
            const data = this.build(current);
            this.cache = { at: Date.now(), period, data };
            data.catch(() => { this.cache = null; });
        }

        return ApiResponse.success(c, await this.cache.data, "tv mrc retrieved successfully");
    }

    private async build(current: Period): Promise<TvMrcData> {
        const previous = current.month === 1
            ? this.periodHelper.getPeriodFromQuery(12, current.year - 1)
            : this.periodHelper.getPeriodFromQuery(current.month - 1, current.year);

        const employees = (await this.employeeService.getAllEmployees()).filter((e: any) => e.has_dashboard);
        const accountManagers = employees.filter((e: any) => e.job_position === 'Account Manager');
        const salesManagers = employees.filter((e: any) => e.job_position === 'Sales Manager');
        // Periode lalu tetap menghitung yang resign setelah periode itu dimulai; ranking berjalan hanya yang masih aktif
        const activeSince = (date: string) => (e: any) => !e.deactivated_at || new Date(e.deactivated_at) >= new Date(`${date}T00:00:00`);
        const active = (e: any) => !e.deactivated_at;

        const targets = await this.rewardService.getTargets();
        const [previousRows, currentRows, previousManagers, currentManagers] = await Promise.all([
            this.rankAccountManagers(accountManagers.filter(activeSince(previous.startDate)), previous, targets),
            this.rankAccountManagers(accountManagers.filter(active), current, targets),
            this.rankSalesManagers(salesManagers.filter(activeSince(previous.startDate)), previous, targets),
            this.rankSalesManagers(salesManagers.filter(active), current, targets)
        ]);

        return {
            previous: { ...previous, rows: previousRows, managers: previousManagers },
            current: { ...current, rows: currentRows, managers: currentManagers },
            generatedAt: new Date().toISOString()
        };
    }

    /**
     * Total MRC yang sama dengan kartu di halaman Sales Commission.
     * AM masa percobaan belum dinilai: persennya disembunyikan dan posisinya di bawah. Target tim SM tidak berubah.
     */
    private async rankAccountManagers(employees: any[], period: Period, targets: BranchTarget[]): Promise<TvMrcRow[]> {
        return this.toRanking(await Promise.all(employees.map(async (employee) => ({
            employee,
            mrc: await this.snapshotService.getSalesTotalMrc(employee.employee_id, period.startDate, period.endDate),
            target: employee.join_status === 'Probation' ? 0 : this.rewardService.resolveMonthlyTarget(targets, employee, period.year, period.month)
        }))));
    }

    /**
     * Sama dengan kartu Total MRC di halaman Manager Commission: MRC seluruh tim tanpa penjualan pribadi SM.
     * Target = jumlah target anggota tim. SM tanpa tim di periode itu tidak ikut ranking.
     */
    private async rankSalesManagers(managers: any[], period: Period, targets: BranchTarget[]): Promise<TvMrcRow[]> {
        const entries = await Promise.all(managers.map(async (employee) => {
            const staff = await this.employeeService.getStaffForPeriod(employee.id, period.year, period.month);
            const mrcs = await Promise.all(staff.map((s: any) => this.snapshotService.getSalesTotalMrc(s.employee_id, period.startDate, period.endDate)));
            return {
                employee,
                teamSize: staff.length,
                mrc: mrcs.reduce((sum: number, mrc: number) => sum + mrc, 0),
                target: staff.reduce((sum: number, s: any) => sum + this.rewardService.resolveMonthlyTarget(targets, s, period.year, period.month), 0)
            };
        }));
        return this.toRanking(entries.filter(entry => entry.teamSize > 0));
    }

    /**
     * Persen pencapaian tertinggi di atas (nilai asli, bukan yang dibulatkan), supaya adil antartim yang targetnya berbeda.
     * Seri: MRC terbesar, lalu nama. Yang tidak punya target di paling bawah.
     */
    private toRanking(entries: { employee: any; mrc: number; target: number }[]): TvMrcRow[] {
        const newJoinerSince = subMonths(new Date(), NEW_JOINER_MONTHS);
        const achievement = ({ mrc, target }: { mrc: number; target: number }) => target > 0 ? mrc / target : -1;
        return [...entries]
            .sort((a, b) => achievement(b) - achievement(a) || b.mrc - a.mrc || a.employee.name.localeCompare(b.employee.name))
            .map(({ employee, mrc, target }) => ({
                name: employee.name,
                photoProfile: employee.photo_profile,
                branch: employee.branch,
                hasMrc: mrc > 0,
                achievementPercentage: target > 0 ? Math.round(mrc / target * 1000) / 10 : null,
                isNewJoiner: Boolean(employee.join_date) && new Date(employee.join_date) > newJoinerSince
            }));
    }
}
