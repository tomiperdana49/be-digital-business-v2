import { Context, Next } from "hono";
import { IEmployeeService } from "../interface/employee.interface";
import { UnauthorizedException, ForbiddenException } from "../helper/exception";

/**
 * Akses data karyawan `:id`: admin, karyawan itu sendiri, atasannya menurut hierarki saat ini,
 * atau yang pernah menjadi atasannya di mapping periode (supaya periode lama tetap bisa dibuka).
 * Dipasang setelah authMiddleware.
 */
export const hierarchyMiddleware = (employeeService: IEmployeeService) => async (c: Context, next: Next) => {
    const user = c.get('user');
    const targetEmployeeId = c.req.param('id');

    if (!user || !user.sub) {
        throw new UnauthorizedException('Unauthorized: User identity missing');
    }

    if (user.is_admin === true || user.sub === targetEmployeeId) {
        await next();
        return;
    }

    const hierarchy = await employeeService.getHierarchy(user.sub);
    const isAuthorized = hierarchy.some((emp: any) => emp.employee_id === targetEmployeeId)
        || await employeeService.hasManagedInAnyPeriod(user.sub, targetEmployeeId!);

    if (!isAuthorized) {
        throw new ForbiddenException('Forbidden: You do not have access to this resource');
    }

    await next();
};
