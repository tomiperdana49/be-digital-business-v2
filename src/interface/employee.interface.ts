import { Employee } from './nusawork.interface';

export interface ManagerMappingInput {
    employeeId: string;
    managerId: string;
    year: number;
    month: number;
}

export interface IEmployeeRepository {
    insertEmployee(data: Employee): Promise<any>;
    getManagerById(employeeId: string): Promise<any[]>;
    getStaff(managerId: string): Promise<any[]>;
    getStaffForPeriod(managerId: string, year: number, month: number): Promise<any[]>;
    upsertManagerMapping(employeeId: number, managerId: number, year: number, month: number): Promise<any>;
    getEmployeeByEmployeeId(employeeId: string): Promise<any | null>;
    getEmployeeById(id: string): Promise<any | null>;
    getEmployeeByEmail(email: string): Promise<any | null>;
    getAllDashboardEmployees(): Promise<any[]>;
    getAllEmployees(): Promise<any[]>;
    getHierarchy(employeeId: string): Promise<any[]>;
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
    getHierarchy(employeeId: string): Promise<any[]>;
}
