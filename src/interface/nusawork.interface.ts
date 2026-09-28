export interface Employee {
    userId: number | string;
    employeeId: string;
    name: string;
    email: string;
    photoProfile: string | null;
    jobPosition: string;
    organizationName: string;
    jobLevel: string;
    branchId: string | null;
    branch: string;
    managerId: number | string | null;
    hasDashboard?: boolean;
    isAdmin?: boolean;
}

export interface INusaworkService {
    getEmployees(): Promise<any[]>;
    getSalesDigital(): Promise<Employee[]>;
    getImplementator(): Promise<Employee[]>;
    getEmployeeAdmin(): Promise<Employee[]>;
}
