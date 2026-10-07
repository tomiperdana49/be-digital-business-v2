import { Employee } from './nusawork.interface';

export interface ManagerMappingInput {
    employeeId: string;
    managerId: string;
    year: number;
    month: number;
}

export interface IEmployeeRepository {
    insertEmployee(data: Employee): Promise<any>;
    deactivateEmployeesNotIn(activeIds: Array<number | string>): Promise<number>;
    setDeactivatedAt(id: number | string, date: string): Promise<number>;
    getManagerById(employeeId: string): Promise<any[]>;
    getStaff(managerId: string): Promise<any[]>;
    getStaffForPeriod(managerId: string, year: number, month: number): Promise<any[]>;
    upsertManagerMapping(employeeId: number, managerId: number, year: number, month: number): Promise<any>;
    getEmployeeByEmployeeId(employeeId: string): Promise<any | null>;
    getEmployeeById(id: string): Promise<any | null>;
    getEmployeeByEmail(email: string): Promise<any | null>;
    getAllDashboardEmployees(activeFrom?: string): Promise<any[]>;
    getAllEmployees(): Promise<any[]>;
    getActiveEmployees(): Promise<any[]>;
    getHierarchy(employeeId: string, activeFrom?: string): Promise<any[]>;
}

export interface IEmployeeService {
    insertEmployee(data: Employee): Promise<any>;
    getManagerById(employeeId: string): Promise<any[]>;
    getStaff(managerId: string): Promise<any[]>;
    getStaffForPeriod(managerId: string, year: number, month: number): Promise<any[]>;
    setManagerMapping(mappings: ManagerMappingInput[]): Promise<void>;
    getEmployeeByEmployeeId(employeeId: string): Promise<any | null>;
    getEmployeeById(id: string): Promise<any | null>;
    getEmployeeByEmail(email: string): Promise<any | null>;
    getAllEmployees(): Promise<any[]>;
    getActiveEmployees(): Promise<any[]>;
    getHierarchy(employeeId: string, activeFrom?: string): Promise<any[]>;
}
