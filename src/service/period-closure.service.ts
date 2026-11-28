import { PeriodClosure, PeriodClosureRepository } from '../repository/period-closure.repository';
import { PeriodHelper } from '../helper/period';
import { BadRequestException } from '../helper/exception';
import { format } from 'date-fns';

const periodHelper = new PeriodHelper();

/** Periode komisi (26-25) dari tanggal 'YYYY-MM-DD': tanggal 26-31 masuk periode bulan berikutnya. */
export const periodOfDate = (date: string): { year: number; month: number } => {
    const [y, m, d] = date.slice(0, 10).split('-').map(Number) as [number, number, number];
    if (d >= 26) {
        return m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
    }
    return { year: y, month: m };
};

/**
 * Periode yang sudah di-close tidak di-sync ulang dan tidak bisa diedit dari halaman admin,
 * sampai dibuka lagi. Tanpa baris di period_closures, periode tetap tertutup otomatis setelah
 * akhir bulan (job sync hanya mengulang periode sebelumnya sampai tanggal 31).
 */
export class PeriodClosureService {
    constructor(private readonly repository: PeriodClosureRepository) {}

    async list(): Promise<PeriodClosure[]> {
        return this.repository.getAll();
    }

    async close(year: number, month: number, closedBy: string): Promise<void> {
        const { endDate } = periodHelper.getStartAndEndDateForMonth(year, month);
        const today = new Date().toLocaleDateString('en-CA');
        if (endDate >= today) {
            throw new BadRequestException(`Periode baru bisa di-close setelah ${endDate} lewat`);
        }
        await this.repository.close(year, month, closedBy);
    }

    async reopen(year: number, month: number): Promise<void> {
        await this.repository.reopen(year, month);
    }

    private async closedKeys(): Promise<Set<string>> {
        const rows = await this.repository.getAll();
        return new Set(rows.map(row => `${row.year}-${row.month}`));
    }

    /** Periode yang sudah di-close dan beririsan dengan rentang tanggal (untuk job sync). */
    async closedPeriodsInRange(startDate: string, endDate: string): Promise<string[]> {
        const rows = await this.repository.getAll();
        return rows
            .filter(row => {
                const period = periodHelper.getStartAndEndDateForMonth(row.year, row.month);
                return period.startDate <= endDate && period.endDate >= startDate;
            })
            .map(row => `${row.year}-${String(row.month).padStart(2, '0')}`);
    }

    /** Tolak perubahan kalau salah satu tanggal (paid_date dll.) jatuh di periode yang sudah di-close. */
    async assertOpen(...dates: (Date | string | null | undefined)[]): Promise<void> {
        const closed = await this.closedKeys();
        for (const date of dates) {
            if (!date) continue;
            const value = date instanceof Date ? format(date, 'yyyy-MM-dd') : String(date);
            if (!/^\d{4}-\d{2}-\d{2}/.test(value)) continue;
            const { year, month } = periodOfDate(value);
            if (closed.has(`${year}-${month}`)) {
                throw new BadRequestException(`Periode ${String(month).padStart(2, '0')}-${year} sudah di-close. Buka dulu periodenya untuk mengubah data.`);
            }
        }
    }
}
