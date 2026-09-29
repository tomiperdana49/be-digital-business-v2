export interface BranchTarget {
    id: number;
    branch_id: string;
    organization_name: string;
    year: number;
    month: number;
    target_new_mrc: number;
}

export interface BranchTargetInput {
    branchId: string;
    organizationName: string;
    year: number;
    month: number;
    targetNewMrc: number;
}

export interface ITargetRepository {
    getAll(): Promise<BranchTarget[]>;
    upsert(data: BranchTargetInput): Promise<any>;
    delete(id: number): Promise<any>;
}
