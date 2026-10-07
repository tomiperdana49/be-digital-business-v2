export interface INisRepository {
    getInternalByDateRange(startDate: string, endDate: string): Promise<any[]>;
    getResellByDateRange(startDate: string, endDate: string): Promise<any[]>;
    getChurnCountByImplementator(implementatorId: string, startDate: string, endDate: string): Promise<number>;
    getChurnListByImplementator(implementatorId: string, startDate: string, endDate: string): Promise<any[]>;
    getSurveyorByCustomerIds(customerIds: string[]): Promise<any[]>;
}

export interface INisService {
    getInternalByDateRange(startDate: string, endDate: string): Promise<any[]>;
    getResellByDateRange(startDate: string, endDate: string): Promise<any[]>;
    getChurnCountByImplementator(implementatorId: string, startDate: string, endDate: string): Promise<number>;
    getChurnListByImplementator(implementatorId: string, startDate: string, endDate: string): Promise<any[]>;
    getSurveyorByCustomerIds(customerIds: string[]): Promise<any[]>;
}
