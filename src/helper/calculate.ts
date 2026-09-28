export type SnapshotStatus = 'new' | 'upgrade' | 'termin' | 'recurring' | 'prorate' | 'add' | 'setup';
export type SnapshotType = 'internal' | 'resell';

/**
 * Tanggal mulai berlakunya aturan komisi baru (periode Agustus 2026, cut-off 26-25).
 * Baris dengan periode SEBELUM tanggal ini tetap pakai aturan lama supaya histori tidak berubah.
 */
export const NEW_RULE_CUTOFF_DATE = '2026-07-26';

export class Calculate {
    /**
     * Apakah startDate suatu periode sudah masuk aturan baru (>= 26 Juli 2026).
     */
    static isNewRulePeriod(startDate: string): boolean {
        return startDate >= NEW_RULE_CUTOFF_DATE;
    }

    /**
     * MRC = subscription / monthPeriod
     * - upgrade / add dengan periode < 1 bulan: MRC = subscription (DPP) penuh, tidak dibagi
     *   (kalau dibagi, periode pecahan justru membuat MRC lebih besar dari DPP-nya).
     */
    static mrc(subscription: number, monthPeriod: number, status?: SnapshotStatus): number {
        if ((status === 'upgrade' || status === 'add') && monthPeriod < 1) return subscription;
        return subscription / (monthPeriod || 1);
    }

    /**
     * MRC khusus untuk resell status 'upgrade'.
     * - monthPeriod dipotong (truncate, BUKAN dibulatkan) ke 2 angka desimal dulu
     *   (mis. 6.939993 → 6.93), supaya konsisten dengan angka periode yang ditampilkan
     *   di tempat lain pada aplikasi (kolom Month Period juga pakai trunc, bukan round).
     * - periode < 1 bulan: MRC = subscription penuh (tidak dibagi)
     * - periode >= 1 bulan: MRC = subscription / periode (2 desimal), hasil akhir dipotong
     *   ke 2 desimal juga (bukan dibulatkan, bukan ke bilangan bulat).
     * Contoh: subscription 1.632.800, periode 6.93 → 1.632.800 / 6.93 = 235.613,27.
     */
    static resellUpgradeMrc(subscription: number, monthPeriod: number): number {
        const period = Math.trunc(monthPeriod * 100) / 100;
        if (period < 1) return subscription;
        const mrc = subscription / period;
        return Math.trunc(mrc * 100) / 100;
    }

    /**
     * Konversi monthPeriod desimal ke format human-readable
     * Contoh: 7.322581 → "7 Months 10 Days", 14.0 → "1 Year 2 Months", 22.1 → "1 Year 10 Months 3 Days"
     */
    static monthPeriodSummary(monthPeriod: number): string {
        const totalMonths = Math.trunc(monthPeriod);
        const days = Math.round((monthPeriod - totalMonths) * 30);

        const years = Math.trunc(totalMonths / 12);
        const months = totalMonths % 12;

        const parts: string[] = [];
        if (years > 0) parts.push(`${years} ${years === 1 ? 'Year' : 'Years'}`);
        if (months > 0) parts.push(`${months} ${months === 1 ? 'Month' : 'Months'}`);
        if (days > 0) parts.push(`${days} ${days === 1 ? 'Day' : 'Days'}`);

        return parts.length > 0 ? parts.join(' ') : '0 Days';
    }

    /**
     * Komisi sales internal.
     * - upgrade/prorate: 20%
     * - new/termin + crossSell > 0: 15%, tanpa crossSell: 12%
     * - recurring: 1%
     * - Special: new > 12 bulan → 12 bulan pertama full, sisanya 1%
     */
    static internalSalesCommission(
        status: SnapshotStatus,
        dpp: number,
        crossSellCount: number,
        months: number
    ): { commissionAmount: number; commissionPercentage: number } {
        let commissionPercentage = 0;
        let commissionAmount = 0;

        if (status === 'upgrade' || status === 'prorate' || status === 'add') {
            commissionPercentage = 20;
        } else if (status === 'new' || status === 'termin') {
            commissionPercentage = crossSellCount > 0 ? 15 : 12;
        } else if (status === 'recurring') {
            commissionPercentage = 1;
        } else if (status === 'setup') {
            commissionPercentage = 0;
        } else {
            commissionPercentage = 1;
        }

        if (status === 'new' && months > 12) {
            const first12MonthsAmount = dpp * (12 / months);
            const remainingAmount = dpp - first12MonthsAmount;
            commissionAmount = (first12MonthsAmount * (commissionPercentage / 100)) + (remainingAmount * 0.01);
        } else {
            commissionAmount = dpp * (commissionPercentage / 100);
        }

        return { commissionAmount, commissionPercentage };
    }

