import type { CoreMessage, ImagePart, UserContent } from 'ai';
import { Jimp } from 'jimp';

export interface ZendeskMessage {
  id: string;
  received: string;
  author: {
    userId?: string;
    displayName?: string;
    avatarUrl?: string;
    type: 'user' | 'business';
  };
  content: UserContent
  source?: {
    integrationId?: string;
    type: string;
  };
}

export function extractImageUrls(htmlBody: string): string[] {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const imgRegex = new RegExp(`<img[^>]+src=["'](https:\\/\\/${subdomain}\\.zendesk\\.com\\/attachments\\/token\\/[^"']+)["'][^>]*>`, 'gi');
  return Array.from(htmlBody.matchAll(imgRegex), match => match[1]);
}

export async function encodeImageUrls(imageUrls: string[]): Promise<ImagePart[]> {
  const MAX_IMAGE_DIMENSION = 600;
  const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB in bytes

  const filePromises = imageUrls.map(async imageUrl => {
    try {
      if (imageUrl.startsWith('blob:')) {
        return null;
      }

      const fullUrl = imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl;
      const response = await fetch(fullUrl);
      const mimeType = response.headers.get('content-type') || 'application/octet-stream';
      const allowedImageTypes = ['image/jpeg', 'image/png'];

      if (allowedImageTypes.includes(mimeType)) {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        let cleanBuffer = buffer;

        // Only clean PNG files
        if (mimeType === 'image/png') {
          // Find the end of PNG file (IEND chunk + CRC)
          const iendIndex = buffer.indexOf(Buffer.from([0x49, 0x45, 0x4e, 0x44])); // "IEND"
          if (iendIndex !== -1) {
            cleanBuffer = buffer.subarray(0, iendIndex + 8); // Include IEND + CRC
          }
        }

        const image = await Jimp.read(cleanBuffer);
        const base64Content = await image
          .contain({ w: MAX_IMAGE_DIMENSION, h: MAX_IMAGE_DIMENSION })
          .getBase64(mimeType as 'image/jpeg' | 'image/png');

        // Check if the resized image size exceeds 20MB
        const resizedImageSize = base64Content.length * 0.75; // Approximate size in bytes
        if (resizedImageSize > MAX_IMAGE_SIZE_BYTES) {
          console.log('Resized image size exceeds 20MB limit: ', imageUrl);
          return null;
        }

        return {
          type: 'image' as const,
          image: base64Content,
        };
      }

      return null;
    } catch {
      console.log('Failed to fetch and encode file: ', imageUrl);
      return null;
    }
  });

  const fileResults = await Promise.all(filePromises);
  return fileResults.filter(result => result !== null);
}

export function zendeskTicketToAiMessages(messages: ZendeskMessage[]): CoreMessage[] {
  return [
    ...messages.map(
      message =>
        ({
          role: message.author.type === 'user' ? 'user' : 'assistant',
          content: message.content,
        }) as CoreMessage,
    ),
  ];
}
