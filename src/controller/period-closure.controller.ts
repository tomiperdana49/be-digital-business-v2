import { Context } from "hono";
import { ApiResponse } from "../helper/response";
import { BadRequestException, ForbiddenException } from "../helper/exception";
import { PeriodClosureService } from "../service/period-closure.service";
import { config } from "../config/app";

const canClose = (user: any): boolean =>
    config.period.closerEmails.includes(String(user?.email ?? '').toLowerCase());

const parsePeriod = (yearValue: unknown, monthValue: unknown) => {
    const year = Number(yearValue);
    const month = Number(monthValue);
    if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
        throw new BadRequestException('Valid year and month (1-12) are required');
    }
    return { year, month };
};

export class PeriodClosureController {
    constructor(private readonly periodClosureService: PeriodClosureService) {}

    async list(c: Context) {
        const closures = await this.periodClosureService.list();
        return ApiResponse.success(c, { closures, canClose: canClose(c.get('user')) }, "Period closures retrieved successfully");
    }

    async close(c: Context) {
        const user = c.get('user');
        if (!canClose(user)) throw new ForbiddenException('Hanya user tertentu yang bisa close periode');
        const body = await c.req.json();
        const { year, month } = parsePeriod(body.year, body.month);
        await this.periodClosureService.close(year, month, String(user.email));
        return ApiResponse.success(c, null, "Period closed successfully");
    }

    async reopen(c: Context) {
        const user = c.get('user');
        if (!canClose(user)) throw new ForbiddenException('Hanya user tertentu yang bisa membuka periode');
        const { year, month } = parsePeriod(c.req.param('year'), c.req.param('month'));
        await this.periodClosureService.reopen(year, month);
        return ApiResponse.success(c, null, "Period reopened successfully");
    }
}
