import { Context } from "hono";
import { FEEDBACK_TYPES, FeedbackType, IFeedbackRepository } from "../interface/feedback.interface";
import { IEmployeeService } from "../interface/employee.interface";
import { ApiResponse } from "../helper/response";
import { BadRequestException } from "../helper/exception";
import { validateImages } from "../helper/image-upload";

const MAX_MESSAGE_LENGTH = 2000;

export class FeedbackController {
    constructor(
        private readonly feedbackRepository: IFeedbackRepository,
        private readonly employeeService: IEmployeeService
    ) {}

    async create(c: Context) {
        const body = await c.req.parseBody({ all: true });
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const type = body.type as FeedbackType;
        const url = typeof body.url === 'string' ? body.url.slice(0, 500) : '';
        const rawImages = Array.isArray(body.images) ? body.images : body.images ? [body.images] : [];
        const imageFiles = rawImages.filter((f): f is File => f instanceof File);

        if (!message) {
            throw new BadRequestException('Deskripsi wajib diisi');
        }
        if (message.length > MAX_MESSAGE_LENGTH) {
            throw new BadRequestException(`Deskripsi maksimal ${MAX_MESSAGE_LENGTH} karakter`);
        }
        if (!Object.keys(FEEDBACK_TYPES).includes(type)) {
            throw new BadRequestException('Tipe feedback tidak valid');
        }
        // Semua validasi selesai sebelum ada file yang ditulis ke disk
        const images = await validateImages(imageFiles);

        const user = c.get('user');
        const employee = await this.employeeService.getEmployeeByEmployeeId(user.sub);
        const fileNames = await this.feedbackRepository.saveImages(user.sub, images);

        try {
            await this.feedbackRepository.create({
                // Format "yyyy-MM-dd HH:mm:ss" WIB, supaya mudah dibaca & diurutkan di sheet
                createdAt: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }),
                employeeId: user.sub,
                name: employee?.name ?? '',
                type: FEEDBACK_TYPES[type],
                url,
                message,
                images: fileNames.map(name => this.feedbackRepository.imageUrl(name)),
            });
        } catch (err) {
            // Feedback tidak tercatat di sheet, jadi lampirannya juga tidak disimpan
            await this.feedbackRepository.deleteImages(fileNames);
            throw err;
        }

        return ApiResponse.success(c, null, "Feedback sent successfully", 201);
    }
}
