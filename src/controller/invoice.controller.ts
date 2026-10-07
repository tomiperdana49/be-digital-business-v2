import { Context } from "hono";
import { ISnapshotService } from "../interface/snapshot.interface";
import { ApiResponse } from "../helper/response";
import { PeriodHelper } from "../helper/period";
import { BadRequestException } from "../helper/exception";

const VALID_SNAPSHOT_STATUSES = ['new', 'upgrade', 'termin', 'recurring', 'prorate', 'add', 'setup'];
const VALID_SERVICE_TYPES = ['internal', 'resell'];

export class InvoiceController {
    constructor(
        private readonly snapshotService: ISnapshotService,
        private readonly periodHelper: PeriodHelper = new PeriodHelper(),
    ) {}

    async accountManagers(c: Context) {
        const data = await this.snapshotService.getAccountManagers();
        return ApiResponse.success(c, data, "Account managers retrieved successfully");
    }

    async snapshotList(c: Context) {
        const { search, status, type, salesId, month: monthQuery, year: yearQuery, page, limit } = c.req.query();

        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.min(100, Math.max(1, Number(limit) || 10));
        const serviceType = type === 'internal' || type === 'resell' ? type : undefined;

        const { startDate, endDate } = this.periodHelper.getPeriodFromQuery(monthQuery, yearQuery);

        const data = await this.snapshotService.getSnapshotList({
            search: search || undefined,
            status: status || undefined,
            serviceType,
            salesId: salesId || undefined,
            startDate,
            endDate,
            page: pageNum,
            limit: limitNum
        });

        return ApiResponse.success(c, data, "Snapshot list retrieved successfully");
    }

    async internalInvoice(c: Context) {
        const { month: monthQuery, year: yearQuery } = c.req.query();
        const employeeId = c.req.param('id');

        if (!employeeId) {
            return ApiResponse.error(c, "id is required", 400);
        }

        const { startDate, endDate } = this.periodHelper.getPeriodFromQuery(monthQuery, yearQuery);
        const data = await this.snapshotService.getInternalInvoiceDetail(employeeId, startDate, endDate);
        return ApiResponse.success(c, data, "Internal invoice retrieved successfully");
    }

    async implementatorInvoice(c: Context) {
        const { month: monthQuery, year: yearQuery } = c.req.query();
        const id = c.req.param('id');

        if (!id) {
            return ApiResponse.error(c, "id is required", 400);
        }

        const { startDate, endDate } = this.periodHelper.getPeriodFromQuery(monthQuery, yearQuery);
        const data = await this.snapshotService.getImplementatorInvoiceDetail(id, startDate, endDate);
        return ApiResponse.success(c, data, "Implementator invoice retrieved successfully");
    }

    async resellInvoice(c: Context) {
        const { month: monthQuery, year: yearQuery } = c.req.query();
        const employeeId = c.req.param('id');

        if (!employeeId) {
            return ApiResponse.error(c, "id is required", 400);
        }

        const { startDate, endDate } = this.periodHelper.getPeriodFromQuery(monthQuery, yearQuery);
        const data = await this.snapshotService.getResellInvoiceDetail(employeeId, startDate, endDate);
        return ApiResponse.success(c, data, "Resell invoice retrieved successfully");
    }

    async updateSnapshot(c: Context) {
        const ai = Number(c.req.param('ai'));

        if (!ai || Number.isNaN(ai)) {
            throw new BadRequestException('Valid ai is required');
        }

        const body = await c.req.json();

        if (body.status !== undefined && !VALID_SNAPSHOT_STATUSES.includes(body.status)) {
            throw new BadRequestException(`Invalid status. Must be one of: ${VALID_SNAPSHOT_STATUSES.join(', ')}`);
        }

        if (body.service_type !== undefined && !VALID_SERVICE_TYPES.includes(body.service_type)) {
            throw new BadRequestException(`Invalid service_type. Must be one of: ${VALID_SERVICE_TYPES.join(', ')}`);
        }

        if (body.implementator_period_date === '') body.implementator_period_date = null;
        if (body.implementator_period_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.implementator_period_date))) {
            throw new BadRequestException('Invalid implementator_period_date. Must be YYYY-MM-DD or null');
        }

        const result = await this.snapshotService.updateSnapshot(ai, body);

        if (!result) {
            throw new BadRequestException('No editable fields provided');
        }

        return ApiResponse.success(c, result, "Snapshot updated successfully");
    }

    async implementatorChurn(c: Context) {
        const { month: monthQuery, year: yearQuery } = c.req.query();
        const id = c.req.param('id');

        if (!id) {
            return ApiResponse.error(c, "id is required", 400);
        }

        const { startDate, endDate } = this.periodHelper.getPeriodFromQuery(monthQuery, yearQuery);
        const data = await this.snapshotService.getImplementatorChurnList(id, startDate, endDate);
        return ApiResponse.success(c, data, "Implementator churn list retrieved successfully");
    }

}