    /**
     * Komisi sales resell + hitung margin sekaligus.
     * - price = subscription / totalAccount (null jika recurring)
     * - markup = price - modal (null jika recurring, 0 jika modal = 0)
     * - margin: (markup/price)*100, default 2.5% jika modal = 0
     * - Komisi: recurring 0.5%, margin >= 15% → 5%, >= 10% → 4%, < 10% → 2.5%
     * - commissionBase (opsional): kalau diisi (base_commission manual dari edit /invoice),
     *   nominal komisi dihitung dari nilai ini, BUKAN subscription. Price/markup/margin/tier
     *   rate tetap dari subscription asli (tidak terpengaruh).
     */
    static resellSalesCommission(
        status: SnapshotStatus,
        subscription: number,
        totalAccount: number,
        modal: number,
        commissionBase?: number
    ): { commissionAmount: number; commissionPercentage: number; price: number | null; markup: number | null; margin: number | null } {
        const base = commissionBase ?? subscription;
        const isNewUpgradeProrate = ['new', 'prorate', 'upgrade'].includes(status);

        let price: number | null = null;
        let markup: number | null = null;
        let margin: number | null = null;

        if (isNewUpgradeProrate) {
            const account = totalAccount || 1;
            price = subscription / account;

            if (modal === 0) {
                markup = 0;
                margin = 2.5;
            } else {
                markup = price - modal;
                margin = price > 0 ? (markup / modal) * 100 : 0;
            }
        }

        let commissionPercentage = 0;

        if (status === 'setup') {
            commissionPercentage = 0;
        } else if (status === 'recurring') {
            commissionPercentage = 0.5;
        } else if (isNewUpgradeProrate || status === 'termin') {
            if ((margin ?? 0) >= 15) {
                commissionPercentage = 5;
            } else if ((margin ?? 0) >= 10) {
                commissionPercentage = 4;
            } else {
                commissionPercentage = 2.5;
            }
        } else {
            // termasuk status 'add' -> flat 2.5%
            commissionPercentage = 2.5;
        }

        return {
            commissionAmount: base * (commissionPercentage / 100),
            commissionPercentage,
            price,
            markup,
            margin
        };
    }

    /**
     * Komisi implementator dengan prorata dan churn count.
     * - Prorata: dpp / monthPeriod (untuk new/upgrade/prorate/termin)
     * - recurring: 1%, churn > 0: 17.5% (base), tanpa churn: 20% (retention)
     */
    static implementatorCommission(
        status: SnapshotStatus,
        dpp: number,
        churnCount: number,
        monthPeriod: number
    ): { implementatorCommission: number; implementatorCommissionPercentage: number; type: 'base' | 'retention' | 'recurring' | 'setup' } {
        let proratedDpp = dpp;

        if (status === 'new' || status === 'upgrade' || status === 'prorate' || status === 'termin' || status === 'add') {
            proratedDpp = dpp / (monthPeriod || 1);
        }

        let percentage = 0;
        let type: 'base' | 'retention' | 'recurring' | 'setup' = 'retention';

        if (status === 'setup') {
            // Setup: fee satu kali, flat 50% dari dpp (tidak diprorata).
            percentage = 50;
            type = 'setup';
        } else if (status === 'recurring') {
            percentage = 1;
            type = 'recurring';
        } else if (churnCount > 0) {
            percentage = 17.5;
            type = 'base';
        } else {
            percentage = 20;
            type = 'retention';
        }

        return {
            implementatorCommission: proratedDpp * (percentage / 100),
            implementatorCommissionPercentage: percentage,
            type
        };
    }

    /**
     * Hitung trend: perbandingan value bulan ini vs bulan lalu.
     * - trend: 'up' | 'down'
     * - percentage: growth percentage
     * - growth: selisih value
     */
    static trend(current: number, previous: number): { trend: string; value: number; percentage: number; growth: number } {
        const growth = current - previous;
        const percentage = previous !== 0 ? (growth / previous) * 100 : (current > 0 ? 100 : 0);
        const trend = growth >= 0 ? 'up' : 'down';

        return { trend, value: current, percentage: Math.round(percentage * 10) / 10, growth };
    }
}
