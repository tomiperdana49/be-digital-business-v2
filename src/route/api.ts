import { Hono } from 'hono';
import { AuthController } from '../controller/auth.controller';
import { EmployeeController } from '../controller/employee.controller';
import { InvoiceController } from '../controller/invoice.controller';
import { CommissionController } from '../controller/commission.controller';
import { AdditionalController } from '../controller/additional.controller';
import { TargetController } from '../controller/target.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import { SnapshotRepository } from '../repository/snapshot.repository';
import { SnapshotService } from '../service/snapshot.service';
import { EmployeeRepository } from '../repository/employee.repository';
import { EmployeeService } from '../service/employee.service';
import { AuthService } from '../service/auth.service';
import { NisRepository } from '../repository/nis.repository';
import { NisService } from '../service/nis.service';
import { TargetRepository } from '../repository/target.repository';
import { RewardService } from '../service/reward.service';
import { dashboardPool, nisPool } from '../config/database';
import { config } from '../config/app';

const api = new Hono();

// Initialize Repositories
const snapshotRepository = new SnapshotRepository(dashboardPool);
const employeeRepository = new EmployeeRepository(dashboardPool);
const nisRepository = new NisRepository(nisPool);
const targetRepository = new TargetRepository(dashboardPool);

// Initialize Services
const nisService = new NisService(nisRepository);
const snapshotService = new SnapshotService(snapshotRepository, nisService);
const employeeService = new EmployeeService(employeeRepository);
const authService = new AuthService(employeeService);
const rewardService = new RewardService(targetRepository, snapshotService, employeeService);

// Initialize Controllers
const authController = new AuthController(authService);
const employeeController = new EmployeeController(employeeService);
const invoiceController = new InvoiceController(snapshotService);
const commissionController = new CommissionController(snapshotService, employeeService, rewardService);
const additionalController = new AdditionalController();
const targetController = new TargetController(targetRepository, employeeService);

// Public Auth Routes
api.post('/auth/login', (c) => authController.login(c));
// Login tanpa password hanya untuk development; di production route ini tidak ada (404)
if (config.app.env !== 'production') {
    api.post('/auth/dev', (c) => authController.devLogin(c));
}
api.post('/auth/google', (c) => authController.google(c));
api.post('/auth/refresh', (c) => authController.refresh(c));

// Protected Auth Routes
api.get('/auth/me', authMiddleware, (c) => authController.me(c));
api.post('/auth/logout', authMiddleware, (c) => authController.logout(c));

// Protected Employee Routes
api.get('/employee/:id', authMiddleware, (c) => employeeController.getEmployeeByEmployeeId(c));
api.get('/employee/:id/hierarchy', authMiddleware, (c) => employeeController.getEmployeeHierarchy(c));
api.post('/employee/manager-mapping', authMiddleware, (c) => employeeController.setManagerMapping(c));

// Protected Invoice Routes
api.get('/invoice/snapshot', authMiddleware, adminMiddleware, (c) => invoiceController.snapshotList(c));
api.patch('/invoice/snapshot/:ai', authMiddleware, adminMiddleware, (c) => invoiceController.updateSnapshot(c));
api.get('/invoice/account-manager', (c) => invoiceController.accountManagers(c));
api.get('/invoice/:id/internal', (c) => invoiceController.internalInvoice(c));
api.get('/invoice/:id/implementator', (c) => invoiceController.implementatorInvoice(c));
api.get('/invoice/:id/implementator/churn', (c) => invoiceController.implementatorChurn(c));
api.get('/invoice/:id/resell', (c) => invoiceController.resellInvoice(c));

// Protected Commission Routes
api.get('/commission/:id/implementator', (c) => commissionController.implementatorCommission(c));
api.get('/commission/:id/implementator/yearly', (c) => commissionController.implementatorCommissionYearly(c));
api.get('/commission/:id/sales', (c) => commissionController.salesCommission(c));
api.get('/commission/:id/sales/yearly', (c) => commissionController.salesCommissionYearly(c));
api.get('/commission/:id/manager', (c) => commissionController.managerCommission(c));
api.get('/commission/:id/manager/yearly', (c) => commissionController.managerCommissionYearly(c));

// Protected Team Routes
api.get('/team/:id/manager', (c) => commissionController.managerTeam(c));
api.get('/team/:id/manager/yearly', (c) => commissionController.managerTeamYearly(c));

// Admin Target Routes (target New MRC per branch & organisasi untuk reward kuartal)
api.get('/target', authMiddleware, adminMiddleware, (c) => targetController.list(c));
api.put('/target', authMiddleware, adminMiddleware, (c) => targetController.upsert(c));
api.delete('/target/:id', authMiddleware, adminMiddleware, (c) => targetController.delete(c));

// Additional Routes
api.get('/additional/period', (c) => additionalController.getPeriod(c));
export { api };

