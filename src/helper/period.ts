import { format } from 'date-fns';

export class PeriodHelper {
    constructor() {}

    /**
     * Get the start and end date for the current month's period.
     * If today is > 25, it belongs to the next month's period.
     * 
     * @example
     * // Jika hari ini adalah "2026-06-04" (<= 25)
     * const period = helper.getStartAndEndDateForCurrentMonth();
     * // Hasil: { startDate: '2026-05-26', endDate: '2026-06-25' }
     * 
     * @example
     * // Jika hari ini adalah "2026-06-26" (> 25)
     * const period = helper.getStartAndEndDateForCurrentMonth();
     * // Hasil: { startDate: '2026-06-26', endDate: '2026-07-25' }
     * 
     * @returns {{ startDate: string, endDate: string }} The start and end dates formatted as YYYY-MM-DD
     */
    getStartAndEndDateForCurrentMonth(): { startDate: string; endDate: string } {
        const today = new Date();
        let targetMonth = today.getMonth();
        let targetYear = today.getFullYear();

        // Jika hari ini tanggal > 25, maka masuk periode bulan depan
        if (today.getDate() > 25) {
            targetMonth += 1;
            if (targetMonth > 11) {
                targetMonth = 0;
                targetYear += 1;
            }
        }
    
        const startMonth = targetMonth === 0 ? 11 : targetMonth - 1;
        const startYear = targetMonth === 0 ? targetYear - 1 : targetYear;
    
        const startDate = new Date(startYear, startMonth, 26);
        const endDate = new Date(targetYear, targetMonth, 25);

        // return {
        //     startDate: format(startDate, '2026-06-26'),
        //     endDate: format(endDate, '2026-07-25')
        // };

        return {
            startDate: format(startDate, 'yyyy-MM-dd'),
            endDate: format(endDate, 'yyyy-MM-dd')
        };
    }

    /**
     * Get the start and end date for the period before the current one.
     * 
     * @example
     * const period = helper.getStartAndEndDateForPreviousMonth();
     * // Hasil: { startDate: '2026-04-26', endDate: '2026-05-25' } (asumsi hari ini 2026-06-04)
     * 
     * @returns {{ startDate: string, endDate: string }} The start and end dates formatted as YYYY-MM-DD
     */
    getStartAndEndDateForPreviousMonth(date: Date = new Date()): { startDate: string; endDate: string } {
        const { year, month } = this.getPeriodByDate(date);
        return month === 1
            ? this.getStartAndEndDateForMonth(year - 1, 12)
            : this.getStartAndEndDateForMonth(year, month - 1);
    }

    /**
     * Get the start and end date for a specific month and year.
     * 
     * @example
     * const period = helper.getStartAndEndDateForMonth(2026, 6); // Bulan Juni 2026
     * // Hasil: { startDate: '2026-05-26', endDate: '2026-06-25' }
     * 
     * @param {number} year - The target year
     * @param {number} month - The target month (1 = January, 12 = December)
     * @returns {{ startDate: string, endDate: string }} The start and end dates formatted as YYYY-MM-DD
     */
    getStartAndEndDateForMonth(year: number, month: number): { startDate: string; endDate: string } {
        // month: 1 = January, 12 = December
        const startMonth = month === 1 ? 11 : month - 2;
        const startYear = month === 1 ? year - 1 : year;

        const startDate = new Date(startYear, startMonth, 26);
        const endDate = new Date(year, month - 1, 25);

        return {
            startDate: format(startDate, 'yyyy-MM-dd'),
            endDate: format(endDate, 'yyyy-MM-dd')
        };
    }

