import { Context } from "hono";
import { PeriodHelper } from "../helper/period";
import { ApiResponse } from "../helper/response";

export class AdditionalController {
    constructor(private readonly periodHelper: PeriodHelper = new PeriodHelper()) {}

    async getPeriod(c: Context) {
        const { month: monthQuery, year: yearQuery } = c.req.query();
        // Default pilihan bulan di dashboard = bulan kalender berjalan, termasuk tanggal 26-31
        // (periode sebelumnya masih di-sync ulang sampai akhir bulan, jadi itu yang dicek orang).
        const today = new Date();
        const data = (!monthQuery && !yearQuery)
            ? this.periodHelper.getPeriodFromQuery(today.getMonth() + 1, today.getFullYear())
            : this.periodHelper.getPeriodFromQuery(monthQuery, yearQuery);
        return ApiResponse.success(c, data, "Period retrieved successfully");
    }
}
