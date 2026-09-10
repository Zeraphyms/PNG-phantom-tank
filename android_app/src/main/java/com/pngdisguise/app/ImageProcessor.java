package com.pngdisguise.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.util.List;

public class ImageProcessor {

    public static final int COVER_BG_COLOR = Color.rgb(0, 0, 0); // 默认黑色
    public static final int MAX_FRAME_PIXELS = 8_000_000;
    public static final int MAX_TOTAL_PIXELS = 300_000_000;

    public static class ProcessException extends Exception {
        public ProcessException(String message) {
            super(message);
        }
    }

    public static byte[] bitmapToRgbaBytes(Bitmap bitmap) {
        int w = bitmap.getWidth();
        int h = bitmap.getHeight();
        int[] pixels = new int[w * h];
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h);
        byte[] rgba = new byte[w * h * 4];
        int idx = 0;
        for (int p : pixels) {
            rgba[idx++] = (byte) ((p >> 16) & 0xFF); // R
            rgba[idx++] = (byte) ((p >> 8) & 0xFF);  // G
            rgba[idx++] = (byte) (p & 0xFF);         // B
            rgba[idx++] = (byte) ((p >> 24) & 0xFF); // A
        }
        return rgba;
    }

    public static Bitmap getDefaultCover(Context context) {
        try {
            InputStream is = context.getAssets().open("default_cover.png");
            Bitmap bm = BitmapFactory.decodeStream(is);
            is.close();
            return bm;
        } catch (Exception e) {
            return null;
        }
    }

    public static Bitmap makeCover(int canvasW, int canvasH, Bitmap coverSrc, Integer badge) {
        return makeCover(canvasW, canvasH, coverSrc, badge, COVER_BG_COLOR);
    }

    public static Bitmap makeCover(int canvasW, int canvasH, Bitmap coverSrc, Integer badge, int bgColor) {
        Bitmap canvas = Bitmap.createBitmap(canvasW, canvasH, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(canvas);
        c.drawColor(bgColor);

        if (coverSrc != null) {
            float scale = Math.min((float) canvasW / coverSrc.getWidth(), (float) canvasH / coverSrc.getHeight());
            int dw = Math.max(1, Math.round(coverSrc.getWidth() * scale));
            int dh = Math.max(1, Math.round(coverSrc.getHeight() * scale));
            int left = (canvasW - dw) / 2;
            int top = (canvasH - dh) / 2;
            Rect dst = new Rect(left, top, left + dw, top + dh);
            c.drawBitmap(coverSrc, null, dst, null);
        }

        if (badge != null && badge > 0) {
            drawBadge(c, canvasW, canvasH, badge);
        }

        return canvas;
    }

    private static void drawBadge(Canvas canvas, int cw, int ch, int badge) {
        String text = String.valueOf(badge);
        float densityScale = Math.max(1f, Math.min(cw, ch) / 400f);
        float textSize = 28f * densityScale;

        Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        textPaint.setColor(Color.WHITE);
        textPaint.setTextSize(textSize);
        textPaint.setFakeBoldText(true);

        Rect bounds = new Rect();
        textPaint.getTextBounds(text, 0, text.length(), bounds);

        float padding = 12f * densityScale;
        float badgeW = bounds.width() + padding * 2;
        float badgeH = bounds.height() + padding * 2;
        float margin = 16f * densityScale;

        Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        bgPaint.setColor(Color.argb(200, 0, 0, 0));

        RectF rect = new RectF(margin, margin, margin + badgeW, margin + badgeH);
        float radius = 8f * densityScale;
        canvas.drawRoundRect(rect, radius, radius, bgPaint);

        float textX = rect.left + padding;
        float textY = rect.bottom - padding;
        canvas.drawText(text, textX, textY, textPaint);
    }

    public static byte[] disguiseStatic(Bitmap srcImage, Bitmap coverImage, Integer badge) throws Exception {
        return disguiseStatic(srcImage, coverImage, badge, COVER_BG_COLOR);
    }

    public static byte[] disguiseStatic(Bitmap srcImage, Bitmap coverImage, Integer badge, int bgColor) throws Exception {
        int w = srcImage.getWidth();
        int h = srcImage.getHeight();
        if (w <= 0 || h <= 0) {
            throw new ProcessException("图片尺寸无效");
        }
        if ((long) w * h > MAX_FRAME_PIXELS) {
            throw new ProcessException("图片尺寸过大（单帧不可超过800万像素）");
        }

        Bitmap cover = makeCover(w, h, coverImage, badge, bgColor);
        byte[] coverRgba = bitmapToRgbaBytes(cover);
        byte[] srcRgba = bitmapToRgbaBytes(srcImage);

        ApngCodec.ApngWriter writer = new ApngCodec.ApngWriter(w, h, 2, 0, "STATIC", 1);
        // 默认帧（封面）
        writer.writeDefault(coverRgba);
        // 第1帧：真实图片，延时 10/100 秒
        writer.writeFrame(w, h, srcRgba, 0, 0, 10, 100, 0, 0);

        // 第2帧：1x1 透明心跳保活帧，blend_op = 1 (APNG_BLEND_OP_OVER)
        byte[] hbRgba = new byte[] {0, 0, 0, 0};
        writer.writeFrame(1, 1, hbRgba, 0, 0, 10, 100, 0, 1);

        return writer.finish();
    }

    public static byte[] disguiseGif(byte[] gifBytes, Bitmap coverImage, Integer badge) throws Exception {
        return disguiseGif(gifBytes, coverImage, badge, COVER_BG_COLOR);
    }

    public static byte[] disguiseGif(byte[] gifBytes, Bitmap coverImage, Integer badge, int bgColor) throws Exception {
        GifDecoder decoder = new GifDecoder();
        int status = decoder.read(gifBytes);
        if (status != 0 || decoder.getFrames().isEmpty()) {
            throw new ProcessException("GIF 动图解析失败");
        }
        List<GifDecoder.GifFrame> frames = decoder.getFrames();
        int frameCount = frames.size();
        int w = decoder.width;
        int h = decoder.height;

        if (w <= 0 || h <= 0) {
            throw new ProcessException("GIF 尺寸无效");
        }
        if ((long) w * h * frameCount > MAX_TOTAL_PIXELS) {
            throw new ProcessException("GIF 动图总像素过大");
        }

        Bitmap cover = makeCover(w, h, coverImage, badge, bgColor);
        byte[] coverRgba = bitmapToRgbaBytes(cover);

        int playCount = decoder.getLoopCount();
        ApngCodec.ApngWriter writer = new ApngCodec.ApngWriter(w, h, frameCount, playCount, "ANIMATED", frameCount);
        writer.writeDefault(coverRgba);

        for (int i = 0; i < frameCount; i++) {
            GifDecoder.GifFrame fr = frames.get(i);
            byte[] frRgba = bitmapToRgbaBytes(fr.bitmap);
            int delayNum = Math.max(1, Math.min(65535, Math.round(fr.delayMs / 10f)));
            writer.writeFrame(w, h, frRgba, 0, 0, delayNum, 100, 0, 0);
        }

        return writer.finish();
    }

    public static ApngCodec.DisguiseResult restoreDisguiseResult(byte[] apngBytes) throws Exception {
        return ApngCodec.restoreDisguiseResult(apngBytes);
    }

    public static byte[] restoreDisguise(byte[] apngBytes) throws Exception {
        return ApngCodec.restoreDisguise(apngBytes);
    }

}
