export interface BranchTarget {
    id: number;
    branch_id: string;
    organization_name: string;
    employee_id: string;
    year: number;
    month: number;
    end_year: number | null;
    end_month: number | null;
    target_new_mrc: number;
}

export interface BranchTargetInput {
    branchId: string;
    organizationName: string;
    employeeId: string;
    year: number;
    month: number;
    endYear: number | null;
    endMonth: number | null;
    targetNewMrc: number;
}

export interface ITargetRepository {
    getAll(): Promise<BranchTarget[]>;
    upsert(data: BranchTargetInput): Promise<any>;
    delete(id: number): Promise<any>;
}
