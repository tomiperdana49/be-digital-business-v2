import { Hono } from 'hono';
import { AuthController } from '../controller/auth.controller';
import { EmployeeController } from '../controller/employee.controller';
import { InvoiceController } from '../controller/invoice.controller';
import { CommissionController } from '../controller/commission.controller';
import { AdditionalController } from '../controller/additional.controller';
import { TargetController } from '../controller/target.controller';
import { FeedbackController } from '../controller/feedback.controller';
import { TvController } from '../controller/tv.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import { apiKeyMiddleware } from '../middleware/api-key.middleware';
import { hierarchyMiddleware } from '../middleware/hierarchy.middleware';
import { SnapshotRepository } from '../repository/snapshot.repository';
import { SnapshotService } from '../service/snapshot.service';
import { EmployeeRepository } from '../repository/employee.repository';
import { EmployeeService } from '../service/employee.service';
import { AuthService } from '../service/auth.service';
import { NisRepository } from '../repository/nis.repository';
import { NisService } from '../service/nis.service';
import { TargetRepository } from '../repository/target.repository';
import { FeedbackRepository } from '../repository/feedback.repository';
import { RewardService } from '../service/reward.service';
import { dashboardPool, nisPool } from '../config/database';
import { config } from '../config/app';

const api = new Hono();

// Initialize Repositories
const snapshotRepository = new SnapshotRepository(dashboardPool);
const employeeRepository = new EmployeeRepository(dashboardPool);
const nisRepository = new NisRepository(nisPool);
const targetRepository = new TargetRepository(dashboardPool);
const feedbackRepository = new FeedbackRepository();

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
const feedbackController = new FeedbackController(feedbackRepository, employeeService);
const tvController = new TvController(snapshotService, employeeService, rewardService);

// Akses data karyawan :id: admin, diri sendiri, atau atasannya
const employeeAccess = hierarchyMiddleware(employeeService);

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
api.get('/employee/:id', authMiddleware, employeeAccess, (c) => employeeController.getEmployeeByEmployeeId(c));
api.get('/employee/:id/hierarchy', authMiddleware, employeeAccess, (c) => employeeController.getEmployeeHierarchy(c));
api.post('/employee/manager-mapping', authMiddleware, adminMiddleware, (c) => employeeController.setManagerMapping(c));

// Protected Invoice Routes
api.get('/invoice/snapshot', authMiddleware, adminMiddleware, (c) => invoiceController.snapshotList(c));
api.patch('/invoice/snapshot/:ai', authMiddleware, adminMiddleware, (c) => invoiceController.updateSnapshot(c));
api.get('/invoice/account-manager', authMiddleware, adminMiddleware, (c) => invoiceController.accountManagers(c));
api.get('/invoice/:id/internal', authMiddleware, employeeAccess, (c) => invoiceController.internalInvoice(c));
api.get('/invoice/:id/implementator', authMiddleware, employeeAccess, (c) => invoiceController.implementatorInvoice(c));
api.get('/invoice/:id/implementator/churn', authMiddleware, employeeAccess, (c) => invoiceController.implementatorChurn(c));
api.get('/invoice/:id/resell', authMiddleware, employeeAccess, (c) => invoiceController.resellInvoice(c));
api.get('/invoice/:id/sales/churn', authMiddleware, employeeAccess, (c) => invoiceController.salesChurn(c));

// Protected Commission Routes
api.get('/commission/:id/implementator', authMiddleware, employeeAccess, (c) => commissionController.implementatorCommission(c));
api.get('/commission/:id/implementator/yearly', authMiddleware, employeeAccess, (c) => commissionController.implementatorCommissionYearly(c));
api.get('/commission/:id/sales', authMiddleware, employeeAccess, (c) => commissionController.salesCommission(c));
api.get('/commission/:id/sales/yearly', authMiddleware, employeeAccess, (c) => commissionController.salesCommissionYearly(c));
api.get('/commission/:id/manager', authMiddleware, employeeAccess, (c) => commissionController.managerCommission(c));
api.get('/commission/:id/manager/yearly', authMiddleware, employeeAccess, (c) => commissionController.managerCommissionYearly(c));

// Protected Team Routes
api.get('/team/:id/manager', authMiddleware, employeeAccess, (c) => commissionController.managerTeam(c));
api.get('/team/:id/manager/yearly', authMiddleware, employeeAccess, (c) => commissionController.managerTeamYearly(c));
api.get('/team/:id/manager/churn', authMiddleware, employeeAccess, (c) => commissionController.managerTeamChurn(c));

// Admin Target Routes (target New MRC per branch & organisasi untuk reward kuartal)
api.get('/target', authMiddleware, adminMiddleware, (c) => targetController.list(c));
api.put('/target', authMiddleware, adminMiddleware, (c) => targetController.upsert(c));
api.delete('/target/:id', authMiddleware, adminMiddleware, (c) => targetController.delete(c));
// Feedback Routes (disimpan di Google Sheet; list dilihat langsung di sheet)
api.post('/feedback', authMiddleware, (c) => feedbackController.create(c));

// Client Routes (server-to-server, autentikasi lewat header X-API-Key)
api.get('/commission/:email', apiKeyMiddleware, (c) => commissionController.clientSalesCommission(c));

// TV Routes (tanpa login, autentikasi lewat ?key=)
api.get('/tv/mrc', (c) => tvController.mrc(c));

// Additional Routes
api.get('/additional/period', (c) => additionalController.getPeriod(c));
export { api };