    /**
     * Get the period details (year, month, start date, end date) based on a given date.
     * 
     * @example
     * const date = new Date('2026-06-04');
     * const period = helper.getPeriodByDate(date);
     * // Hasil: { year: 2026, month: 6, startDate: '2026-05-26', endDate: '2026-06-25' }
     * 
     * @example
     * const date = new Date('2026-06-26');
     * const period = helper.getPeriodByDate(date);
     * // Hasil: { year: 2026, month: 7, startDate: '2026-06-26', endDate: '2026-07-25' }
     * 
     * @param {Date} date - The date to evaluate
     * @returns {{ year: number, month: number, startDate: string, endDate: string }} Period details
     */
    getPeriodByDate(date: Date): { year: number; month: number; startDate: string; endDate: string } {
        let monthIndex = date.getMonth();
        let year = date.getFullYear();

        if (date.getDate() > 25) {
            monthIndex += 1;
            if (monthIndex > 11) {
                monthIndex = 0;
                year += 1;
            }
        }
        
        const month = monthIndex + 1;
        const { startDate, endDate } = this.getStartAndEndDateForMonth(year, month);
        
        return {
            year,
            month,
            startDate,
            endDate
        };
    }

    /**
     * Get the periods that the invoice sync jobs should crawl.
     * Always includes the current period. From the 26th until the end of the month
     * (the first days of a new period), the previous period is included too, so
     * payments dated the 25th that land in NIS after the last run of that period are still synced.
     *
     * @example
     * // Jika hari ini adalah "2026-09-20" (<= 25)
     * const periods = helper.getPeriodsToSync();
     * // Hasil: [{ startDate: '2026-08-26', endDate: '2026-09-25' }]
     *
     * @example
     * // Jika hari ini adalah "2026-09-28" (> 25)
     * const periods = helper.getPeriodsToSync();
     * // Hasil: [{ startDate: '2026-08-26', endDate: '2026-09-25' }, { startDate: '2026-09-26', endDate: '2026-10-25' }]
     *
     * @param {Date} [date] - The date to evaluate, defaults to today
     * @returns {{ startDate: string, endDate: string }[]} Periods to sync, oldest first
     */
    getPeriodsToSync(date: Date = new Date()): { startDate: string; endDate: string }[] {
        const { year, month, startDate, endDate } = this.getPeriodByDate(date);
        const current = { startDate, endDate };

        if (date.getDate() <= 25) {
            return [current];
        }

        const previousMonth = month === 1 ? 12 : month - 1;
        const previousYear = month === 1 ? year - 1 : year;

        return [this.getStartAndEndDateForMonth(previousYear, previousMonth), current];
    }

    /**
     * Get period details from optional month and year query parameters.
     * If neither is provided, defaults to the period for today's date.
     * 
     * @example
     * // Dengan query parameters (misal: ?month=6&year=2026)
     * const period = helper.getPeriodFromQuery('6', '2026');
     * // Hasil: { year: 2026, month: 6, startDate: '2026-05-26', endDate: '2026-06-25' }
     * 
     * @example
     * // Tanpa query parameters (asumsi hari ini 2026-06-04)
     * const period = helper.getPeriodFromQuery(null, null);
     * // Hasil: { year: 2026, month: 6, startDate: '2026-05-26', endDate: '2026-06-25' }
     * 
     * @param {string | number | null} [monthQuery] - The month from the query
     * @param {string | number | null} [yearQuery] - The year from the query
     * @returns {{ year: number, month: number, startDate: string, endDate: string }} Period details
     */
    getPeriodFromQuery(monthQuery?: string | number | null, yearQuery?: string | number | null): { year: number; month: number; startDate: string; endDate: string } {
        const today = new Date();
        
        // If neither month nor year is provided, just get period by today's date
        if (!monthQuery && !yearQuery) {
            return this.getPeriodByDate(today);
        }
        
        const month = monthQuery ? Number(monthQuery) : today.getMonth() + 1;
        const year = yearQuery ? Number(yearQuery) : today.getFullYear();

        const { startDate, endDate } = this.getStartAndEndDateForMonth(year, month);

        return {
            year,
            month,
            startDate,
            endDate
        };
    }
}
