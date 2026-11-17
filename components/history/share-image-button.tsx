'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH, type ShareCardData } from '@/lib/share-card';
import { drawShareCard } from '@/lib/share-card-canvas';

interface Props {
  card: ShareCardData;
}

// How long the object URL of a downloaded image is kept before it is revoked:
// some browsers start the download a tick after the click.
export const REVOKE_DELAY_MS = 100;

// Renders the card on an off-screen canvas and returns it as a PNG file, or
// null when the browser gives no 2D context or no blob.
async function renderCardFile(card: ShareCardData): Promise<File | null> {
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_CARD_WIDTH;
  canvas.height = SHARE_CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawShareCard(ctx, card);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return new File([blob], card.fileName, { type: 'image/png' });
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

// "Share as image" (issue #576 part 3): the summary card of a finished
// session, drawn in the browser. It goes to the system share sheet where the
// browser can share files, and is downloaded otherwise. The image never
// leaves the device unless the user picks a share target.
export function ShareImageButton({ card }: Props) {
  const t = useTranslations('history.shareImage');
  const [busy, setBusy] = useState(false);

  async function handleShare() {
    setBusy(true);
    try {
      const file = await renderCardFile(card);
      if (!file) {
        toast.error(t('error'));
        return;
      }
      const data = { files: [file], title: card.title };
      if (typeof navigator.share === 'function' && navigator.canShare?.(data)) {
        try {
          await navigator.share(data);
          return;
        } catch (error) {
          // The user closed the share sheet: not an error, nothing to say.
          if ((error as { name?: unknown } | null)?.name === 'AbortError') return;
          // Anything else (share refused by the browser): keep the image.
        }
      }
      downloadFile(file);
      toast.success(t('saved'));
    } catch {
      toast.error(t('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleShare} disabled={busy}>
      <Share2 className="size-4" />
      <span className="ml-1">{t('button')}</span>
    </Button>
  );
}
