import type { ImageExtension } from "../helper/image-upload";

// Label dipakai di kolom Tipe pada sheet
export const FEEDBACK_TYPES = {
    issue: 'Masalah',
    suggestion: 'Saran',
    compliment: 'Pujian',
} as const;

export type FeedbackType = keyof typeof FEEDBACK_TYPES;

export interface Feedback {
    createdAt: string;
    employeeId: string;
    name: string;
    type: string;
    url: string;
    message: string;
    images: string[];
}

export interface IFeedbackRepository {
    /** Simpan gambar di uploads/feedback, kembalikan nama file yang tersimpan. */
    saveImages(employeeId: string, images: { file: File; ext: ImageExtension }[]): Promise<string[]>;
    deleteImages(fileNames: string[]): Promise<void>;
    imageUrl(fileName: string): string;
    create(data: Feedback): Promise<void>;
}
