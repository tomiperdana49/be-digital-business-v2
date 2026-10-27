export interface INisRepository {
    getInternalByDateRange(startDate: string, endDate: string): Promise<any[]>;
    getResellByDateRange(startDate: string, endDate: string): Promise<any[]>;
    getChurnCountByImplementator(implementatorId: string, startDate: string, endDate: string): Promise<number>;
    getChurnListByImplementator(implementatorId: string, startDate: string, endDate: string): Promise<any[]>;
    getSurveyorByCustomerIds(customerIds: string[]): Promise<any[]>;
    getChurnMrcBySales(salesIds: string[], startDate: string, endDate: string): Promise<number>;
    getChurnListBySales(salesIds: string[], startDate: string, endDate: string): Promise<any[]>;
    getActiveMrcBySales(salesIds: string[], date: string): Promise<any[]>;
    getInvoiceDatesByAi(ais: number[]): Promise<any[]>;
    getResellOwnersByCustomerIds(customerIds: string[]): Promise<any[]>;
}

export interface INisService {
    getInternalByDateRange(startDate: string, endDate: string): Promise<any[]>;
    getResellByDateRange(startDate: string, endDate: string): Promise<any[]>;
    getChurnCountByImplementator(implementatorId: string, startDate: string, endDate: string): Promise<number>;
    getChurnListByImplementator(implementatorId: string, startDate: string, endDate: string): Promise<any[]>;
    getSurveyorByCustomerIds(customerIds: string[]): Promise<any[]>;
    getChurnMrcBySales(salesIds: string[], startDate: string, endDate: string): Promise<number>;
    getChurnListBySales(salesIds: string[], startDate: string, endDate: string): Promise<any[]>;
    getActiveMrcBySales(salesIds: string[], date: string): Promise<any[]>;
    getInvoiceDatesByAi(ais: number[]): Promise<any[]>;
    getResellOwnersByCustomerIds(customerIds: string[]): Promise<any[]>;
}
