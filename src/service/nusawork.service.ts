import axios, { AxiosInstance } from 'axios';
import { config } from '../config/app';
import { Employee, INusaworkService } from '../interface/nusawork.interface';

export class NusaworkService implements INusaworkService {
    private readonly http: AxiosInstance;

    constructor() {
        this.http = axios.create({
            baseURL: config.nusawork.apiUrl,
            headers: {
                Accept: 'application/json',
            },
        });
    }

    /**
     * Ambil access token dari Nusawork menggunakan client credentials.
     */
    private async getToken(): Promise<string> {
        const res = await this.http.post('/auth/api/oauth/token', {
            grant_type: 'client_credentials',
            client_id: config.nusawork.clientId,
            client_secret: config.nusawork.clientSecret,
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        return res.data.access_token as string;
    }

    /**
     * Ambil list karyawan aktif dari Nusawork.
     */
    async getEmployees(): Promise<any[]> {
        const token = await this.getToken();

        const res = await this.http.post('/emp/api/v4.2/client/employee/filter', {
            fields: { active_status: ['active'] },
            is_paginate: false,
            multi_value: false,
            currentPage: 1,
        }, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
        
        return (res?.data?.data as any[]) ?? [];
    }

    /**
     * Ambil daftar account manager digital business dari Nusawork.
     */
    async getSalesDigital(): Promise<Employee[]> {
        const employees = await this.getEmployees();

        const accountManager = employees.filter((emp: any) =>
            emp.organization_name === 'Sales Nusawork' ||
            emp.organization_name === 'Sales GWS' ||
            emp.organization_name === 'job_position'
        );

        return accountManager.map((emp: any) => ({
            userId: emp.user_id,
            employeeId: emp.employee_id,
            name: emp.full_name,
            email: emp.email,
            photoProfile: emp.photo_profile,
            jobPosition: emp.job_position,
            organizationName: emp.organization_name,
            jobLevel: emp.job_level,
            branchId: emp.branch_id ?? null,
            branch: emp.branch_name,
            managerId: emp.id_report_to_value,
        }));
    }

    /**
     * Ambil daftar Implementator Nusawork dari Nusawork.
     */
    async getImplementator(): Promise<Employee[]> {
        const employees = await this.getEmployees();

        const accountManager = employees.filter((emp: any) =>
            emp.job_position === 'Nusawork Product Manager'
            || emp.job_position === 'Implementator Nusawork'
        );

        return accountManager.map((emp: any) => ({
            userId: emp.user_id,
            employeeId: emp.employee_id,
            name: emp.full_name,
            email: emp.email,
            photoProfile: emp.photo_profile,
            jobPosition: emp.job_position,
            organizationName: emp.organization_name,
            jobLevel: emp.job_level,
            branchId: emp.branch_id ?? null,
            branch: emp.branch_name,
            managerId: emp.id_report_to_value,
            hasDashboard: emp.job_position !== 'Nusawork Product Manager',
        }));
    }

    /**
     * Ambil daftar employee admin dari Nusawork.
     */
    async getEmployeeAdmin(): Promise<Employee[]> {
        const employees = await this.getEmployees();

        const accountManager = employees.filter((emp: any) =>
            emp.employee_id === '0202589' ||
            emp.employee_id === '0201325' ||
            emp.employee_id === '0202314' ||
            emp.employee_id === '0201507' ||
            emp.organization_name === 'Finance' ||
            emp.organization_name === 'BIS' ||
            emp.job_level === 'VP' ||
            emp.job_level === 'Direksi'
        );

        return accountManager.map((emp: any) => ({
            userId: emp.user_id,
            employeeId: emp.employee_id,
            name: emp.full_name,
            email: emp.email,
            photoProfile: emp.photo_profile,
            jobPosition: emp.job_position,
            organizationName: emp.organization_name,
            jobLevel: emp.job_level,
            branchId: emp.branch_id ?? null,
            branch: emp.branch_name,
            managerId: null,
            isAdmin: true,
        }));
    }
}