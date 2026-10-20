import axios from 'axios';
import { unlink } from 'node:fs/promises';
import { config } from '../config/app';
import { Feedback, IFeedbackRepository } from '../interface/feedback.interface';
import { Exception } from '../helper/exception';
import type { ImageExtension } from '../helper/image-upload';

export const FEEDBACK_UPLOAD_DIR = 'uploads/feedback';

/**
 * Feedback disimpan di Google Sheet (bukan database) lewat web app Apps Script (apps-script/feedback.gs).
 * Lampiran disimpan di disk backend dan disajikan dari /api/uploads; sheet hanya menyimpan link-nya.
 */
export class FeedbackRepository implements IFeedbackRepository {
    private assertConfigured() {
        const { appsScriptUrl, appsScriptSecret, appUrl } = config.feedback;
        if (!appsScriptUrl || !appsScriptSecret || !appUrl) {
            throw new Exception('Feedback sheet is not configured', 503);
        }
    }

    /** Gambar harus sudah lolos validateImages; `ext` berasal dari isi file, bukan dari client. */
    async saveImages(employeeId: string, images: { file: File; ext: ImageExtension }[]): Promise<string[]> {
        // Cek konfigurasi dulu supaya tidak ada file yang tersimpan kalau feedback pasti gagal dikirim
        this.assertConfigured();

        const timestamp = Date.now();
        const safeId = employeeId.replace(/[^A-Za-z0-9_-]/g, '');
        const fileNames: string[] = [];

        for (let i = 0; i < images.length; i++) {
            const { file, ext } = images[i]!;
            const fileName = `${safeId}_${timestamp}_${i}.${ext}`;
            // Bun.write membuat folder yang belum ada
            await Bun.write(`${FEEDBACK_UPLOAD_DIR}/${fileName}`, file);
            fileNames.push(fileName);
        }

        return fileNames;
    }

    async deleteImages(fileNames: string[]): Promise<void> {
        await Promise.all(fileNames.map(name => unlink(`${FEEDBACK_UPLOAD_DIR}/${name}`).catch(() => {})));
    }

    imageUrl(fileName: string): string {
        return `${config.feedback.appUrl.replace(/\/$/, '')}/api/${FEEDBACK_UPLOAD_DIR}/${fileName}`;
    }

    async create(data: Feedback): Promise<void> {
        this.assertConfigured();
        const { appsScriptUrl, appsScriptSecret } = config.feedback;

        // Secret dikirim di body karena Apps Script tidak bisa membaca header request.
        // Apps Script membalas 302 ke script.googleusercontent.com; axios mengikutinya otomatis.
        const res = await axios.post(appsScriptUrl, { secret: appsScriptSecret, ...data }, { timeout: 15000 });

        if (res.data?.success !== true) {
            console.error('[Feedback] Apps Script error:', res.data?.message ?? res.data);
            throw new Exception('Failed to save feedback', 502);
        }
    }

    async notify(data: Feedback): Promise<void> {
        const { googleChatWebhookUrl, sheetUrl } = config.feedback;
        if (!googleChatWebhookUrl) return;

        // Format teks Google Chat: *tebal*, <url|label> untuk link
        const lines = [
            `*Feedback baru: ${data.type}*`,
            `*Dari:* ${data.name || '-'} (${data.employeeId})`,
            `*Waktu:* ${data.createdAt} WIB`,
        ];
        if (data.url) lines.push(`*Halaman:* ${data.url}`);
        lines.push('', data.message);
        if (data.images.length) {
            lines.push('', `*Lampiran:* ${data.images.map((url, i) => `<${url}|Gambar ${i + 1}>`).join(', ')}`);
        }
        if (sheetUrl) lines.push('', `<${sheetUrl}|Buka Google Sheet feedback>`);

        await axios.post(googleChatWebhookUrl, { text: lines.join('\n') }, { timeout: 10000 });
    }
}
