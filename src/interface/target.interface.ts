export interface BranchTarget {
    id: number;
    branch_id: string;
    year: number;
    month: number;
    target_new_mrc: number;
}

export interface BranchTargetInput {
    branchId: string;
    year: number;
    month: number;
    targetNewMrc: number;
}

export interface ITargetRepository {
    getAll(): Promise<BranchTarget[]>;
    upsert(data: BranchTargetInput): Promise<any>;
    delete(id: number): Promise<any>;
}
