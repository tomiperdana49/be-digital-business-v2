import { OAuth2Client } from "google-auth-library";
import { sign, verify } from 'hono/jwt';
import axios from "axios";
import { config } from "../config/app";
import { IEmployeeService } from "../interface/employee.interface";
import { UnauthorizedException, NotFoundException } from "../helper/exception";
import { IAuthService } from "../interface/auth.interface";

export class AuthService implements IAuthService {
    constructor(private readonly employeeService: IEmployeeService) {}

    /**
     * Karyawan yang sudah resign / nonaktif tidak boleh login maupun refresh token.
     */
    private assertActive(employee: any) {
        if (employee.deactivated_at && new Date(employee.deactivated_at) <= new Date()) {
            throw new UnauthorizedException('Employee is no longer active');
        }
    }

    private getOauth2Client() {
        return new OAuth2Client(
            config.auth.googleClientId,
            config.auth.googleClientSecret,
            'postmessage'
        );
    }

    async verifyGoogleCode(code: string): Promise<any> {
        const oAuth2Client = this.getOauth2Client();
        const result = await oAuth2Client.getToken(code);
        const ticket = await oAuth2Client.verifyIdToken({
            idToken: result.tokens.id_token!,
            audience: config.auth.googleClientId,
        });
        return ticket.getPayload();
    }

    private formatUser(employee: any) {
        if (!employee) return null;
        return {
            ...employee,
            has_dashboard: Boolean(employee.has_dashboard),
            is_admin: Boolean(employee.is_admin),
        };
    }

    async generateToken(employee: any) {
        const now = Math.floor(Date.now() / 1000);
        const accessTokenPayload = {
            sub: employee.employee_id,
            svp: employee.manager_id,
            email: employee.email,
            role: employee.job_position,
            is_admin: Boolean(employee.is_admin),
            exp: now + 60 * 15, // 15 minutes
        };
        const refreshTokenPayload = {
            sub: employee.employee_id,
            email: employee.email,
            exp: now + 60 * 60 * 24 * 7, // 7 days
        };

        const accessToken = await sign(accessTokenPayload, config.auth.jwtSecret);
        const refreshToken = await sign(refreshTokenPayload, config.auth.jwtSecret);
        
        return { accessToken, refreshToken };
    }

    async login(employeeId: string, password: string) {
        let isVerify;
        try {
            isVerify = await axios.post(config.auth.apiUrl, {
                username: employeeId,
                password: password
            });
        } catch (error: any) {
            throw new UnauthorizedException('Employee ID or password is not valid');
        }

        if(isVerify.status !== 201) {
            throw new UnauthorizedException('Employee ID or password is not valid');
        }
        
        const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId) as any;
        
        if(!employee) {
            throw new NotFoundException('Employee not found');
        }
        this.assertActive(employee);

        const tokens = await this.generateToken(employee);
        
        return {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            user: this.formatUser(employee)
        };
    }

    async devLogin(employeeId: string) {
        const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId) as any;
        
        if(!employee) {
            throw new NotFoundException('Employee not found');
        }
        this.assertActive(employee);

        const tokens = await this.generateToken(employee);
        
        return {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            user: this.formatUser(employee)
        };
    }

    async googleLogin(code: string) {
        const payload = await this.verifyGoogleCode(code);
        const employee = await this.employeeService.getEmployeeByEmail(payload.email) as any;
        
        if(!employee) {
            throw new NotFoundException('Employee not found');
        }
        this.assertActive(employee);

        const tokens = await this.generateToken(employee);
        
        return {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            user: this.formatUser(employee)
        };
    }

    async refreshToken(refreshToken: string) {
        let payload;
        try {
            payload = await verify(refreshToken, config.auth.jwtSecret, 'HS256');
        } catch (err) {
            throw new UnauthorizedException('Invalid refresh token');
        }
        
        const email = payload.email as string;
        
        const employee = await this.employeeService.getEmployeeByEmail(email) as any;
        if (!employee) {
            throw new UnauthorizedException('User not found');
        }
        this.assertActive(employee);

        const tokens = await this.generateToken(employee);

        return {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            user: this.formatUser(employee)
        };
    }

    async getMe(token: string) {
        let payload;
        try {
            payload = await verify(token, config.auth.jwtSecret, 'HS256');
        } catch (err) {
            throw new UnauthorizedException('Invalid token');
        }
        
        const email = payload.email as string;
        const employee = await this.employeeService.getEmployeeByEmail(email) as any;

        if (!employee) {
            throw new NotFoundException('User not found');
        }
        this.assertActive(employee);

        return this.formatUser(employee);
    }
}
